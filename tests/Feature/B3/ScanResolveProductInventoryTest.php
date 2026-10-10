<?php

namespace Tests\Feature\B3;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Tests\Support\CreatesFactoryFlowSchema;
use Tests\TestCase;

class ScanResolveProductInventoryTest extends TestCase
{
    use CreatesFactoryFlowSchema;

    protected function setUp(): void
    {
        parent::setUp();
        $this->createFactoryFlowSchema();
        DB::table('users')->insert(['user_id' => 1, 'username' => 'worker', 'password_hash' => 'x', 'is_active' => 1]);
        DB::table('DanhSachMaSP')->insert(['id' => 1, 'Ten' => 'SP A', 'Ma' => 'A']);
        DB::table('TTThanhPham')->insert([
            ['id' => 10, 'DanhSachSP_ID' => 1, 'MaBin' => 'X', 'NhapKho' => 1, 'Temp' => 0],
            ['id' => 11, 'DanhSachSP_ID' => 1, 'MaBin' => 'Y', 'NhapKho' => 1, 'Temp' => 0],
        ]);
        DB::table('TTNhapKhoTP')->insert([['id' => 20, 'TTThanhPham_ID' => 10], ['id' => 21, 'TTThanhPham_ID' => 11]]);
        DB::table('TTCuonDay')->insert([
            ['id' => 30, 'SoCuon' => 1, 'ChieuDai_1cuon' => 100, 'ThongTinNhapKho_ID' => 20],
            ['id' => 31, 'SoCuon' => 2, 'ChieuDai_1cuon' => 200, 'ThongTinNhapKho_ID' => 21],
        ]);
        DB::table('KeHoach')->insert(['id' => 1, 'MaKeHoach' => 'KH-A', 'NgayKeHoach' => '2026-10-01', 'TrangThai' => 'ACTIVE']);
        DB::table('KeHoachHang')->insert(['id' => 40, 'KeHoach_ID' => 1, 'DanhSachMaSP_ID' => 1, 'SoLuongCuonCanLay' => 1, 'ChieuDai1Cuon_KeHoach' => 100]);
        DB::table('KeHoachCatNhom')->insert(['id' => 50, 'KeHoachHang_ID' => 40]);
        DB::table('KeHoachCatChiTiet')->insert(['id' => 60, 'KeHoachCatNhom_ID' => 50, 'ChieuDaiCanCat' => 40]);
        DB::table('KeHoach')->insert(['id' => 2, 'MaKeHoach' => 'KH-OLD', 'NgayKeHoach' => '2026-01-01', 'TrangThai' => 'HUY']);
        DB::table('KeHoachHang')->insert(['id' => 41, 'KeHoach_ID' => 2, 'DanhSachMaSP_ID' => 1, 'SoLuongCuonCanLay' => 1]);
        DB::table('LichSuLayCuon')->insert(['KeHoachHang_ID' => 41, 'TTCuonDay_ID' => 30, 'SoLuong' => 1, 'NguoiThucHien' => 'worker']);
    }

    private function scan(string $qr)
    {
        return $this->actingAs(User::query()->findOrFail(1))->postJson('/api/b3/scan/resolve', [
            'raw_qr' => $qr, 'ke_hoach_id' => 1,
        ]);
    }

    public function test_exhausted_scanned_mabin_displays_take_but_not_cut(): void
    {
        $response = $this->scan('cuontp;X;QR-A')->assertOk();
        $this->assertSame(['TAKE_WHOLE_REEL'], $response->json('selected_context.available_actions'));
        $this->assertSame(1, $response->json('source.product_id'));
    }

    public function test_cut_action_stays_bound_to_scanned_mabin_and_standard(): void
    {
        DB::table('KeHoachHang')->where('id', 40)->update(['ChieuDai1Cuon_KeHoach' => 200]);
        $response = $this->scan('cuontp;Y;QR-B')->assertOk();
        $this->assertSame(['TAKE_WHOLE_REEL', 'CUT_FULL_REEL'], $response->json('selected_context.available_actions'));
    }

    public function test_plain_full_qr_remains_disallowed(): void
    {
        $this->scan('X')->assertStatus(422)->assertJsonPath('error_code', 'PLAIN_QR_IS_FULL_REEL');
    }

    public function test_when_product_empty_no_take_is_offered(): void
    {
        DB::table('TTCuonDay')->where('id', 31)->update(['SoCuon' => 0]);
        $this->scan('cuontp;X;QR-A')->assertStatus(422)->assertJsonPath('error_code', 'NO_AVAILABLE_ACTION');
    }
}
