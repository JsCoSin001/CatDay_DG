<?php

namespace Tests\Feature\B3;

use App\Models\User;
use App\Repositories\B3\InventoryRepository;
use Illuminate\Support\Facades\DB;
use Tests\Support\CreatesFactoryFlowSchema;
use Tests\TestCase;

class TakeWholeReelProductInventoryTest extends TestCase
{
    use CreatesFactoryFlowSchema;

    protected function setUp(): void
    {
        parent::setUp();
        $this->createFactoryFlowSchema();
        DB::table('users')->insert(['user_id' => 1, 'username' => 'worker', 'password_hash' => 'x', 'is_active' => 1]);
        DB::table('DanhSachMaSP')->insert([['id' => 1, 'Ten' => 'SP A', 'Ma' => 'A'], ['id' => 2, 'Ten' => 'SP B', 'Ma' => 'B']]);
        DB::table('TTThanhPham')->insert([
            ['id' => 10, 'DanhSachSP_ID' => 1, 'MaBin' => 'Y', 'NhapKho' => 1, 'Temp' => 0],
            ['id' => 11, 'DanhSachSP_ID' => 1, 'MaBin' => 'X', 'NhapKho' => 1, 'Temp' => 0],
        ]);
        DB::table('TTNhapKhoTP')->insert([
            ['id' => 20, 'TTThanhPham_ID' => 10, 'NgayNhapKho' => '2026-01-01'],
            ['id' => 21, 'TTThanhPham_ID' => 11, 'NgayNhapKho' => '2026-02-01'],
        ]);
        DB::table('TTCuonDay')->insert([
            ['id' => 30, 'SoCuon' => 1, 'ChieuDai_1cuon' => 100, 'ThongTinNhapKho_ID' => 20],
            ['id' => 31, 'SoCuon' => 1, 'ChieuDai_1cuon' => 100, 'ThongTinNhapKho_ID' => 21],
        ]);
        DB::table('KeHoach')->insert(['id' => 1, 'MaKeHoach' => 'KH-A', 'NgayKeHoach' => '2026-10-01', 'TrangThai' => 'ACTIVE']);
        DB::table('KeHoachHang')->insert(['id' => 40, 'KeHoach_ID' => 1, 'DanhSachMaSP_ID' => 1, 'SoLuongCuonCanLay' => 1, 'ChieuDai1Cuon_KeHoach' => 100]);
    }

    private function token(int $n): string
    {
        return sprintf('11111111-1111-4111-8111-%012d', $n);
    }

    private function take(int $n, string $bin = 'X', int $item = 40, int $plan = 1)
    {
        return $this->actingAs(User::query()->findOrFail(1))->postJson('/api/b3/execute/take-whole', [
            'raw_qr' => 'cuontp;' . $bin . ';QR-A',
            'ke_hoach_id' => $plan,
            'ke_hoach_hang_id' => $item,
            'operation_token' => $this->token($n),
        ]);
    }

    private function actual(): int
    {
        return app(InventoryRepository::class)->fullActualForProduct(1);
    }

    private function markXExhausted(): void
    {
        // A completed, inactive older plan used X; it must not reserve current stock.
        DB::table('KeHoach')->insert(['id' => 2, 'MaKeHoach' => 'KH-OLD', 'NgayKeHoach' => '2026-01-01', 'TrangThai' => 'HUY']);
        DB::table('KeHoachHang')->insert(['id' => 41, 'KeHoach_ID' => 2, 'DanhSachMaSP_ID' => 1, 'SoLuongCuonCanLay' => 1]);
        DB::table('LichSuLayCuon')->insert(['KeHoachHang_ID' => 41, 'TTCuonDay_ID' => 31, 'SoLuong' => 1, 'NguoiThucHien' => 'worker']);
    }

    public function test_exhausted_scanned_mabin_can_take_from_other_valid_product_source(): void
    {
        $this->markXExhausted();
        DB::table('TTCuonDay')->where('id', 30)->update(['SoCuon' => 5]);
        DB::table('KeHoachHang')->where('id', 40)->update(['SoLuongCuonCanLay' => 2]);

        $this->assertSame(0, app(InventoryRepository::class)->fullActualForMaBin('X', 1));
        $this->assertSame(5, $this->actual());
        $this->take(1)->assertOk();
        $this->assertDatabaseHas('LichSuLayCuon', ['KeHoachHang_ID' => 40, 'TTCuonDay_ID' => 30, 'SoLuong' => 1]);
        $this->assertSame(4, $this->actual());
        $this->assertSame(1, DB::table('LichSuLayCuon')->where('KeHoachHang_ID', 40)->count());
    }

