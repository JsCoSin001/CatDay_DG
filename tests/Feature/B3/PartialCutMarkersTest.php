<?php

namespace Tests\Feature\B3;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\CreatesFactoryFlowSchema;
use Tests\TestCase;

class PartialCutMarkersTest extends TestCase
{
    use CreatesFactoryFlowSchema;

    private const QR = 'cuontp;MB001;1000;PARTIAL-A';

    protected function setUp(): void
    {
        parent::setUp();
        config(['database.default' => 'sqlite', 'database.connections.sqlite.database' => ':memory:']);
        DB::purge('sqlite');
        $this->assertSame(':memory:', DB::connection()->getDatabaseName());
        $this->createFactoryFlowSchema();
        DB::table('users')->insert(['user_id' => 1, 'username' => 'worker', 'password_hash' => 'x', 'is_active' => 1]);
        DB::table('DanhSachMaSP')->insert(['id' => 1, 'Ten' => 'SP', 'Ma' => 'SP']);
        DB::table('TTThanhPham')->insert(['id' => 10, 'DanhSachSP_ID' => 1, 'MaBin' => 'E7-MB001/4-01-00', 'NhapKho' => 1, 'Temp' => 0]);
        DB::table('TTNhapKhoTP')->insert(['id' => 20, 'TTThanhPham_ID' => 10, 'NgayNhapKho' => '2026-10-01']);
        DB::table('TTCuonDay')->insert(['id' => 30, 'ThongTinNhapKho_ID' => 20, 'SoCuon' => 1, 'ChieuDai_1cuon' => 1000]);
        DB::table('TonCuonLe')->insert([
            'id' => 70, 'MaCuon' => self::QR, 'TTThanhPham_ID' => 10, 'TTCuonDay_ID' => 30,
            'SoDau' => 0, 'SoCuoi' => 411, 'TrangThai' => 'ACTIVE',
        ]);
        DB::table('KeHoach')->insert(['id' => 1, 'Users_id' => 1, 'MaKeHoach' => 'KH', 'NgayKeHoach' => '2026-10-20', 'TrangThai' => 'ACTIVE']);
        DB::table('KeHoachHang')->insert(['id' => 40, 'KeHoach_ID' => 1, 'DanhSachMaSP_ID' => 1]);
        DB::table('KeHoachCatNhom')->insert(['id' => 50, 'KeHoachHang_ID' => 40, 'TonCuonLe_ID' => 70]);
        DB::table('KeHoachCatChiTiet')->insert(['id' => 60, 'KeHoachCatNhom_ID' => 50, 'ChieuDaiCanCat' => 100]);
        $this->actingAs(User::query()->findOrFail(1));
    }

    private function cut(array $markers = [], array $overrides = [])
    {
        return $this->postJson('/api/b3/execute/cut', array_replace([
            'raw_qr' => self::QR, 'ke_hoach_id' => 1, 'ke_hoach_hang_id' => 40,
            'group_id' => 50, 'detail_id' => 60,
            'operation_token' => '11111111-1111-4111-8111-111111111111',
        ], $markers, $overrides));
    }

    private function assertPartialAndHistory(int $beforeStart, int $end, int $afterEnd, int $direction): void
    {
        $this->assertDatabaseHas('TonCuonLe', ['id' => 70, 'SoDau' => $beforeStart, 'SoCuoi' => $afterEnd, 'TrangThai' => 'ACTIVE']);
        $this->assertDatabaseHas('LichSuCat', [
            'KeHoachCatChiTiet_ID' => 60, 'TonCuonLe_ID' => 70, 'LoaiNguon' => 'CUON_LE',
            'ChieuDaiCat' => 100, 'SoDauTruoc' => $beforeStart, 'SoCuoiTruoc' => $end,
            'SoDauCat' => $end, 'SoCuoiCat' => $afterEnd,
            'SoDauSau' => $beforeStart, 'SoCuoiSau' => $afterEnd, 'HeSoChieu' => $direction,
        ]);
        $this->assertSame(311, abs((int) DB::table('TonCuonLe')->value('SoCuoi') - (int) DB::table('TonCuonLe')->value('SoDau')));
        $this->assertSame(1, DB::table('TonCuonLe')->count());
        $this->assertSame(1, DB::table('LichSuCat')->count());
        $this->assertSame(0, DB::table('LichSuLayCuon')->count());
        $this->assertSame(0, DB::table('B3QrSuDung')->count());
    }

