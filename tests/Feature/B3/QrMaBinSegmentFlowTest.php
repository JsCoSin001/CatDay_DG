<?php

namespace Tests\Feature\B3;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\CreatesFactoryFlowSchema;
use Tests\TestCase;

class QrMaBinSegmentFlowTest extends TestCase
{
    use CreatesFactoryFlowSchema;

    private const QR = 'cuontp;264772;200;202610210933040004;temp1;temp2;temp3';
    private const AMBIGUOUS = 'Mã “264772” đang khớp với nhiều sản phẩm khác nhau. Vui lòng kiểm tra lại mã QR hoặc dữ liệu MaBin.';

    protected function setUp(): void
    {
        parent::setUp();
        config(['database.default' => 'sqlite', 'database.connections.sqlite.database' => ':memory:']);
        DB::purge('sqlite');
        $this->assertSame(':memory:', DB::connection()->getDatabaseName());
        $this->createFactoryFlowSchema();
        DB::table('users')->insert(['user_id' => 58, 'username' => 'catday1', 'password_hash' => 'x', 'is_active' => 1]);
        DB::table('DanhSachMaSP')->insert([
            ['id' => 6784, 'Ten' => 'Dây điện A', 'Ma' => 'A'],
            ['id' => 6785, 'Ten' => 'Dây điện B', 'Ma' => 'B'],
        ]);
        $this->addStock(1, 'E7-264772/4-01-00', '2026-10-19');
        $this->addStock(2, 'E7-264772/4-02-00', '2026-10-18');
        $this->addStock(3, 'E7-999999/4-01-00', '2026-10-01', quantity: 5);
        $this->addStock(4, 'E7-1264772/4-01-00', '2026-10-01', quantity: 5);
        DB::table('KeHoach')->insert(['id' => 1, 'Users_id' => 58, 'MaKeHoach' => 'KH001', 'NgayKeHoach' => '2026-10-21', 'TrangThai' => 'ACTIVE']);
        DB::table('KeHoachHang')->insert(['id' => 40, 'KeHoach_ID' => 1, 'DanhSachMaSP_ID' => 6784]);
        DB::table('KeHoachHangQuyCachCuonChan')->insert(['id' => 80, 'KeHoachHang_ID' => 40, 'ChieuDai1Cuon' => 200, 'SoLuongCuonCanLay' => 2]);
        $this->actingAs(User::query()->findOrFail(58));
    }

    private function addStock(int $id, string $bin, string $date, int $product = 6784, int $length = 200, int $quantity = 1, int $imported = 1, int $temp = 0): void
    {
        DB::table('TTThanhPham')->insert(['id' => $id, 'DanhSachSP_ID' => $product, 'MaBin' => $bin, 'NhapKho' => $imported, 'Temp' => $temp]);
        DB::table('TTNhapKhoTP')->insert(['id' => 100 + $id, 'TTThanhPham_ID' => $id, 'NgayNhapKho' => $date]);
        DB::table('TTCuonDay')->insert(['id' => 300 + $id, 'ThongTinNhapKho_ID' => 100 + $id, 'ChieuDai_1cuon' => $length, 'SoCuon' => $quantity]);
    }

    private function scan(string $qr = self::QR)
    {
        return $this->postJson('/api/b3/scan/resolve', ['raw_qr' => $qr, 'ke_hoach_id' => 1]);
    }

    private function take(string $qr = self::QR, array $overrides = [])
    {
        return $this->postJson('/api/b3/execute/take-whole', array_replace([
            'raw_qr' => $qr, 'ke_hoach_id' => 1, 'ke_hoach_hang_id' => 40,
            'quy_cach_cuon_chan_id' => 80, 'operation_token' => (string) Str::uuid(),
        ], $overrides));
    }

    private function prepareCut(): void
    {
        DB::table('KeHoachHangQuyCachCuonChan')->where('id', 80)->update(['SoLuongCuonCanLay' => 0]);
        DB::table('KeHoachCatNhom')->insert(['id' => 50, 'KeHoachHang_ID' => 40, 'QuyCachCuonChan_ID' => 80]);
        DB::table('KeHoachCatChiTiet')->insert([
            ['id' => 60, 'KeHoachCatNhom_ID' => 50, 'ChieuDaiCanCat' => 70],
            ['id' => 61, 'KeHoachCatNhom_ID' => 50, 'ChieuDaiCanCat' => 100],
        ]);
    }

