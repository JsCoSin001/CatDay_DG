<?php
namespace Tests\Feature\B3;

use Illuminate\Support\Facades\DB;
use Tests\TestCase;
use Tests\Support\CreatesFactoryFlowSchema;
use App\Models\User;

/** Targeted regression for the canonical product+length plan / scanned-bin execution contract. */
class MultiLengthFlowTest extends TestCase
{
    use CreatesFactoryFlowSchema;

    protected function setUp(): void
    {
        parent::setUp();
        $this->createFactoryFlowSchema();
        DB::table('users')->insert(['user_id'=>1,'username'=>'worker','password_hash'=>'x','is_active'=>1]);
        DB::table('DanhSachMaSP')->insert(['id'=>1,'Ten'=>'A','Ma'=>'A']);
        DB::table('TTThanhPham')->insert(['id'=>10,'DanhSachSP_ID'=>1,'MaBin'=>'E7-Bin1/4-01-00','NhapKho'=>1,'Temp'=>0]);
        DB::table('TTNhapKhoTP')->insert(['id'=>20,'TTThanhPham_ID'=>10,'NgayNhapKho'=>'2026-10-12']);
        DB::table('TTCuonDay')->insert([
            ['id'=>30,'ThongTinNhapKho_ID'=>20,'ChieuDai_1cuon'=>100,'SoCuon'=>4,'Ngay'=>'2026-10-12'],
            ['id'=>31,'ThongTinNhapKho_ID'=>20,'ChieuDai_1cuon'=>200,'SoCuon'=>5,'Ngay'=>'2026-10-12'],
        ]);
        DB::table('KeHoach')->insert(['id'=>1,'Users_id' => 1, 'MaKeHoach' =>'KH001','NgayKeHoach'=>'2026-10-12','TrangThai'=>'ACTIVE']);
        DB::table('KeHoachHang')->insert(['id'=>40,'KeHoach_ID'=>1,'DanhSachMaSP_ID'=>1,'SoLuongCuonCanLay'=>0]);
        DB::table('KeHoachHangQuyCachCuonChan')->insert([
            ['id'=>100,'KeHoachHang_ID'=>40,'ChieuDai1Cuon'=>100,'SoLuongCuonCanLay'=>1],
            ['id'=>200,'KeHoachHang_ID'=>40,'ChieuDai1Cuon'=>200,'SoLuongCuonCanLay'=>2],
        ]);
    }

    private function payload(string $qr, int $qc, string $token): array
    {
        return ['raw_qr'=>$qr,'ke_hoach_id'=>1,'ke_hoach_hang_id'=>40,
            'quy_cach_cuon_chan_id'=>$qc,'operation_token'=>$token];
    }

    public function test_take_200_consumes_200_and_cannot_repeat_exact_qr(): void
    {
        $this->actingAs(User::where('username','worker')->first());
        $qr='cuontp;Bin1;200;NEW001';
        $this->postJson('/api/b3/execute/take-whole', $this->payload($qr,200,'11111111-1111-4111-8111-111111111111'))
            ->assertOk();
        $this->assertDatabaseHas('LichSuLayCuon',[
            'KeHoachHang_ID'=>40,'QuyCachCuonChan_ID'=>200,'TTCuonDay_ID'=>31,'SoLuong'=>1]);
        $this->assertDatabaseHas('B3QrSuDung',['RawQr'=>$qr,'TrangThai'=>'DA_LAY_NGUYEN']);
        $this->postJson('/api/b3/execute/take-whole', $this->payload($qr,200,'22222222-2222-4222-8222-222222222222'))
            ->assertStatus(409)->assertJsonPath('error_code','QR_ALREADY_USED');
        $this->assertSame(1,DB::table('LichSuLayCuon')->count());
    }

    public function test_100_qr_cannot_complete_200_requirement(): void
    {
        $this->actingAs(User::where('username','worker')->first());
        $this->postJson('/api/b3/execute/take-whole',
            $this->payload('cuontp;Bin1;100;NEW002',200,'33333333-3333-4333-8333-333333333333'))
            ->assertStatus(409);
        $this->assertSame(0,DB::table('LichSuLayCuon')->count());
    }

