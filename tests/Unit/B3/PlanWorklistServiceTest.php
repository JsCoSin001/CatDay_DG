<?php
namespace Tests\Unit\B3;
use App\Services\B3\PlanWorklistService;use App\Services\B3\ProgressService;use PHPUnit\Framework\TestCase;
class PlanWorklistServiceTest extends TestCase
{
 public function test_projects_physical_rows_and_completed_summary():void{$svc=new PlanWorklistService(new ProgressService);$state=['plan'=>['id'=>1,'MaKeHoach'=>'KH1'],'complete'=>false,'items'=>[
 ['id'=>10,'product_id'=>1,'product_name'=>'A','whole_required'=>3,'whole_done'=>1,'cut_required'=>0,'cut_done'=>0,'groups'=>[],'complete'=>false],
 ['id'=>11,'product_id'=>2,'product_name'=>'B','whole_required'=>1,'whole_done'=>1,'cut_required'=>0,'cut_done'=>0,'groups'=>[],'complete'=>true],
 ]];$r=$svc->project($state);$this->assertCount(3,$r);$this->assertSame('FULL_TAKE',$r[0]['row_type']);$this->assertSame(1,$r[0]['so_luong_cuon']);$this->assertSame('COMPLETED_SUMMARY',$r[2]['row_type']);$this->assertSame('Hoàn thành',$r[2]['tinh_trang']);}
}