    private function assertNoCutMutation(int $soDau = 0, int $soCuoi = 411): void
    {
        $this->assertDatabaseHas('TonCuonLe', ['id' => 70, 'SoDau' => $soDau, 'SoCuoi' => $soCuoi, 'TrangThai' => 'ACTIVE']);
        $this->assertDatabaseHas('KeHoachCatNhom', ['id' => 50, 'TonCuonLe_ID' => 70]);
        $this->assertSame(1, DB::table('TonCuonLe')->count());
        $this->assertSame(0, DB::table('LichSuCat')->count());
        $this->assertSame(0, DB::table('LichSuLayCuon')->count());
        $this->assertSame(0, DB::table('B3QrSuDung')->count());
    }

    public static function editedMarkers(): array
    {
        return [
            'default forward markers' => [411, 1, 0, 311],
            'edited end retains actual inventory length' => [500, 1, 89, 400],
            'edited end and reversed direction' => [500, -1, 911, 600],
            'zero end and reversed direction' => [0, -1, 411, 100],
        ];
    }

    #[DataProvider('editedMarkers')]
    public function test_explicit_partial_markers_rebase_actual_length_and_record_the_cut(int $end, int $direction, int $start, int $after): void
    {
        $this->cut(['end_value' => $end, 'direction' => $direction])->assertOk();
        $this->assertPartialAndHistory($start, $end, $after, $direction);
    }

    public function test_edits_override_inverse_database_markers_without_using_source_standard_length(): void
    {
        DB::table('TonCuonLe')->where('id', 70)->update(['SoDau' => 911, 'SoCuoi' => 500]);
        $this->cut(['end_value' => 600, 'direction' => 1])->assertOk();
        $this->assertPartialAndHistory(189, 600, 500, 1);
    }

    public function test_full_reel_conversion_can_continue_with_edited_partial_markers(): void
    {
        DB::table('TonCuonLe')->delete();
        DB::table('KeHoachHangQuyCachCuonChan')->insert(['id' => 80, 'KeHoachHang_ID' => 40, 'ChieuDai1Cuon' => 1000, 'SoLuongCuonCanLay' => 0]);
        DB::table('KeHoachCatNhom')->where('id', 50)->update(['TonCuonLe_ID' => null, 'QuyCachCuonChan_ID' => 80]);
        DB::table('KeHoachCatChiTiet')->insert(['id' => 61, 'KeHoachCatNhom_ID' => 50, 'ChieuDaiCanCat' => 100]);

        $this->cut(['end_value' => 1000, 'direction' => 1])->assertOk();
        $partialId = (int) DB::table('TonCuonLe')->value('id');
        $this->assertDatabaseHas('TonCuonLe', ['id' => $partialId, 'SoDau' => 0, 'SoCuoi' => 900]);
        $this->assertDatabaseHas('KeHoachCatNhom', ['id' => 50, 'TonCuonLe_ID' => $partialId]);
        $this->assertDatabaseHas('B3QrSuDung', ['RawQr' => self::QR, 'TrangThai' => 'DA_CHUYEN_LE', 'TonCuonLe_ID' => $partialId]);

        $this->cut(['end_value' => 1100, 'direction' => 1], ['detail_id' => 61, 'operation_token' => '22222222-2222-4222-8222-222222222222'])->assertOk();
        $this->assertDatabaseHas('TonCuonLe', ['id' => $partialId, 'SoDau' => 200, 'SoCuoi' => 1000, 'TrangThai' => 'ACTIVE']);
        $this->assertDatabaseHas('LichSuCat', ['KeHoachCatChiTiet_ID' => 61, 'LoaiNguon' => 'CUON_LE', 'SoDauTruoc' => 200, 'SoCuoiTruoc' => 1100, 'SoCuoiCat' => 1000, 'HeSoChieu' => 1]);
        $this->assertSame(2, DB::table('LichSuCat')->count());
        $this->assertSame(1, DB::table('TonCuonLe')->count());
        $this->assertSame(1, DB::table('B3QrSuDung')->count());
    }

    public function test_omitting_both_markers_preserves_legacy_forward_cut(): void
    {
        $this->cut()->assertOk();
        $this->assertPartialAndHistory(0, 411, 311, 1);
    }

    public function test_omitting_both_markers_preserves_legacy_inverse_cut(): void
    {
        DB::table('TonCuonLe')->where('id', 70)->update(['SoDau' => 911, 'SoCuoi' => 500]);
        $this->cut()->assertOk();
        $this->assertPartialAndHistory(911, 500, 600, -1);
    }

