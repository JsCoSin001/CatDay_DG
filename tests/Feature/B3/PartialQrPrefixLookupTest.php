<?php

namespace Tests\Feature\B3;

use App\Models\User;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\CreatesFactoryFlowSchema;
use Tests\TestCase;

class PartialQrPrefixLookupTest extends TestCase
{
    use CreatesFactoryFlowSchema;

    protected function setUp(): void
    {
        parent::setUp();
        config(['database.default' => 'sqlite', 'database.connections.sqlite.database' => ':memory:']);
        DB::purge('sqlite');
        $this->createFactoryFlowSchema();
        // These audit/version tables belong to the separate execution-edit SQL migration.
        // The legacy factory-flow test schema does not define them.
        Schema::create('B3ThaoTac', function (Blueprint $t) {
            $t->increments('ThuTu');
            $t->string('MaThaoTac')->unique();
            $t->string('Loai');
            $t->unsignedInteger('LichSu_ID');
            $t->unsignedInteger('KeHoach_ID');
            $t->unsignedInteger('KeHoachHang_ID');
            $t->unsignedInteger('TonCuonLe_ID')->nullable();
            $t->unsignedInteger('TTCuonDay_ID');
            $t->unsignedInteger('QuyCachCuonChan_ID')->nullable();
            $t->text('RawQr');
            $t->unsignedInteger('NguoiGuiGoc_ID');
            $t->string('NguoiGuiGoc');
            $t->string('TrangThai')->default('ACTIVE');
            $t->text('TruocJson');
            $t->text('SauJson');
        });
        Schema::create('B3PhienBanDuLieu', function (Blueprint $t) {
            $t->string('Khoa')->primary();
            $t->unsignedInteger('GiaTri');
        });
        DB::table('B3PhienBanDuLieu')->insert(['Khoa' => 'FACTORY', 'GiaTri' => 0]);

        DB::table('users')->insert(['user_id' => 1, 'username' => 'worker', 'password_hash' => 'x', 'is_active' => 1]);
        DB::table('DanhSachMaSP')->insert(['id' => 1, 'Ten' => 'SP', 'Ma' => 'SP']);
        DB::table('TTThanhPham')->insert([
            'id' => 10, 'DanhSachSP_ID' => 1, 'MaBin' => 'E7-265098/4-01-00', 'NhapKho' => 1, 'Temp' => 0,
        ]);
        DB::table('TTNhapKhoTP')->insert(['id' => 20, 'TTThanhPham_ID' => 10, 'NgayNhapKho' => '2026-10-21']);
        DB::table('TTCuonDay')->insert([
            'id' => 30, 'ThongTinNhapKho_ID' => 20, 'SoCuon' => 1, 'ChieuDai_1cuon' => 800,
        ]);
        DB::table('TonCuonLe')->insert([
            'id' => 70, 'MaCuon' => '123', 'TTThanhPham_ID' => 10, 'TTCuonDay_ID' => 30,
            'SoDau' => 200, 'SoCuoi' => 800, 'TrangThai' => 'ACTIVE',
        ]);
        DB::table('KeHoach')->insert([
            'id' => 1, 'Users_id' => 1, 'MaKeHoach' => 'KH', 'NgayKeHoach' => '2026-10-23', 'TrangThai' => 'ACTIVE',
        ]);
        DB::table('KeHoachHang')->insert(['id' => 40, 'KeHoach_ID' => 1, 'DanhSachMaSP_ID' => 1]);
        DB::table('KeHoachCatNhom')->insert(['id' => 50, 'KeHoachHang_ID' => 40, 'TonCuonLe_ID' => 70]);
        DB::table('KeHoachCatChiTiet')->insert(['id' => 60, 'KeHoachCatNhom_ID' => 50, 'ChieuDaiCanCat' => 100]);
        $this->actingAs(User::query()->findOrFail(1));
    }

    public static function ordinaryQrCases(): array
    {
        return [
            'two parts' => ['123;34'],
            'no separator' => ['123'],
            'trailing separator' => ['123;'],
            'multiple parts' => ['123;34;56'],
            'whitespace around key' => [' 123 ; 34 '],
        ];
    }

