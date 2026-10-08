<?php
namespace Tests\Feature\B3;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Tests\Support\CreatesFactoryFlowSchema;
use Tests\TestCase;

class PlanApiTest extends TestCase
{
    use CreatesFactoryFlowSchema;
    protected function setUp(): void { parent::setUp(); $this->createFactoryFlowSchema(); DB::table('users')->insert(['user_id'=>1,'username'=>'u','password_hash'=>'x','is_active'=>1]); DB::table('DanhSachMaSP')->insert([['id'=>1,'Ten'=>'SP A','Ma'=>'A'],['id'=>2,'Ten'=>'SP B','Ma'=>'B']]); }
    private function user(): User { return User::query()->findOrFail(1); }

    public function test_active_incomplete_plan_and_completed_item_summary_are_returned(): void
    {
        DB::table('KeHoach')->insert(['id'=>1,'MaKeHoach'=>'KH1','NgayKeHoach'=>'2026-10-01','TrangThai'=>'ACTIVE']);
        DB::table('KeHoachHang')->insert([['id'=>10,'KeHoach_ID'=>1,'DanhSachMaSP_ID'=>1,'SoLuongCuonCanLay'=>2,'ChieuDai1Cuon_KeHoach'=>100],['id'=>11,'KeHoach_ID'=>1,'DanhSachMaSP_ID'=>2,'SoLuongCuonCanLay'=>1,'ChieuDai1Cuon_KeHoach'=>100]]);
        DB::table('LichSuLayCuon')->insert(['KeHoachHang_ID'=>11,'TTCuonDay_ID'=>999,'SoLuong'=>1,'NguoiThucHien'=>'u']);
        $this->actingAs($this->user())->getJson('/api/b3/plans')->assertOk()->assertJsonPath('plans.0.ma_ke_hoach','KH1');
        $json=$this->actingAs($this->user())->getJson('/api/b3/plans/1/worklist')->assertOk()->json();
        $this->assertCount(3,$json['rows']);
        $this->assertSame('FULL_TAKE',$json['rows'][0]['row_type']);
        $this->assertSame('COMPLETED_SUMMARY',$json['rows'][2]['row_type']);
        $this->assertSame('Hoàn thành',$json['rows'][2]['tinh_trang']);
    }

    public function test_direct_worklist_for_huy_plan_returns_plan_not_active(): void
    {
        DB::table('KeHoach')->insert(['id'=>9,'MaKeHoach'=>'HUY-DIRECT','NgayKeHoach'=>'2026-10-01','TrangThai'=>'HUY']);
        DB::table('KeHoachHang')->insert(['id'=>90,'KeHoach_ID'=>9,'DanhSachMaSP_ID'=>1,'SoLuongCuonCanLay'=>1,'ChieuDai1Cuon_KeHoach'=>100]);
        $this->actingAs($this->user())->getJson('/api/b3/plans/9/worklist')->assertStatus(409)->assertJsonPath('error_code','PLAN_NOT_ACTIVE');
    }

    public function test_huy_and_fully_completed_plans_are_not_active_worklist(): void
    {
        DB::table('KeHoach')->insert([['id'=>1,'MaKeHoach'=>'DONE','NgayKeHoach'=>'2026-10-01','TrangThai'=>'ACTIVE'],['id'=>2,'MaKeHoach'=>'HUY','NgayKeHoach'=>'2026-10-01','TrangThai'=>'HUY']]);
        DB::table('KeHoachHang')->insert([['id'=>10,'KeHoach_ID'=>1,'DanhSachMaSP_ID'=>1,'SoLuongCuonCanLay'=>1,'ChieuDai1Cuon_KeHoach'=>100],['id'=>20,'KeHoach_ID'=>2,'DanhSachMaSP_ID'=>2,'SoLuongCuonCanLay'=>1,'ChieuDai1Cuon_KeHoach'=>100]]);
        DB::table('LichSuLayCuon')->insert(['KeHoachHang_ID'=>10,'TTCuonDay_ID'=>999,'SoLuong'=>1,'NguoiThucHien'=>'u']);
        $this->actingAs($this->user())->getJson('/api/b3/plans')->assertOk()->assertJsonCount(0,'plans');
    }
}