    public static function incompleteMarkers(): array
    {
        return [[['end_value' => 500]], [['direction' => -1]]];
    }

    #[DataProvider('incompleteMarkers')]
    public function test_one_marker_parameter_is_rejected_without_mutation(array $markers): void
    {
        $this->cut($markers)->assertStatus(422)->assertJsonPath('error_code', 'CUT_INPUT_INVALID');
        $this->assertNoCutMutation();
    }

    public function test_negative_computed_start_is_rejected_without_mutation(): void
    {
        $this->cut(['end_value' => 400, 'direction' => 1])->assertStatus(422)->assertJsonPath('error_code', 'CUT_INPUT_INVALID');
        $this->assertNoCutMutation();
    }

    public function test_negative_supplied_end_is_rejected_without_mutation(): void
    {
        $this->cut(['end_value' => -1, 'direction' => -1])->assertStatus(422)->assertJsonPath('error_code', 'CUT_INPUT_INVALID');
        $this->assertNoCutMutation();
    }

    public function test_changed_markers_cannot_expand_length_to_satisfy_insufficient_stock(): void
    {
        DB::table('KeHoachCatChiTiet')->where('id', 60)->update(['ChieuDaiCanCat' => 412]);
        $this->cut(['end_value' => 1000, 'direction' => 1])->assertStatus(409)->assertJsonPath('error_code', 'STALE_DATA');
        $this->assertNoCutMutation();
    }

    public function test_cut_exactly_remaining_length_exhausts_partial(): void
    {
        DB::table('KeHoachCatChiTiet')->where('id', 60)->update(['ChieuDaiCanCat' => 411]);
        $this->cut(['end_value' => 500, 'direction' => 1])->assertOk();
        $this->assertDatabaseHas('TonCuonLe', ['id' => 70, 'SoDau' => 89, 'SoCuoi' => 89, 'TrangThai' => 'HET']);
        $this->assertDatabaseHas('LichSuCat', ['KeHoachCatChiTiet_ID' => 60, 'ChieuDaiCat' => 411, 'SoDauTruoc' => 89, 'SoCuoiTruoc' => 500, 'SoDauSau' => 89, 'SoCuoiSau' => 89]);
    }

    public function test_explicit_markers_do_not_bypass_partial_group_binding(): void
    {
        DB::table('KeHoachCatNhom')->where('id', 50)->update(['TonCuonLe_ID' => 71]);
        $this->cut(['end_value' => 500, 'direction' => 1])->assertStatus(409)->assertJsonPath('error_code', 'STALE_DATA');
        $this->assertSame(0, DB::table('LichSuCat')->count());
        $this->assertDatabaseHas('TonCuonLe', ['id' => 70, 'SoDau' => 0, 'SoCuoi' => 411]);
    }

    public function test_explicit_markers_do_not_bypass_plan_ownership(): void
    {
        DB::table('KeHoach')->where('id', 1)->update(['Users_id' => 2]);
        $this->cut(['end_value' => 500, 'direction' => 1])->assertStatus(404)->assertJsonPath('error_code', 'PLAN_NOT_FOUND');
        $this->assertNoCutMutation();
    }

    public function test_explicit_markers_do_not_bypass_other_pending_reservations(): void
    {
        DB::table('KeHoachCatChiTiet')->insert(['id' => 61, 'KeHoachCatNhom_ID' => 50, 'ChieuDaiCanCat' => 312]);
        $this->cut(['end_value' => 1000, 'direction' => 1])->assertStatus(409)->assertJsonPath('error_code', 'STALE_DATA');
        $this->assertNoCutMutation();
    }

    public function test_repeated_operation_token_cannot_rebase_or_cut_again(): void
    {
        $this->cut(['end_value' => 500, 'direction' => 1])->assertOk();
        $this->cut(['end_value' => 800, 'direction' => -1])->assertStatus(409)->assertJsonPath('error_code', 'DUPLICATE_REQUEST');
        $this->assertPartialAndHistory(89, 500, 400, 1);
    }

    public function test_already_done_detail_cannot_rebase_with_another_token(): void
    {
        $this->cut(['end_value' => 500, 'direction' => 1])->assertOk();
        $this->cut(['end_value' => 800, 'direction' => -1], ['operation_token' => '22222222-2222-4222-8222-222222222222'])
            ->assertStatus(409)->assertJsonPath('error_code', 'DETAIL_ALREADY_DONE');
        $this->assertPartialAndHistory(89, 500, 400, 1);
    }
}
