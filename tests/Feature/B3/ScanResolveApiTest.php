<?php
namespace Tests\Feature\B3;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Tests\Support\CreatesFactoryFlowSchema;
use Tests\TestCase;

class ScanResolveApiTest extends TestCase
{
    use CreatesFactoryFlowSchema;
    protected function setUp(): void
    {
        parent::setUp(); $this->createFactoryFlowSchema();
        DB::table('users')->insert(['user_id'=>1,'username'=>'u','password_hash'=>'x','is_active'=>1]);
        DB::table('DanhSachMaSP')->insert(['id'=>1,'Ten'=>'SP A','Ma'=>'A']);
        DB::table('TTThanhPham')->insert(['id'=>10,'DanhSachSP_ID'=>1,'MaBin'=>'MB001','NhapKho'=>1,'Temp'=>0]);
        DB::table('TTNhapKhoTP')->insert(['id'=>20,'TTThanhPham_ID'=>10,'TenSP'=>'SP A','TongChieuDai'=>200,'GhiChu'=>'','NguoiLam'=>'u','NgayNhapKho'=>'2026-01-01','DateInsert'=>'2026-01-01']);
        DB::table('TTCuonDay')->insert(['id'=>30,'SoCuon'=>2,'ChieuDai_1cuon'=>100,'SoDau'=>null,'SoCuoi'=>null,'ThongTinNhapKho_ID'=>20,'Ngay'=>'2026-01-01','DateInsert'=>'2026-01-01']);
        DB::table('KeHoach')->insert(['id'=>1,'MaKeHoach'=>'KH1','NgayKeHoach'=>'2026-10-01','TrangThai'=>'ACTIVE']);
        DB::table('KeHoachHang')->insert(['id'=>40,'KeHoach_ID'=>1,'DanhSachMaSP_ID'=>1,'SoLuongCuonCanLay'=>1,'ChieuDai1Cuon_KeHoach'=>100]);
    }
    private function user(): User { return User::query()->findOrFail(1); }

    public function test_structured_full_qr_resolves_whole_action(): void
    {
        $this->actingAs($this->user())->postJson('/api/b3/scan/resolve',['raw_qr'=>'cuontp;MB001;QR-A','ke_hoach_id'=>1])->assertOk()->assertJsonPath('selected_context.available_actions.0','TAKE_WHOLE_REEL');
    }
    public function test_plain_mabin_that_is_full_is_rejected(): void
    {
        $this->actingAs($this->user())->postJson('/api/b3/scan/resolve',['raw_qr'=>'MB001','ke_hoach_id'=>1])->assertStatus(422)->assertJsonPath('error_code','PLAIN_QR_IS_FULL_REEL');
    }
    public function test_selected_huy_plan_returns_plan_not_active(): void
    {
        DB::table('KeHoach')->where('id',1)->update(['TrangThai'=>'HUY']);
        $this->actingAs($this->user())->postJson('/api/b3/scan/resolve',['raw_qr'=>'cuontp;MB001;QR-A','ke_hoach_id'=>1])->assertStatus(409)->assertJsonPath('error_code','PLAN_NOT_ACTIVE');
    }

    public function test_multiple_unbound_groups_are_returned_not_auto_selected(): void
    {
        DB::table('KeHoachHang')->where('id',40)->update(['SoLuongCuonCanLay'=>0]);
        DB::table('KeHoachCatNhom')->insert([['id'=>50,'KeHoachHang_ID'=>40],['id'=>51,'KeHoachHang_ID'=>40]]);
        DB::table('KeHoachCatChiTiet')->insert([['id'=>60,'KeHoachCatNhom_ID'=>50,'ChieuDaiCanCat'=>40],['id'=>61,'KeHoachCatNhom_ID'=>51,'ChieuDaiCanCat'=>50]]);
        $j=$this->actingAs($this->user())->postJson('/api/b3/scan/resolve',['raw_qr'=>'cuontp;MB001;QR-A','ke_hoach_id'=>1])->assertOk()->json();
        $this->assertCount(2,$j['selected_context']['groups']);
    }
}