    public function test_scanned_mabin_does_not_override_exhausted_product_stock(): void
    {
        $this->markXExhausted();
        DB::table('TTCuonDay')->where('id', 30)->update(['SoCuon' => 0]);
        $this->take(2)->assertStatus(409)->assertJsonPath('error_code', 'INSUFFICIENT_FULL_STOCK');
        $this->assertSame(0, DB::table('LichSuLayCuon')->where('KeHoachHang_ID', 40)->count());
    }

    public function test_wrong_product_qr_cannot_take_from_selected_plan(): void
    {
        DB::table('TTThanhPham')->insert(['id' => 12, 'DanhSachSP_ID' => 2, 'MaBin' => 'OTHER', 'NhapKho' => 1, 'Temp' => 0]);
        DB::table('TTNhapKhoTP')->insert(['id' => 22, 'TTThanhPham_ID' => 12]);
        DB::table('TTCuonDay')->insert(['id' => 32, 'SoCuon' => 3, 'ChieuDai_1cuon' => 100, 'ThongTinNhapKho_ID' => 22]);
        $this->take(3, 'OTHER')->assertStatus(422)->assertJsonPath('error_code', 'QR_NOT_IN_PLAN');
        $this->assertSame(0, DB::table('LichSuLayCuon')->count());
    }

    public function test_completed_or_empty_whole_requirement_rejects_further_take(): void
    {
        DB::table('KeHoachHang')->where('id', 40)->update(['SoLuongCuonCanLay' => 0]);
        $this->take(4)->assertStatus(409)->assertJsonPath('error_code', 'PLAN_REQUIREMENT_COMPLETED');
        DB::table('KeHoachHang')->where('id', 40)->update(['SoLuongCuonCanLay' => 1]);
        $this->take(5)->assertOk();
        $this->take(6)->assertStatus(409)->assertJsonPath('error_code', 'PLAN_REQUIREMENT_COMPLETED');
        $this->assertSame(1, DB::table('LichSuLayCuon')->count());
    }

    public function test_fifo_spans_multiple_binaries_and_repeated_qr_with_new_tokens(): void
    {
        DB::table('TTCuonDay')->where('id', 30)->update(['SoCuon' => 2]);
        DB::table('TTCuonDay')->where('id', 31)->update(['SoCuon' => 3]);
        DB::table('KeHoachHang')->where('id', 40)->update(['SoLuongCuonCanLay' => 4]);
        foreach (range(10, 13) as $i) $this->take($i)->assertOk();
        $this->assertSame(1, $this->actual());
        $this->assertSame(2, DB::table('LichSuLayCuon')->where('KeHoachHang_ID', 40)->where('TTCuonDay_ID', 30)->sum('SoLuong'));
        $this->assertSame(2, DB::table('LichSuLayCuon')->where('KeHoachHang_ID', 40)->where('TTCuonDay_ID', 31)->sum('SoLuong'));
    }

    public function test_take_does_not_filter_by_standard_length_or_require_one_on_plan(): void
    {
        DB::table('TTCuonDay')->where('id', 30)->update(['SoCuon' => 2]);
        DB::table('TTCuonDay')->where('id', 31)->update(['SoCuon' => 3, 'ChieuDai_1cuon' => 200]);
        DB::table('KeHoachHang')->where('id', 40)->update(['SoLuongCuonCanLay' => 4, 'ChieuDai1Cuon_KeHoach' => null]);
        $this->assertSame(5, $this->actual());
        foreach (range(20, 23) as $i) $this->take($i)->assertOk();
        $this->assertSame(1, $this->actual());
        $this->assertSame(2, DB::table('LichSuLayCuon')->where('TTCuonDay_ID', 30)->sum('SoLuong'));
        $this->assertSame(2, DB::table('LichSuLayCuon')->where('TTCuonDay_ID', 31)->sum('SoLuong'));
    }

    public function test_other_active_plan_reservations_cannot_be_consumed(): void
    {
        DB::table('TTCuonDay')->where('id', 30)->update(['SoCuon' => 0]);
        DB::table('KeHoach')->insert(['id' => 3, 'MaKeHoach' => 'KH-OTHER', 'NgayKeHoach' => '2026-10-02', 'TrangThai' => 'ACTIVE']);
        DB::table('KeHoachHang')->insert(['id' => 43, 'KeHoach_ID' => 3, 'DanhSachMaSP_ID' => 1, 'SoLuongCuonCanLay' => 1]);
        $this->assertSame(1, $this->actual());
        $this->take(30)->assertStatus(409)->assertJsonPath('error_code', 'STALE_DATA');
        $this->assertSame(0, DB::table('LichSuLayCuon')->count());
    }

    public function test_same_operation_token_only_inserts_one_history(): void
    {
        $this->take(31)->assertOk();
        $this->take(31)->assertStatus(409)->assertJsonPath('error_code', 'DUPLICATE_REQUEST');
        $this->assertSame(1, DB::table('LichSuLayCuon')->count());
    }

