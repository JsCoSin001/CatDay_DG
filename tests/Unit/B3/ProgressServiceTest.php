<?php
namespace Tests\Unit\B3;
use App\Services\B3\ProgressService;
use PHPUnit\Framework\TestCase;
class ProgressServiceTest extends TestCase
{
    public function test_statuses(): void {$s=new ProgressService;$this->assertSame('Chưa thực hiện',$s->itemProgress(['whole_done'=>0,'whole_required'=>2,'cut_done'=>0,'cut_required'=>1]));$this->assertSame('Đang thực hiện',$s->itemProgress(['whole_done'=>1,'whole_required'=>2,'cut_done'=>0,'cut_required'=>1]));$this->assertSame('Hoàn thành',$s->itemProgress(['whole_done'=>2,'whole_required'=>2,'cut_done'=>1,'cut_required'=>1]));}
}
