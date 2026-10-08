<?php
namespace App\Services\B3;
class PlanWorklistService
{
    public function __construct(private ProgressService $progress) {}
    public function project(array $planState): array
    {
        if(!$planState['plan'] || $planState['complete']) return [];
        $p=$planState['plan']; $rows=[];
        foreach($planState['items'] as $item){
            $status=$this->progress->itemProgress($item);
            if($item['complete']){
                $rows[]=$this->row('COMPLETED_SUMMARY',$p,$item,$status);
                continue;
            }
            $remaining=max(0,$item['whole_required']-$item['whole_done']);
            for($i=0;$i<$remaining;$i++) $rows[]=$this->row('FULL_TAKE',$p,$item,$status,['so_luong_cuon'=>1]);
            $partialSeen=[];
            foreach($item['groups'] as $g){
                $unfinished=array_filter($g['details'],fn($d)=>(int)$d['done']===0);
                if(!$unfinished) continue;
                if($g['ton_cuon_le_id']===null){
                    $rows[]=$this->row('FULL_CUT',$p,$item,$status,['so_cuon_cat_le'=>1,'group_id'=>$g['id']]);
                } else if(!isset($partialSeen[$g['ton_cuon_le_id']])){
                    $partialSeen[$g['ton_cuon_le_id']]=true; $t=$g['partial']??[];
                    $rows[]=$this->row('PARTIAL_CUT',$p,$item,$status,['ton_cuon_le_id'=>$g['ton_cuon_le_id'],'lot'=>$t['MaCuon']??null,'so_dau'=>$t['SoDau']??null,'so_cuoi'=>$t['SoCuoi']??null,'so_cuon_cat_le'=>1]);
                }
            }
        }
        return $rows;
    }
    private function row(string $type,array $p,array $i,string $status,array $extra=[]):array
    {return array_merge(['row_type'=>$type,'ke_hoach_id'=>(int)$p['id'],'ke_hoach_hang_id'=>$i['id'],'ma_ke_hoach'=>$p['MaKeHoach'],'product_id'=>$i['product_id'],'ten_san_pham'=>$i['product_name'],'lot'=>null,'so_luong_cuon'=>null,'so_dau'=>null,'so_cuoi'=>null,'so_cuon_cat_le'=>null,'tinh_trang'=>$status],$extra);}
}
