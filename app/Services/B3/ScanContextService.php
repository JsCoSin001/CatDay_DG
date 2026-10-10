<?php
namespace App\Services\B3;

use App\Repositories\B3\InventoryRepository;
use App\Repositories\B3\PlanRepository;
use App\Support\B3\B3Exception;
use Illuminate\Support\Str;

class ScanContextService
{
    public function __construct(private QrResolver $qr, private PlanRepository $plans, private InventoryRepository $inventory) {}

    public function resolve(string $rawQr, ?int $planId): array
    {
        // Resolve exhausted full-reel MaBin for product identity. CUT eligibility
        // still depends on the scanned MaBin and the planned standard length.
        $source=$this->qr->resolve($rawQr, true);
        if($planId){
            $state=$this->plans->loadPlanState($planId);
            if(!$state['plan']) throw B3Exception::make('PLAN_NOT_FOUND','Không tìm thấy kế hoạch.',404);
            if(($state['plan']['TrangThai']??null)!=='ACTIVE') throw B3Exception::make('PLAN_NOT_ACTIVE','Kế hoạch không còn hiệu lực.',409);
            $states=[$planId=>$state];
        }else{
            $active=$this->plans->activeIncompletePlans();
            $states=$this->plans->loadPlanStates(array_column($active,'id'));
        }

        $candidate=[];
        $fullEligibilityCache = [];
        $takeEligibilityCache = [];
        $takeInventoryError = null;
        $matchedProduct = false;
        $matchedPartialWithoutGroup = false;
        foreach($states as $state){
            if(!$state['plan'] || $state['complete'] || ($state['plan']['TrangThai']??'')!=='ACTIVE') continue;
            foreach($state['items'] as $item){
                if($item['product_id']!==$source['product_id']) continue;
                $matchedProduct = true;
                if($item['complete']) continue;

                $groups=$this->groupsForSource($item,$source);
                if($source['source_type']==='CUON_LE' && count($groups)===0) $matchedPartialWithoutGroup = true;
                $actions=[];
                if($source['source_type']==='CUON_CHAN'){
                    $std=(int)($item['standard_length']??0);
                    $cacheKey=$item['product_id'].'|'.$std.'|'.(string)$source['ma_bin'];
                    if(!array_key_exists($cacheKey,$fullEligibilityCache)){
                        $fullEligibilityCache[$cacheKey]=$std>0 && $this->inventory->fullActualForMaBin((string)$source['ma_bin'],$item['product_id'],$std)>0;
                    }
                    $scannedEligible=$fullEligibilityCache[$cacheKey];
                    if(max(0,$item['whole_required']-$item['whole_done'])>0){
                        $productId=$item['product_id'];
                        if(!array_key_exists($productId,$takeEligibilityCache)){
                            try {
                                $sources=$this->inventory->eligibleFullSourcesForTake($productId);
                                $actual=array_sum(array_column($sources,'remaining'));
                                $reserved=$this->inventory->fullReservedForProduct($productId);
                                $takeEligibilityCache[$productId]=$actual>0 && $actual>=$reserved;
                            } catch (B3Exception $error) {
                                // Malformed TAKE inventory must not hide an otherwise valid CUT action.
                                $takeInventoryError=$error;
                                $takeEligibilityCache[$productId]=false;
                            }
                        }
                        if($takeEligibilityCache[$productId]) $actions[]='TAKE_WHOLE_REEL';
                    }
                    if($scannedEligible && count($groups)>0) $actions[]='CUT_FULL_REEL';
                }elseif(count($groups)>0){
                    $actions[]='CUT_PARTIAL_REEL';
                }
                if(!$actions) continue;
                $candidate[]=['plan'=>['id'=>(int)$state['plan']['id'],'ma_ke_hoach'=>$state['plan']['MaKeHoach']],'item'=>$item,'available_actions'=>$actions,'groups'=>$groups];
            }
        }
        if(!$candidate){
            if($takeInventoryError) throw $takeInventoryError;
            if($matchedPartialWithoutGroup) throw B3Exception::make('NO_ELIGIBLE_GROUP','Không còn nhóm cắt phù hợp với cuộn này.',422);
            if($matchedProduct) throw B3Exception::make('NO_AVAILABLE_ACTION','Sản phẩm này không còn công việc phù hợp cần thực hiện.',422);
            throw B3Exception::make($planId?'QR_NOT_IN_PLAN':'NO_MATCHING_PLAN',$planId?'Sản phẩm quét không thuộc kế hoạch đang thực hiện.':'Không có kế hoạch phù hợp với sản phẩm vừa quét.',422);
        }
        return ['source'=>$source,'candidate_contexts'=>$candidate,'selected_context'=>count($candidate)===1?$candidate[0]:null,'operation_token'=>(string)Str::uuid()];
    }

    private function groupsForSource(array $item,array $source): array
    {
        $out=[];
        $actualPartial=$source['source_type']==='CUON_LE'?abs((int)$source['partial']['SoCuoi']-(int)$source['partial']['SoDau']):null;
        $std=(int)($item['standard_length']??0);
        foreach($item['groups'] as $g){
            $unfinished=array_values(array_filter($g['details'],fn($d)=>(int)$d['done']===0));
            if(!$unfinished) continue;
            if($source['source_type']==='CUON_CHAN'){
                if($g['ton_cuon_le_id']!==null) continue;
                if($std<=0 || array_sum(array_column($unfinished,'ChieuDaiCanCat'))>$std) continue;
                if(count($unfinished)===1 && (int)$unfinished[0]['ChieuDaiCanCat']===$std) continue;
            }else{
                if((int)($g['ton_cuon_le_id']??0)!==(int)$source['ton_cuon_le_id']) continue;
            }
            $details=array_map(function($d)use($actualPartial){$d['selectable']=(int)$d['done']===0 && ($actualPartial===null || (int)$d['ChieuDaiCanCat']<=$actualPartial);return$d;},$g['details']);
            $out[]=['id'=>$g['id'],'ton_cuon_le_id'=>$g['ton_cuon_le_id'],'details'=>$details];
        }
        return $out;
    }
}
