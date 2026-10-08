<?php
namespace App\Services\B3;
class ProgressService
{
    public function itemProgress(array $s): string
    {
        $wholeDone=(int)($s['whole_done']??0); $wholeReq=(int)($s['whole_required']??0); $cutDone=(int)($s['cut_done']??0); $cutReq=(int)($s['cut_required']??0);
        if($wholeDone >= $wholeReq && $cutDone >= $cutReq) return 'Hoàn thành';
        if($wholeDone===0 && $cutDone===0) return 'Chưa thực hiện';
        return 'Đang thực hiện';
    }
}
