<?php

namespace Tests\Feature\B3;

use App\Models\User;
use App\Repositories\B3\ExecutionRepository;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\DataProvider;
use RuntimeException;
use Tests\Support\CreatesFactoryFlowSchema;
use Tests\TestCase;

class CutMarkerAdjustmentTest extends TestCase
{
    use CreatesFactoryFlowSchema;

    private const QR = 'cuontp;MB001;800;ADJUSTMENT';
    private const TOKEN = '11111111-1111-4111-8111-111111111111';
    private const NEXT_TOKEN = '22222222-2222-4222-8222-222222222222';

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
        DB::table('TTCuonDay')->insert(['id' => 30, 'ThongTinNhapKho_ID' => 20, 'SoCuon' => 1, 'ChieuDai_1cuon' => 800]);
        DB::table('TonCuonLe')->insert(['id' => 70, 'MaCuon' => self::QR, 'TTThanhPham_ID' => 10, 'TTCuonDay_ID' => 30,
            'SoDau' => 200, 'SoCuoi' => 800, 'TrangThai' => 'ACTIVE']);
        DB::table('KeHoach')->insert(['id' => 1, 'Users_id' => 1, 'MaKeHoach' => 'KH', 'NgayKeHoach' => '2026-10-23', 'TrangThai' => 'ACTIVE']);
        DB::table('KeHoachHang')->insert(['id' => 40, 'KeHoach_ID' => 1, 'DanhSachMaSP_ID' => 1]);
        DB::table('KeHoachCatNhom')->insert(['id' => 50, 'KeHoachHang_ID' => 40, 'TonCuonLe_ID' => 70]);
        DB::table('KeHoachCatChiTiet')->insert([
            ['id' => 60, 'KeHoachCatNhom_ID' => 50, 'ChieuDaiCanCat' => 100],
            ['id' => 61, 'KeHoachCatNhom_ID' => 50, 'ChieuDaiCanCat' => 100],
        ]);
        $this->actingAs(User::query()->findOrFail(1));
    }

    private function payload(array $extra = []): array
    {
        return array_replace(['raw_qr' => self::QR, 'ke_hoach_id' => 1, 'ke_hoach_hang_id' => 40,
            'group_id' => 50, 'detail_id' => 60, 'operation_token' => self::TOKEN], $extra);
    }

    private function history(int $detail = 60): array
    {
        return (array) DB::table('LichSuCat')->where('KeHoachCatChiTiet_ID', $detail)->first();
    }

    public static function adjustments(): array
    {
        return [
            'end only' => [900, 1, 300, 800, ['so_cuoi']],
            'direction only' => [800, -1, 1400, 900, ['chieu']],
            'end and direction' => [900, -1, 1500, 1000, ['so_cuoi', 'chieu']],
        ];
    }

    #[DataProvider('adjustments')]
    public function test_records_original_and_confirmed_markers_without_changing_stock_length(
        int $end, int $direction, int $start, int $afterEnd, array $changed
    ): void {
        $this->postJson('/api/b3/execute/cut', $this->payload(['end_value' => $end, 'direction' => $direction]))->assertOk();

        $history = $this->history();
        $this->assertNotNull($history['DieuChinhThongSo']);
        $this->assertSame([
            'phien_ban' => 1,
            'truoc_dieu_chinh' => ['so_dau' => 200, 'so_cuoi' => 800, 'chieu' => 1],
            'sau_dieu_chinh' => ['so_dau' => $start, 'so_cuoi' => $end, 'chieu' => $direction],
            'truong_nguoi_dung_thay_doi' => $changed,
            'so_dau_tinh_lai' => true,
        ], json_decode($history['DieuChinhThongSo'], true, 512, JSON_THROW_ON_ERROR));
        $this->assertSame('worker', $history['NguoiThucHien']);
        $this->assertSame('__B3_OP__:'.self::TOKEN, $history['GhiChu']);
        $this->assertSame([$start, $end, $end, $afterEnd, $start, $afterEnd], [
            $history['SoDauTruoc'], $history['SoCuoiTruoc'], $history['SoDauCat'],
            $history['SoCuoiCat'], $history['SoDauSau'], $history['SoCuoiSau'],
        ]);
        $this->assertDatabaseHas('TonCuonLe', ['id' => 70, 'SoDau' => $start, 'SoCuoi' => $afterEnd]);
        $this->assertSame(500, abs($afterEnd - $start));
        $this->assertDatabaseHas('TTCuonDay', ['id' => 30, 'SoDau' => null, 'SoCuoi' => null]);
    }

    public static function unchangedMarkers(): array
    {
        return [
            'explicit unchanged forward' => [200, 800, ['end_value' => 800, 'direction' => 1]],
            'omitted forward' => [200, 800, []],
            'explicit unchanged reverse' => [800, 200, ['end_value' => 200, 'direction' => -1]],
            'omitted reverse' => [800, 200, []],
        ];
    }

    #[DataProvider('unchangedMarkers')]
    public function test_final_unchanged_or_omitted_markers_do_not_record_adjustment(int $start, int $end, array $markers): void
    {
        DB::table('TonCuonLe')->where('id', 70)->update(['SoDau' => $start, 'SoCuoi' => $end]);
        $this->postJson('/api/b3/execute/cut', $this->payload($markers))->assertOk();
        $this->assertNull($this->history()['DieuChinhThongSo']);
    }

    public function test_reversed_database_direction_is_recorded_and_unchanged_start_is_not_flagged(): void
    {
        DB::table('TonCuonLe')->where('id', 70)->update(['SoDau' => 800, 'SoCuoi' => 200]);
        $this->postJson('/api/b3/execute/cut', $this->payload(['end_value' => 1400, 'direction' => 1]))->assertOk();
        $history = $this->history();
        $this->assertNotNull($history['DieuChinhThongSo']);
        $adjustment = json_decode($history['DieuChinhThongSo'], true, 512, JSON_THROW_ON_ERROR);
        $this->assertSame(['so_dau' => 800, 'so_cuoi' => 200, 'chieu' => -1], $adjustment['truoc_dieu_chinh']);
        $this->assertSame(['so_dau' => 800, 'so_cuoi' => 1400, 'chieu' => 1], $adjustment['sau_dieu_chinh']);
        $this->assertFalse($adjustment['so_dau_tinh_lai']);
        $this->assertSame(['so_cuoi', 'chieu'], $adjustment['truong_nguoi_dung_thay_doi']);
    }

    public function test_initial_full_reel_markers_are_not_an_adjustment(): void
    {
        DB::table('TonCuonLe')->delete();
        DB::table('KeHoachHangQuyCachCuonChan')->insert(['id' => 80, 'KeHoachHang_ID' => 40, 'ChieuDai1Cuon' => 800, 'SoLuongCuonCanLay' => 0]);
        DB::table('KeHoachCatNhom')->where('id', 50)->update(['TonCuonLe_ID' => null, 'QuyCachCuonChan_ID' => 80]);
        $this->postJson('/api/b3/execute/cut', $this->payload(['end_value' => 1000, 'direction' => 1]))->assertOk();
        $history = $this->history();
        $this->assertSame('CUON_CHAN', $history['LoaiNguon']);
        $this->assertNull($history['DieuChinhThongSo']);
        $this->assertSame(200, $history['SoDauTruoc']);
        $this->assertSame(1000, $history['SoCuoiTruoc']);
    }

    public function test_next_cut_and_recovery_preserve_prior_adjustment_without_copying_it(): void
    {
        $state = $this->postJson('/api/b3/execute/cut', $this->payload(['end_value' => 900, 'direction' => 1]))
            ->assertOk()->json('cut_session');
        $first = $this->history();
        $this->assertNotNull($first['DieuChinhThongSo']);

        $this->getJson('/api/b3/cut-session?'.http_build_query($this->payload()))->assertOk()
            ->assertJsonPath('cut_session.operation_status', 'SAVED');
        $this->postJson('/api/b3/execute/cut', $this->payload(['detail_id' => 61,
            'operation_token' => $state['operation_token'], 'source_version' => $state['source_version']]))->assertOk();

        $this->assertSame($first, $this->history());
        $this->assertNull($this->history(61)['DieuChinhThongSo']);
        $this->assertDatabaseHas('TonCuonLe', ['id' => 70, 'SoDau' => 300, 'SoCuoi' => 700]);
    }

    public function test_duplicate_and_stale_requests_do_not_record_another_adjustment(): void
    {
        $scan = $this->postJson('/api/b3/scan/resolve', ['raw_qr' => self::QR, 'ke_hoach_id' => 1])->assertOk()->json();
        $this->assertSame(0, DB::table('LichSuCat')->count());
        $payload = $this->payload(['end_value' => 900, 'direction' => 1, 'source_version' => $scan['source_version']]);
        $this->postJson('/api/b3/execute/cut', $payload)->assertOk();
        $first = $this->history();
        $this->assertNotNull($first['DieuChinhThongSo']);
        $this->postJson('/api/b3/execute/cut', $payload)->assertStatus(409)->assertJsonPath('error_code', 'DUPLICATE_REQUEST');
        $this->postJson('/api/b3/execute/cut', array_replace($payload, ['detail_id' => 61, 'operation_token' => self::NEXT_TOKEN]))
            ->assertStatus(409)->assertJsonPath('error_code', 'SOURCE_STATE_CHANGED');
        $this->assertSame(1, DB::table('LichSuCat')->count());
        $this->assertSame($first, $this->history());
        $this->assertDatabaseHas('TonCuonLe', ['id' => 70, 'SoDau' => 300, 'SoCuoi' => 800]);
    }

    public function test_exhausted_cut_records_adjustment_before_cut_and_sets_empty_status(): void
    {
        DB::table('KeHoachCatChiTiet')->where('id', 61)->delete();
        DB::table('KeHoachCatChiTiet')->where('id', 60)->update(['ChieuDaiCanCat' => 600]);
        $this->postJson('/api/b3/execute/cut', $this->payload(['end_value' => 900, 'direction' => 1]))->assertOk();
        $history = $this->history();
        $this->assertNotNull($history['DieuChinhThongSo']);
        $adjustment = json_decode($history['DieuChinhThongSo'], true, 512, JSON_THROW_ON_ERROR);
        $this->assertSame(['so_dau' => 300, 'so_cuoi' => 900, 'chieu' => 1], $adjustment['sau_dieu_chinh']);
        $this->assertSame(300, $history['SoCuoiSau']);
        $this->assertDatabaseHas('TonCuonLe', ['id' => 70, 'SoDau' => 300, 'SoCuoi' => 300, 'TrangThai' => 'HET']);
    }

    public function test_update_failure_rolls_back_cut_history_and_adjustment(): void
    {
        $this->partialMock(ExecutionRepository::class, function ($mock) {
            $mock->shouldReceive('updatePartial')->once()->andReturnUsing(function () {
                $this->assertSame(1, DB::table('LichSuCat')->whereNotNull('DieuChinhThongSo')->count());
                throw new RuntimeException('Simulated update failure');
            });
        });
        $this->withoutExceptionHandling();
        try {
            $this->postJson('/api/b3/execute/cut', $this->payload(['end_value' => 900, 'direction' => 1]));
            $this->fail('The simulated update failure must propagate.');
        } catch (RuntimeException $error) {
            $this->assertSame('Simulated update failure', $error->getMessage());
        }
        $this->assertSame(0, DB::table('LichSuCat')->count());
        $this->assertDatabaseHas('TonCuonLe', ['id' => 70, 'SoDau' => 200, 'SoCuoi' => 800]);
    }
}
