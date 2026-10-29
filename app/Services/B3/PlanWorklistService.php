<?php
namespace App\Services\B3;
class PlanWorklistService
{
    public function __construct(private ProgressService $progress) {}
    public function project(array $planState): array
    {
        if(!$planState['plan']) return [];
        $p=$planState['plan']; $rows=[];
        foreach($planState['items'] as $item){
            $status=$this->progress->itemProgress($item);
            $qid=$item['quy_cach_id']??null;
            $wholeRequired=(int)$item['whole_required'];
            $wholeDone=(int)$item['whole_done'];
            if($wholeRequired>0){
                $wholeStatus=$this->progress->itemProgress([
                    'whole_required'=>$wholeRequired,'whole_done'=>$wholeDone]);
                $rows[]=$this->row('FULL_TAKE',$p,$item,$wholeStatus.' ('.$wholeDone.'/'.$wholeRequired.')',[
                    'work_id'=>'whole-'.$item['id'].'-'.$qid,
                    'chieu_dai_lay'=>$item['standard_length']??null,
                    'so_luong_cuon'=>$wholeRequired,'completed'=>$wholeDone >= $wholeRequired]);
            }
            foreach($item['groups'] as $g){
                foreach($g['details'] as $detail){
                    $completed=(int)$detail['done']!==0;
                    $partialId=$g['ton_cuon_le_id'];
                    $type=$completed?'CUT_DONE':($partialId===null?'FULL_CUT':'PARTIAL_CUT');
                    $extra=[
                        'work_id'=>'cut-detail-'.$detail['id'],
                        'group_id'=>$g['id'],'detail_id'=>$detail['id'],
                        'chieu_dai_lay'=>(int)$detail['ChieuDaiCanCat'],
                        'so_cuon_cat_le'=>1,'completed'=>$completed,
                    ];
                    if($partialId!==null){
                        $t=$g['partial']??[];
                        $extra['ton_cuon_le_id']=$partialId;
                        if(!$completed){
                            $extra['lot']=$t['MaCuon']??null;
                            $extra['so_dau']=$t['SoDau']??null;
                            $extra['so_cuoi']=$t['SoCuoi']??null;
                        }
                    }
                    $rows[]=$this->row($type,$p,$item,$completed?'Đã thực hiện':$status,$extra);
                }
            }
        }
        return $rows;
    }
    private function row(string $type,array $p,array $i,string $status,array $extra=[]):array
    {
        return array_merge(['row_type'=>$type,'ke_hoach_id'=>(int)$p['id'],
            'ke_hoach_hang_id'=>$i['id'],'quy_cach_id'=>$i['quy_cach_id']??null,
            'standard_length'=>$i['standard_length']??null,'ma_ke_hoach'=>$p['MaKeHoach'],
            'product_id'=>$i['product_id'],'ten_san_pham'=>$i['product_name'],
            'lot'=>null,'chieu_dai_lay'=>null,'so_luong_cuon'=>null,'so_dau'=>null,'so_cuoi'=>null,
            'so_cuon_cat_le'=>null,'tinh_trang'=>$status],$extra);
    }
}