    private function cut(string $qr = self::QR, int $detail = 60)
    {
        return $this->postJson('/api/b3/execute/cut', [
            'raw_qr' => $qr, 'ke_hoach_id' => 1, 'ke_hoach_hang_id' => 40,
            'group_id' => 50, 'detail_id' => $detail, 'end_value' => $detail === 60 ? 200 : 130,
            'direction' => 1, 'operation_token' => (string) Str::uuid(),
        ]);
    }

    public static function validQrShapes(): array
    {
        return [
            'required fields only' => ['cuontp;264772;200'],
            'four fields' => ['cuontp;264772;200;TEM1'],
            'additional fields' => [self::QR],
            'empty extra fields' => ['cuontp;264772;200;;;;'],
            'trimmed fields and case insensitive prefix' => [' CUONTP ; 264772 ; 200 ; TEM1 '],
        ];
    }

    #[DataProvider('validQrShapes')]
    public function test_scan_accepts_variable_components_and_resolves_one_product(string $qr): void
    {
        $this->scan($qr)->assertOk()
            ->assertJsonPath('source.raw_qr', trim($qr))
            ->assertJsonPath('source.product_id', 6784)
            ->assertJsonPath('source.chieu_dai_1cuon', 200)
            ->assertJsonPath('selected_context.item.product_name', 'Dây điện A')
            ->assertJsonPath('selected_context.available_actions.0', 'TAKE_WHOLE_REEL')
            ->assertJsonCount(1, 'candidate_contexts');
        $this->assertSame(0, DB::table('LichSuLayCuon')->count());
    }

    public static function invalidQrShapes(): array
    {
        return [
            ['other;264772;200;T'], ['cuontp;;200;T'], ['cuontp;264772'],
            ['cuontp;264772;;T'], ['cuontp;264772;0;T'], ['cuontp;264772;-200;T'],
            ['cuontp;264772;200.5;T'], ['cuontp;264772;2147483648;T'],
        ];
    }

    #[DataProvider('invalidQrShapes')]
    public function test_invalid_required_fields_are_rejected(string $qr): void
    {
        $this->scan($qr)->assertStatus(422)->assertJsonPath('error_code', 'QR_INVALID_FORMAT');
    }

    public function test_matching_is_delimited_and_never_uses_full_mabin_as_a_legacy_fallback(): void
    {
        foreach (['26477', '64772', 'E7-264772/4-01-00', '26477%', '26477_'] as $token) {
            $this->scan('cuontp;'.$token.';200;TEM')->assertNotFound()->assertJsonPath('error_code', 'QR_SOURCE_NOT_FOUND');
        }
    }

    public function test_ambiguity_is_detected_before_length_or_plan_filtering(): void
    {
        $this->addStock(5, 'E8-264772/4-03-00', '2026-10-17', product: 6785, length: 400);
        $this->scan()->assertStatus(409)->assertJsonPath('error_code', 'QR_PRODUCT_AMBIGUOUS')->assertJsonPath('message', self::AMBIGUOUS);
        $this->take()->assertStatus(409)->assertJsonPath('error_code', 'QR_PRODUCT_AMBIGUOUS');
        $this->assertSame(0, DB::table('LichSuLayCuon')->count());
        $this->assertSame(0, DB::table('B3QrSuDung')->count());
    }

    public function test_unimported_temporary_and_partial_sources_are_not_full_candidates(): void
    {
        $this->addStock(5, 'E8-264772/4-03-00', '2026-10-01', product: 6785, imported: 0);
        $this->addStock(6, 'E8-264772/4-04-00', '2026-10-01', product: 6785, temp: 1);
        $this->addStock(7, 'E8-264772/4-05-00', '2026-10-01', product: 6785);
        DB::table('TTCuonDay')->where('id', 307)->update(['SoDau' => 0, 'SoCuoi' => 200]);
        $this->scan()->assertOk()->assertJsonPath('source.product_id', 6784);
        $this->take()->assertOk();
        $this->assertDatabaseHas('LichSuLayCuon', ['TTCuonDay_ID' => 302]);
    }

    public function test_take_consumes_fifo_across_matching_bins_and_preserves_raw_qr_identity(): void
    {
        $this->take()->assertOk();
        $this->assertDatabaseHas('LichSuLayCuon', ['TTCuonDay_ID' => 302, 'NguoiThucHien' => 'catday1']);
        $this->assertDatabaseHas('B3QrSuDung', ['RawQr' => self::QR, 'TrangThai' => 'DA_LAY_NGUYEN']);
        $this->take()->assertStatus(409)->assertJsonPath('error_code', 'QR_ALREADY_USED');
        $this->take(self::QR.';another-temp')->assertOk();
        $this->assertDatabaseHas('LichSuLayCuon', ['TTCuonDay_ID' => 301]);
        $this->assertSame(2, DB::table('LichSuLayCuon')->count());
        $this->assertSame(2, DB::table('B3QrSuDung')->count());
        $this->assertDatabaseMissing('LichSuLayCuon', ['TTCuonDay_ID' => 303]);
        $this->assertDatabaseMissing('LichSuLayCuon', ['TTCuonDay_ID' => 304]);
    }