    public function test_grouped_workline_updates_progress_and_remains_visible_after_completion(): void
    {
        $this->actingAs(User::where('username','worker')->first());
        $this->postJson('/api/b3/execute/take-whole',
            $this->payload('cuontp;Bin1;200;NEW003',200,'44444444-4444-4444-8444-444444444444'))
            ->assertOk();
        $data=$this->getJson('/api/b3/plans/1/worklist')->assertOk()->json();
        $this->assertCount(2,$data['rows']);
        $row200=array_values(array_filter($data['rows'],fn($r)=>$r['standard_length']===200))[0];
        $this->assertSame(2,$row200['so_luong_cuon']);
        $this->assertSame('Đang thực hiện (1/2)',$row200['tinh_trang']);
        $this->assertFalse($row200['completed']);

        $this->postJson('/api/b3/execute/take-whole',
            $this->payload('cuontp;Bin1;200;NEW008',200,'99999999-9999-4999-8999-999999999999'))
            ->assertOk();
        $data=$this->getJson('/api/b3/plans/1/worklist')->assertOk()->json();
        $this->assertCount(2,$data['rows']);
        $completed=array_values(array_filter($data['rows'],fn($r)=>($r['completed']??false)===true));
        $this->assertCount(1,$completed);
        $this->assertSame(200,$completed[0]['standard_length']);
        $this->assertSame($row200['work_id'],$completed[0]['work_id']);
        $this->assertSame(2,$completed[0]['so_luong_cuon']);
        $this->assertSame('Hoàn thành (2/2)',$completed[0]['tinh_trang']);
    }

    public function test_full_take_is_allocated_only_from_scanned_bin(): void
    {
        DB::table('TTThanhPham')->insert(['id'=>11,'DanhSachSP_ID'=>1,'MaBin'=>'E7-Bin2/4-01-00','NhapKho'=>1,'Temp'=>0]);
        DB::table('TTNhapKhoTP')->insert(['id'=>21,'TTThanhPham_ID'=>11,'NgayNhapKho'=>'2026-10-11']);
        DB::table('TTCuonDay')->insert(['id'=>32,'ThongTinNhapKho_ID'=>21,'ChieuDai_1cuon'=>200,'SoCuon'=>3,'Ngay'=>'2026-10-11']);
        $this->actingAs(User::where('username','worker')->first());
        $this->postJson('/api/b3/execute/take-whole',
            $this->payload('cuontp;Bin2;200;NEW004',200,'55555555-5555-4555-8555-555555555555'))
            ->assertOk();
        $this->assertDatabaseHas('LichSuLayCuon',['QuyCachCuonChan_ID'=>200,'TTCuonDay_ID'=>32,'SoLuong'=>1]);
        $this->assertDatabaseMissing('LichSuLayCuon',['TTCuonDay_ID'=>31]);
    }

    public function test_all_worklist_keeps_completed_rows_even_when_plan_is_finished(): void
    {
        $this->actingAs(User::where('username','worker')->first());
        $this->postJson('/api/b3/execute/take-whole',
            $this->payload('cuontp;Bin1;100;NEW005',100,'66666666-6666-4666-8666-666666666666'))->assertOk();
        $this->postJson('/api/b3/execute/take-whole',
            $this->payload('cuontp;Bin1;200;NEW006',200,'77777777-7777-4777-8777-777777777777'))->assertOk();
        $this->postJson('/api/b3/execute/take-whole',
            $this->payload('cuontp;Bin1;200;NEW007',200,'88888888-8888-4888-8888-888888888888'))->assertOk();
        $rows=$this->getJson('/api/b3/worklist')->assertOk()->json('rows');
        $mine=array_values(array_filter($rows??[],fn($r)=>(int)($r['ke_hoach_id']??0)===1));
        $this->assertCount(2,$mine);
        $this->assertSame([1,2],array_column($mine,'so_luong_cuon'));
        $this->assertSame(['Hoàn thành (1/1)','Hoàn thành (2/2)'],array_column($mine,'tinh_trang'));
        foreach($mine as $row)$this->assertTrue((bool)$row['completed']);
    }

}
