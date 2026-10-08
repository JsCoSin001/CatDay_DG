<?php
namespace Tests\Unit\B3;
use App\Services\B3\CutCalculator;
use App\Support\B3\B3Exception;
use PHPUnit\Framework\TestCase;
class CutCalculatorTest extends TestCase
{
    public function test_first_cut_thuan_keeps_current_ui_value_math(): void { $r=(new CutCalculator)->firstCut(1800,500,2500,1); $this->assertSame(700,$r['soDauTruoc']); $this->assertSame(2000,$r['soCuoiSau']); $this->assertSame(1,$r['heSoChieu']); }
    public function test_first_cut_nghich(): void { $r=(new CutCalculator)->firstCut(1600,450,1000,-1); $this->assertSame(2600,$r['soDauTruoc']); $this->assertSame(1450,$r['soCuoiSau']); $this->assertSame(-1,$r['heSoChieu']); }
    public function test_partial_cut_derives_direction(): void { $r=(new CutCalculator)->partialCut(100,600,500); $this->assertSame(100,$r['soCuoiSau']); $this->assertSame(0,$r['remainingLength']); }
    public function test_partial_cut_rejects_insufficient_length(): void { $this->expectException(B3Exception::class); (new CutCalculator)->partialCut(100,500,600); }
    public function test_first_cut_rejects_when_any_computed_marker_is_negative(): void { $this->expectException(B3Exception::class); (new CutCalculator)->firstCut(100,20,50,1); }
    public function test_partial_cut_rejects_negative_current_marker(): void { $this->expectException(B3Exception::class); (new CutCalculator)->partialCut(-10,100,20); }
}