    public function test_length_from_third_field_filters_scan_and_save(): void
    {
        $this->addStock(5, 'E7-264772/4-03-00', '2026-10-01', length: 400);
        $this->take('cuontp;264772;400;TEM')->assertStatus(409);
        $this->take()->assertOk();
        $this->assertDatabaseHas('LichSuLayCuon', ['TTCuonDay_ID' => 302]);
        $this->assertDatabaseMissing('LichSuLayCuon', ['TTCuonDay_ID' => 305]);
        DB::table('TTCuonDay')->whereIn('id', [301, 302])->update(['SoCuon' => 0]);
        $this->scan(self::QR.';new')->assertStatus(422)->assertJsonPath('error_code', 'NO_AVAILABLE_ACTION');
    }

    public function test_fifo_ties_use_source_id_and_exhausted_matching_sources_cannot_use_other_bins(): void
    {
        DB::table('TTNhapKhoTP')->where('id', 101)->update(['NgayNhapKho' => '2026-10-18']);
        $this->take()->assertOk();
        $this->assertDatabaseHas('LichSuLayCuon', ['TTCuonDay_ID' => 301]);
        DB::table('TTCuonDay')->where('id', 302)->update(['SoCuon' => 0]);
        $this->take(self::QR.';next')->assertStatus(409)->assertJsonPath('error_code', 'INSUFFICIENT_FULL_STOCK');
        $this->assertSame(1, DB::table('LichSuLayCuon')->count());
    }

    public function test_save_rechecks_ambiguity_after_a_successful_scan(): void
    {
        $this->scan()->assertOk();
        $this->addStock(5, 'E8-264772/4-03-00', '2026-10-01', product: 6785);
        $this->take()->assertStatus(409)->assertJsonPath('message', self::AMBIGUOUS);
        $this->assertSame(0, DB::table('LichSuLayCuon')->count());
    }

    public function test_cut_uses_matching_fifo_then_exact_partial_qr_for_remaining_cuts(): void
    {
        $this->prepareCut();
        $this->scan()->assertOk()->assertJsonPath('selected_context.available_actions.0', 'CUT_FULL_REEL');
        $this->cut()->assertOk();
        $this->assertDatabaseHas('TonCuonLe', ['MaCuon' => self::QR, 'TTThanhPham_ID' => 2, 'TTCuonDay_ID' => 302, 'SoDau' => 0, 'SoCuoi' => 130]);
        $this->assertDatabaseHas('LichSuCat', ['KeHoachCatChiTiet_ID' => 60, 'LoaiNguon' => 'CUON_CHAN', 'MaQuetThucTe' => self::QR]);
        $this->scan()->assertOk()->assertJsonPath('source.source_type', 'CUON_LE');
        $this->cut(detail: 61)->assertOk();
        $this->assertDatabaseHas('TonCuonLe', ['MaCuon' => self::QR, 'SoDau' => 0, 'SoCuoi' => 30]);
        $this->assertDatabaseHas('LichSuCat', ['KeHoachCatChiTiet_ID' => 61, 'LoaiNguon' => 'CUON_LE']);
        $this->assertSame(1, DB::table('TonCuonLe')->count());
        $this->assertSame(1, DB::table('B3QrSuDung')->count());
    }

    public function test_cut_rejects_ambiguity_without_any_write(): void
    {
        $this->prepareCut();
        $this->addStock(5, 'E8-264772/4-03-00', '2026-10-01', product: 6785);
        $this->cut()->assertStatus(409)->assertJsonPath('error_code', 'QR_PRODUCT_AMBIGUOUS');
        $this->assertSame(0, DB::table('LichSuCat')->count());
        $this->assertSame(0, DB::table('TonCuonLe')->count());
        $this->assertSame(0, DB::table('B3QrSuDung')->count());
    }

    public function test_cut_cannot_consume_nonmatching_stock_after_matching_stock_is_exhausted(): void
    {
        $this->prepareCut();
        DB::table('TTCuonDay')->whereIn('id', [301, 302])->update(['SoCuon' => 0]);
        $this->cut()->assertStatus(409)->assertJsonPath('error_code', 'QR_SOURCE_NOT_USABLE');
        $this->assertSame(0, DB::table('LichSuCat')->count());
        $this->assertSame(0, DB::table('TonCuonLe')->count());
    }
}
