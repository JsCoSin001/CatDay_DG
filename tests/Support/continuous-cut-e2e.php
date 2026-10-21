<?php

// CLI-only fixture. Refuse every database except the dedicated temporary E2E file.
if (PHP_SAPI !== 'cli') exit(1);
require dirname(__DIR__, 2).'/vendor/autoload.php';
$app = require dirname(__DIR__, 2).'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$path = Illuminate\Support\Facades\DB::connection()->getDatabaseName();
$expected = getenv('B3_E2E_DB');
if (!$expected || !str_starts_with(basename(dirname($expected)), 'catday-cut-e2e-')
    || realpath($path) !== realpath($expected)) throw new RuntimeException('Refusing non-E2E database');

if (($argv[1] ?? '') === 'inspect') {
    echo json_encode([
        'partials' => Illuminate\Support\Facades\DB::table('TonCuonLe')->get()->all(),
        'history' => Illuminate\Support\Facades\DB::table('LichSuCat')->orderBy('id')->get()->all(),
    ], JSON_THROW_ON_ERROR);
    exit;
}
if (($argv[1] ?? '') !== 'seed') throw new RuntimeException('Expected seed or inspect');
$fixture = new class {
    use Tests\Support\CreatesFactoryFlowSchema;
    public function seed(): void
    {
        $this->createFactoryFlowSchema();
        $db = Illuminate\Support\Facades\DB::class;
        $db::table('users')->insert(['user_id' => 58, 'username' => 'worker-e2e', 'password_hash' => password_hash('E2e-only-Password', PASSWORD_DEFAULT), 'is_active' => 1]);
        $db::table('DanhSachMaSP')->insert(['id' => 6784, 'Ten' => 'Dây điện E2E', 'Ma' => 'E2E']);
        $db::table('TTThanhPham')->insert(['id' => 10, 'DanhSachSP_ID' => 6784, 'MaBin' => 'E7-264772/4-01-00', 'NhapKho' => 1, 'Temp' => 0]);
        $db::table('TTNhapKhoTP')->insert(['id' => 20, 'TTThanhPham_ID' => 10, 'NgayNhapKho' => '2026-10-21']);
        $db::table('TTCuonDay')->insert(['id' => 30, 'ThongTinNhapKho_ID' => 20, 'ChieuDai_1cuon' => 500, 'SoCuon' => 1]);
        $db::table('KeHoach')->insert(['id' => 1, 'Users_id' => 58, 'MaKeHoach' => 'KH-E2E', 'NgayKeHoach' => '2026-10-21', 'TrangThai' => 'ACTIVE']);
        $db::table('KeHoachHang')->insert(['id' => 40, 'KeHoach_ID' => 1, 'DanhSachMaSP_ID' => 6784]);
        $db::table('KeHoachHangQuyCachCuonChan')->insert(['id' => 80, 'KeHoachHang_ID' => 40, 'ChieuDai1Cuon' => 500, 'SoLuongCuonCanLay' => 0]);
        $db::table('KeHoachCatNhom')->insert(['id' => 50, 'KeHoachHang_ID' => 40, 'QuyCachCuonChan_ID' => 80]);
        foreach ([100, 150, 50, 25] as $i => $length) {
            $db::table('KeHoachCatChiTiet')->insert(['id' => 60 + $i, 'KeHoachCatNhom_ID' => 50, 'ChieuDaiCanCat' => $length]);
        }
    }
};
$fixture->seed();
echo 'E2E fixture ready';
