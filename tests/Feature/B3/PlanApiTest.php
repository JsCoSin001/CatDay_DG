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

    public static function lotCases(): array
    {
        return [
            'pending whole take' => ['take', false, null],
            'completed whole take' => ['take', true, null],
            'pending partial cut' => ['partial', false, 'cuontp;PARTIAL;400;SOURCE'],
            'completed partial cut' => ['partial', true, 'cuontp;ACTUAL;400;CUT;extra'],
            'pending full cut' => ['full', false, null],
            'completed full cut' => ['full', true, 'cuontp;ACTUAL;400;CUT;extra'],
        ];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('lotCases')]
    public function test_lot_uses_actual_cut_history_for_selected_and_all_plans(
        string $kind, bool $done, ?string $expectedLot
    ): void {
        DB::table('KeHoach')->insert(['id'=>1,'Users_id'=>1,'MaKeHoach'=>'KH1',
            'NgayKeHoach'=>'2026-10-23','TrangThai'=>'ACTIVE']);
        DB::table('KeHoachHang')->insert(['id'=>10,'KeHoach_ID'=>1,'DanhSachMaSP_ID'=>1]);
        DB::table('KeHoachHangQuyCachCuonChan')->insert(['id'=>100,'KeHoachHang_ID'=>10,
            'ChieuDai1Cuon'=>400,'SoLuongCuonCanLay'=>$kind==='take'?1:0]);
        if ($kind === 'take') {
            if ($done) DB::table('LichSuLayCuon')->insert(['KeHoachHang_ID'=>10,
                'QuyCachCuonChan_ID'=>100,'TTCuonDay_ID'=>999,'SoLuong'=>1,'NguoiThucHien'=>'u']);
        } else {
            DB::table('TonCuonLe')->insert(['id'=>70,'MaCuon'=>'cuontp;PARTIAL;400;SOURCE',
                'TTThanhPham_ID'=>1,'TTCuonDay_ID'=>999,'SoDau'=>0,'SoCuoi'=>400]);
            DB::table('KeHoachCatNhom')->insert(['id'=>50,'KeHoachHang_ID'=>10,
                'QuyCachCuonChan_ID'=>100,'TonCuonLe_ID'=>$kind==='partial'?70:null]);
            DB::table('KeHoachCatChiTiet')->insert(['id'=>60,'KeHoachCatNhom_ID'=>50,'ChieuDaiCanCat'=>100]);
            if ($done) DB::table('LichSuCat')->insert(['KeHoachCatChiTiet_ID'=>60,'TonCuonLe_ID'=>70,
                'LoaiNguon'=>$kind==='partial'?'CUON_LE':'CUON_CHAN','ChieuDaiCat'=>100,
                'SoDauTruoc'=>0,'SoCuoiTruoc'=>400,'SoDauCat'=>0,'SoCuoiCat'=>100,
                'SoDauSau'=>100,'SoCuoiSau'=>400,'HeSoChieu'=>1,
                'MaQuetThucTe'=>'cuontp;ACTUAL;400;CUT;extra','NguoiThucHien'=>'u']);
        }
        $this->actingAs($this->user());
        foreach (['/api/b3/plans/1/worklist', '/api/b3/worklist'] as $endpoint) {
            $rows=$this->getJson($endpoint)->assertOk()->json('rows');
            $this->assertCount(1,$rows);
            $this->assertSame($done,$rows[0]['completed']);
            $this->assertSame($expectedLot,$rows[0]['lot']);
            $this->assertSame($done && $kind!=='take'?0:null,$rows[0]['so_dau']);
            $this->assertSame($done && $kind!=='take'?100:null,$rows[0]['so_cuoi']);
        }
    }

    public function test_active_plan_returns_grouped_pending_and_completed_specifications(): void
    {
        DB::table('KeHoach')->insert(['id'=>1,'Users_id' => 1, 'MaKeHoach' =>'KH1','NgayKeHoach'=>'2026-10-01','TrangThai'=>'ACTIVE']);
        DB::table('KeHoachHang')->insert([['id'=>10,'KeHoach_ID'=>1,'DanhSachMaSP_ID'=>1,'SoLuongCuonCanLay'=>2,'ChieuDai1Cuon_KeHoach'=>100],['id'=>11,'KeHoach_ID'=>1,'DanhSachMaSP_ID'=>2,'SoLuongCuonCanLay'=>1,'ChieuDai1Cuon_KeHoach'=>100]]);
        DB::table('KeHoachHangQuyCachCuonChan')->insert([
            ['id'=>100,'KeHoachHang_ID'=>10,'ChieuDai1Cuon'=>100,'SoLuongCuonCanLay'=>2],
            ['id'=>101,'KeHoachHang_ID'=>11,'ChieuDai1Cuon'=>100,'SoLuongCuonCanLay'=>1],
        ]);
        DB::table('LichSuLayCuon')->insert(['KeHoachHang_ID'=>11,'QuyCachCuonChan_ID'=>101,'TTCuonDay_ID'=>999,'SoLuong'=>1,'NguoiThucHien'=>'u']);
        $this->actingAs($this->user())->getJson('/api/b3/plans')->assertOk()->assertJsonPath('plans.0.ma_ke_hoach','KH1');
        $json=$this->actingAs($this->user())->getJson('/api/b3/plans/1/worklist')->assertOk()->json();
        $this->assertCount(2,$json['rows']);
        $this->assertSame('FULL_TAKE',$json['rows'][0]['row_type']);
        $this->assertSame(2,$json['rows'][0]['so_luong_cuon']);
        $this->assertSame('Chưa thực hiện (0/2)',$json['rows'][0]['tinh_trang']);
        $this->assertSame('FULL_TAKE',$json['rows'][1]['row_type']);
        $this->assertSame('Hoàn thành (1/1)',$json['rows'][1]['tinh_trang']);
        $this->assertTrue($json['rows'][1]['completed']);
    }

    public function test_worklist_keeps_lengths_plans_and_partial_reels_separate(): void
    {
        DB::table('KeHoach')->insert([
            ['id'=>1,'Users_id' => 1, 'MaKeHoach' =>'KH1','NgayKeHoach'=>'2026-10-01','TrangThai'=>'ACTIVE'],
            ['id'=>2,'Users_id' => 1, 'MaKeHoach' =>'KH2','NgayKeHoach'=>'2026-10-02','TrangThai'=>'ACTIVE'],
        ]);
        DB::table('KeHoachHang')->insert([
            ['id'=>10,'KeHoach_ID'=>1,'DanhSachMaSP_ID'=>1],
            ['id'=>20,'KeHoach_ID'=>2,'DanhSachMaSP_ID'=>1],
        ]);
        DB::table('KeHoachHangQuyCachCuonChan')->insert([
            ['id'=>100,'KeHoachHang_ID'=>10,'ChieuDai1Cuon'=>500,'SoLuongCuonCanLay'=>12],
            ['id'=>200,'KeHoachHang_ID'=>10,'ChieuDai1Cuon'=>1000,'SoLuongCuonCanLay'=>5],
            ['id'=>300,'KeHoachHang_ID'=>20,'ChieuDai1Cuon'=>500,'SoLuongCuonCanLay'=>7],
        ]);
        DB::table('LichSuLayCuon')->insert([
            ['KeHoachHang_ID'=>10,'QuyCachCuonChan_ID'=>100,'TTCuonDay_ID'=>999,'SoLuong'=>3,'NguoiThucHien'=>'u'],
            ['KeHoachHang_ID'=>10,'QuyCachCuonChan_ID'=>200,'TTCuonDay_ID'=>999,'SoLuong'=>1,'NguoiThucHien'=>'u'],
            ['KeHoachHang_ID'=>20,'QuyCachCuonChan_ID'=>300,'TTCuonDay_ID'=>999,'SoLuong'=>2,'NguoiThucHien'=>'u'],
        ]);
        DB::table('TonCuonLe')->insert([
            ['id'=>101,'MaCuon'=>'LE-01','TTThanhPham_ID'=>1,'TTCuonDay_ID'=>999,'SoDau'=>100,'SoCuoi'=>500],
            ['id'=>102,'MaCuon'=>'LE-02','TTThanhPham_ID'=>1,'TTCuonDay_ID'=>999,'SoDau'=>100,'SoCuoi'=>500],
        ]);
        DB::table('KeHoachCatNhom')->insert([
            ['id'=>1,'KeHoachHang_ID'=>10,'TonCuonLe_ID'=>101],
            ['id'=>2,'KeHoachHang_ID'=>10,'TonCuonLe_ID'=>102],
        ]);
        DB::table('KeHoachCatChiTiet')->insert([
            ['KeHoachCatNhom_ID'=>1,'ChieuDaiCanCat'=>100],
            ['KeHoachCatNhom_ID'=>2,'ChieuDaiCanCat'=>100],
        ]);

        $this->actingAs($this->user());
        $rows = $this->getJson('/api/b3/plans/1/worklist')->assertOk()->json('rows');
        $this->assertCount(4, $rows);
        $this->assertSame([12, 5, null, null], array_column($rows, 'so_luong_cuon'));
        $this->assertSame([500, 1000, null, null], array_column($rows, 'standard_length'));
        $this->assertSame('Đang thực hiện (3/12)', $rows[0]['tinh_trang']);
        $this->assertSame('Đang thực hiện (1/5)', $rows[1]['tinh_trang']);
        $this->assertSame([null, null, 'LE-01', 'LE-02'], array_column($rows, 'lot'));
        $this->assertSame([null, null, null, null], array_column($rows, 'so_dau'));
        $this->assertSame([null, null, null, null], array_column($rows, 'so_cuoi'));

        $allRows = $this->getJson('/api/b3/worklist')->assertOk()->json('rows');
        $this->assertCount(5, $allRows);
        $this->assertSame('KH2', $allRows[0]['ma_ke_hoach']);
        $this->assertSame(7, $allRows[0]['so_luong_cuon']);
        $this->assertSame('Đang thực hiện (2/7)', $allRows[0]['tinh_trang']);
        $this->assertSame('Đang thực hiện (3/12)', $allRows[1]['tinh_trang']);
    }

    public function test_400m_worklist_exposes_each_cut_length_in_selected_and_all_plans(): void
    {
        DB::table('KeHoach')->insert(['id'=>1,'Users_id'=>1,'MaKeHoach'=>'KH001',
            'NgayKeHoach'=>'2026-10-20','TrangThai'=>'ACTIVE']);
        DB::table('KeHoachHang')->insert(['id'=>10,'KeHoach_ID'=>1,'DanhSachMaSP_ID'=>1]);
        DB::table('KeHoachHangQuyCachCuonChan')->insert(['id'=>100,'KeHoachHang_ID'=>10,
            'ChieuDai1Cuon'=>400,'SoLuongCuonCanLay'=>20]);
        DB::table('KeHoachCatNhom')->insert([
            ['id'=>1,'KeHoachHang_ID'=>10,'QuyCachCuonChan_ID'=>100],
            ['id'=>2,'KeHoachHang_ID'=>10,'QuyCachCuonChan_ID'=>100],
        ]);
        DB::table('KeHoachCatChiTiet')->insert([
            ['id'=>1,'KeHoachCatNhom_ID'=>1,'ChieuDaiCanCat'=>70],
            ['id'=>2,'KeHoachCatNhom_ID'=>1,'ChieuDaiCanCat'=>100],
            ['id'=>3,'KeHoachCatNhom_ID'=>2,'ChieuDaiCanCat'=>150],
        ]);
        $this->actingAs($this->user());
        foreach(['/api/b3/plans/1/worklist', '/api/b3/worklist'] as $endpoint){
            $rows=$this->getJson($endpoint)->assertOk()->json('rows');
            $this->assertCount(4,$rows);
            $this->assertSame([400,70,100,150],array_column($rows,'chieu_dai_lay'));
            $this->assertSame([20,null,null,null],array_column($rows,'so_luong_cuon'));
            $this->assertSame([null,1,1,1],array_column($rows,'so_cuon_cat_le'));
            $this->assertSame(['SP A','SP A','SP A','SP A'],array_column($rows,'ten_san_pham'));
        }
    }

    public function test_direct_worklist_for_huy_plan_returns_plan_not_active(): void
    {
        DB::table('KeHoach')->insert(['id'=>9,'Users_id' => 1, 'MaKeHoach' =>'HUY-DIRECT','NgayKeHoach'=>'2026-10-01','TrangThai'=>'HUY']);
        DB::table('KeHoachHang')->insert(['id'=>90,'KeHoach_ID'=>9,'DanhSachMaSP_ID'=>1,'SoLuongCuonCanLay'=>1,'ChieuDai1Cuon_KeHoach'=>100]);
        $this->actingAs($this->user())->getJson('/api/b3/plans/9/worklist')->assertStatus(409)->assertJsonPath('error_code','PLAN_NOT_ACTIVE');
    }

    public function test_huy_and_fully_completed_plans_are_not_active_worklist(): void
    {
        DB::table('KeHoach')->insert([['id'=>1,'Users_id' => 1, 'MaKeHoach' =>'DONE','NgayKeHoach'=>'2026-10-01','TrangThai'=>'ACTIVE'],['id'=>2,'Users_id' => 1, 'MaKeHoach' =>'HUY','NgayKeHoach'=>'2026-10-01','TrangThai'=>'HUY']]);
        DB::table('KeHoachHang')->insert([['id'=>10,'KeHoach_ID'=>1,'DanhSachMaSP_ID'=>1,'SoLuongCuonCanLay'=>1,'ChieuDai1Cuon_KeHoach'=>100],['id'=>20,'KeHoach_ID'=>2,'DanhSachMaSP_ID'=>2,'SoLuongCuonCanLay'=>1,'ChieuDai1Cuon_KeHoach'=>100]]);
        DB::table('KeHoachHangQuyCachCuonChan')->insert([
            ['id'=>100,'KeHoachHang_ID'=>10,'ChieuDai1Cuon'=>100,'SoLuongCuonCanLay'=>1],
            ['id'=>200,'KeHoachHang_ID'=>20,'ChieuDai1Cuon'=>100,'SoLuongCuonCanLay'=>1],
        ]);
        DB::table('LichSuLayCuon')->insert(['KeHoachHang_ID'=>10,'QuyCachCuonChan_ID'=>100,'TTCuonDay_ID'=>999,'SoLuong'=>1,'NguoiThucHien'=>'u']);
        $this->actingAs($this->user())->getJson('/api/b3/plans')->assertOk()->assertJsonCount(0,'plans');
    }
}