    #[DataProvider('ordinaryQrCases')]
    public function test_scan_and_cut_find_existing_partial_by_first_field_and_preserve_scanned_qr(string $qr): void
    {
        $raw = trim($qr);
        $scan = $this->postJson('/api/b3/scan/resolve', [
            'raw_qr' => $qr, 'ke_hoach_id' => 1,
        ])->assertOk()->assertJsonPath('source.source_type', 'CUON_LE')
            ->assertJsonPath('source.ton_cuon_le_id', 70)
            ->assertJsonPath('source.raw_qr', $raw)
            ->assertJsonPath('source.partial.MaCuon', '123')->json();

        $this->postJson('/api/b3/execute/cut', [
            'raw_qr' => $qr, 'ke_hoach_id' => 1, 'ke_hoach_hang_id' => 40,
            'group_id' => 50, 'detail_id' => 60,
            'source_version' => $scan['source_version'],
            'operation_token' => '11111111-1111-4111-8111-111111111111',
        ])->assertOk()->assertJsonPath('cut_session.source.ton_cuon_le_id', 70);

        $this->assertDatabaseHas('TonCuonLe', [
            'id' => 70, 'MaCuon' => '123', 'SoDau' => 200, 'SoCuoi' => 700,
        ]);
        $this->assertDatabaseHas('LichSuCat', [
            'KeHoachCatChiTiet_ID' => 60, 'TonCuonLe_ID' => 70,
            'LoaiNguon' => 'CUON_LE', 'MaQuetThucTe' => $raw,
        ]);
    }

    public function test_cuontp_existing_partial_is_looked_up_by_its_complete_qr(): void
    {
        $fullQr = 'cuontp;265098;800;20261021;202610210959100006';
        DB::table('TonCuonLe')->where('id', 70)->update(['MaCuon' => $fullQr]);
        $this->postJson('/api/b3/scan/resolve', [
            'raw_qr' => $fullQr, 'ke_hoach_id' => 1,
        ])->assertOk()->assertJsonPath('source.source_type', 'CUON_LE')
            ->assertJsonPath('source.ton_cuon_le_id', 70)
            ->assertJsonPath('source.partial.MaCuon', $fullQr);
    }

    public static function missingOrdinaryQrCases(): array
    {
        return [
            'missing key with suffix' => ['999;500', '999'],
            'missing key alone' => ['999', '999'],
            'missing key with trailing separator' => ['999;', '999'],
            'missing key with many parts' => ['999;500;SOMETHING', '999'],
            'missing key with whitespace' => [' 999 ; 500 ', '999'],
        ];
    }

    #[DataProvider('missingOrdinaryQrCases')]
    public function test_missing_ordinary_partial_returns_not_found_not_invalid_format(string $qr, string $key): void
    {
        $this->postJson('/api/b3/scan/resolve', [
            'raw_qr' => $qr, 'ke_hoach_id' => 1,
        ])->assertStatus(404)
            ->assertJsonPath('error_code', 'QR_SOURCE_NOT_FOUND')
            ->assertJsonPath('message', 'Không tìm thấy cuộn lẻ có mã '.$key.'.');
        $this->assertDatabaseCount('LichSuCat', 0);
    }

    public function test_missing_ordinary_partial_does_not_create_cut_history(): void
    {
        $this->postJson('/api/b3/execute/cut', [
            'raw_qr' => '999;500', 'ke_hoach_id' => 1, 'ke_hoach_hang_id' => 40,
            'group_id' => 50, 'detail_id' => 60,
            'operation_token' => '22222222-2222-4222-8222-222222222222',
        ])->assertStatus(404)->assertJsonPath('error_code', 'QR_SOURCE_NOT_FOUND');

        $this->assertDatabaseCount('LichSuCat', 0);
        $this->assertDatabaseHas('TonCuonLe', ['id' => 70, 'MaCuon' => '123', 'SoDau' => 200, 'SoCuoi' => 800]);
    }

    public function test_malformed_cuontp_still_returns_invalid_format(): void
    {
        $this->postJson('/api/b3/scan/resolve', [
            'raw_qr' => 'cuontp;265098;abc', 'ke_hoach_id' => 1,
        ])->assertStatus(422)->assertJsonPath('error_code', 'QR_INVALID_FORMAT');
    }

    public function test_empty_first_field_is_rejected(): void
    {
        $this->postJson('/api/b3/scan/resolve', [
            'raw_qr' => ';123', 'ke_hoach_id' => 1,
        ])->assertStatus(422)->assertJsonPath('error_code', 'QR_INVALID_FORMAT');
        $this->assertDatabaseCount('LichSuCat', 0);
    }
}