    public function test_two_different_tokens_each_take_one_when_demand_exists(): void
    {
        DB::table('KeHoachHang')->where('id', 40)->update(['SoLuongCuonCanLay' => 2]);
        $this->take(32)->assertOk();
        $this->take(33)->assertOk();
        $this->assertSame(2, DB::table('LichSuLayCuon')->where('KeHoachHang_ID', 40)->sum('SoLuong'));
        $this->assertSame(0, $this->actual());
    }

    public function test_negative_per_source_stock_is_reported_instead_of_silently_clamped(): void
    {
        $this->markXExhausted();
        DB::table('LichSuLayCuon')->insert(['KeHoachHang_ID' => 41, 'TTCuonDay_ID' => 31, 'SoLuong' => 1, 'NguoiThucHien' => 'worker']);
        $this->take(34)->assertStatus(409)->assertJsonPath('error_code', 'STALE_DATA');
        $this->assertSame(0, DB::table('LichSuLayCuon')->where('KeHoachHang_ID', 40)->count());
    }

    public function test_failed_history_insert_does_not_consume_stock(): void
    {
        DB::statement("CREATE TRIGGER take_fail BEFORE INSERT ON LichSuLayCuon BEGIN SELECT RAISE(FAIL, 'take test failure'); END;");
        $this->withoutExceptionHandling();
        try {
            $this->take(35);
            $this->fail('Expected the history insert to fail');
        } catch (\Illuminate\Database\QueryException $expected) {
            $this->assertSame(2, $this->actual());
            $this->assertSame(0, DB::table('LichSuLayCuon')->count());
        } finally {
            DB::statement('DROP TRIGGER take_fail');
        }
    }

    public function test_scanned_mabin_exhausted_does_not_relax_cut_execution(): void
    {
        $this->markXExhausted();
        DB::table('KeHoachHang')->where('id', 40)->update(['SoLuongCuonCanLay' => 0]);
        DB::table('KeHoachCatNhom')->insert(['id' => 50, 'KeHoachHang_ID' => 40]);
        DB::table('KeHoachCatChiTiet')->insert(['id' => 60, 'KeHoachCatNhom_ID' => 50, 'ChieuDaiCanCat' => 40]);
        $this->actingAs(User::query()->findOrFail(1))->postJson('/api/b3/execute/cut', [
            'raw_qr' => 'cuontp;X;QR-A', 'ke_hoach_id' => 1, 'ke_hoach_hang_id' => 40,
            'group_id' => 50, 'detail_id' => 60, 'end_value' => 100, 'direction' => 1,
            'operation_token' => $this->token(37),
        ])->assertStatus(409)->assertJsonPath('error_code', 'QR_SOURCE_NOT_USABLE');
        $this->assertSame(0, DB::table('TonCuonLe')->count());
        $this->assertSame(0, DB::table('LichSuCat')->count());
    }

    public function test_existing_partial_qr_is_not_allowed_to_fall_back_to_whole_reel(): void
    {
        DB::table('TonCuonLe')->insert([
            'id' => 70, 'MaCuon' => 'cuontp;X;QR-A', 'TTThanhPham_ID' => 11,
            'TTCuonDay_ID' => 31, 'SoDau' => 0, 'SoCuoi' => 60, 'TrangThai' => 'ACTIVE',
        ]);
        $this->take(38)->assertStatus(409)->assertJsonPath('error_code', 'STALE_DATA');
        $this->assertSame(0, DB::table('LichSuLayCuon')->count());
    }

    public function test_cut_full_remains_scoped_to_scanned_mabin_and_standard_length(): void
    {
        DB::table('TTCuonDay')->where('id', 31)->update(['ChieuDai_1cuon' => 200]);
        DB::table('KeHoachHang')->where('id', 40)->update(['SoLuongCuonCanLay' => 0]);
        DB::table('KeHoachCatNhom')->insert(['id' => 50, 'KeHoachHang_ID' => 40]);
        DB::table('KeHoachCatChiTiet')->insert(['id' => 60, 'KeHoachCatNhom_ID' => 50, 'ChieuDaiCanCat' => 40]);
        $this->actingAs(User::query()->findOrFail(1))->postJson('/api/b3/execute/cut', [
            'raw_qr' => 'cuontp;X;QR-A', 'ke_hoach_id' => 1, 'ke_hoach_hang_id' => 40,
            'group_id' => 50, 'detail_id' => 60, 'end_value' => 100, 'direction' => 1,
            'operation_token' => $this->token(36),
        ])->assertStatus(409)->assertJsonPath('error_code', 'INSUFFICIENT_FULL_STOCK');
        $this->assertSame(0, DB::table('LichSuCat')->count());
        $this->assertSame(0, DB::table('TonCuonLe')->count());
    }
}
