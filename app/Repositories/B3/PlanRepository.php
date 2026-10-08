<?php

namespace App\Repositories\B3;

use Illuminate\Support\Facades\DB;

class PlanRepository
{
    public function activeIncompletePlans(?string $search = null): array
    {
        $q=DB::table('KeHoach as K')->where('K.TrangThai','ACTIVE')
            ->whereExists(function($x){
                $x->selectRaw('1')->from('KeHoachHang as KH')->whereColumn('KH.KeHoach_ID','K.id')
                  ->where(function($w){
                      $w->whereRaw('KH.SoLuongCuonCanLay > COALESCE((SELECT SUM(LSL.SoLuong) FROM LichSuLayCuon LSL WHERE LSL.KeHoachHang_ID = KH.id),0)')
                        ->orWhereExists(function($c){$c->selectRaw('1')->from('KeHoachCatNhom as N')->join('KeHoachCatChiTiet as CT','CT.KeHoachCatNhom_ID','=','N.id')->leftJoin('LichSuCat as LS','LS.KeHoachCatChiTiet_ID','=','CT.id')->whereColumn('N.KeHoachHang_ID','KH.id')->whereNull('LS.id');});
                  });
            });
        if($search!==null && trim($search)!=='') $q->where('K.MaKeHoach','like','%'.trim($search).'%');
        return $q->orderByDesc('K.NgayKeHoach')->orderByDesc('K.id')->select('K.id','K.MaKeHoach','K.NgayKeHoach')->get()->map(fn($p)=>['id'=>(int)$p->id,'ma_ke_hoach'=>$p->MaKeHoach,'ngay'=>$p->NgayKeHoach])->all();
    }

    public function loadPlanState(int $planId): array
    {
        return $this->loadPlanStates([$planId])[$planId] ?? ['plan'=>null,'items'=>[],'complete'=>false];
    }

    public function loadPlanStates(array $planIds): array
    {
        $planIds=array_values(array_unique(array_map('intval',$planIds))); if(!$planIds)return[];
        $plans=DB::table('KeHoach')->whereIn('id',$planIds)->get()->keyBy('id');
        $items=DB::table('KeHoachHang as KH')->join('DanhSachMaSP as SP','SP.id','=','KH.DanhSachMaSP_ID')->whereIn('KH.KeHoach_ID',$planIds)
            ->select('KH.*','SP.Ten as product_name')->orderBy('KH.id')->get();
        $itemIds=$items->pluck('id')->all();
        $wholeDone=$itemIds?DB::table('LichSuLayCuon')->whereIn('KeHoachHang_ID',$itemIds)->selectRaw('KeHoachHang_ID, SUM(SoLuong) v')->groupBy('KeHoachHang_ID')->pluck('v','KeHoachHang_ID'):collect();
        $groups=$itemIds?DB::table('KeHoachCatNhom')->whereIn('KeHoachHang_ID',$itemIds)->orderBy('id')->get():collect();
        $groupIds=$groups->pluck('id')->all();
        $details=$groupIds?DB::table('KeHoachCatChiTiet as CT')->leftJoin('LichSuCat as LS','LS.KeHoachCatChiTiet_ID','=','CT.id')->whereIn('CT.KeHoachCatNhom_ID',$groupIds)
            ->select('CT.id','CT.KeHoachCatNhom_ID','CT.ChieuDaiCanCat',DB::raw('CASE WHEN LS.id IS NULL THEN 0 ELSE 1 END as done'))->orderBy('CT.id')->get():collect();
        $partialIds=$groups->pluck('TonCuonLe_ID')->filter()->unique()->values()->all();
        $partials=$partialIds?DB::table('TonCuonLe')->whereIn('id',$partialIds)->get()->keyBy('id'):collect();
        $groupsByItem=$groups->groupBy('KeHoachHang_ID'); $detailsByGroup=$details->groupBy('KeHoachCatNhom_ID');
        $out=[];
        foreach($planIds as $pid){
            $p=$plans[$pid]??null; if(!$p){$out[$pid]=['plan'=>null,'items'=>[],'complete'=>false];continue;}
            $states=[];$all=true;
            foreach($items->where('KeHoach_ID',$pid) as $it){
                $whole=(int)($wholeDone[$it->id]??0);$cutReq=0;$cutDone=0;$groupStates=[];
                foreach($groupsByItem[$it->id]??[] as $g){
                    $ds=collect($detailsByGroup[$g->id]??[])->map(fn($d)=>['id'=>(int)$d->id,'ChieuDaiCanCat'=>(int)$d->ChieuDaiCanCat,'done'=>(int)$d->done])->all();
                    $cutReq+=count($ds);$cutDone+=count(array_filter($ds,fn($d)=>$d['done']===1));$partial=$g->TonCuonLe_ID&&isset($partials[$g->TonCuonLe_ID])?(array)$partials[$g->TonCuonLe_ID]:null;
                    $groupStates[]=['id'=>(int)$g->id,'ton_cuon_le_id'=>$g->TonCuonLe_ID?(int)$g->TonCuonLe_ID:null,'details'=>$ds,'partial'=>$partial];
                }
                $complete=$whole>=(int)$it->SoLuongCuonCanLay && $cutDone===$cutReq;if(!$complete)$all=false;
                $states[]=['id'=>(int)$it->id,'product_id'=>(int)$it->DanhSachMaSP_ID,'product_name'=>$it->product_name,'whole_required'=>(int)$it->SoLuongCuonCanLay,'whole_done'=>$whole,'standard_length'=>$it->ChieuDai1Cuon_KeHoach!==null?(int)$it->ChieuDai1Cuon_KeHoach:null,'cut_required'=>$cutReq,'cut_done'=>$cutDone,'groups'=>$groupStates,'complete'=>$complete];
            }
            $out[$pid]=['plan'=>(array)$p,'items'=>$states,'complete'=>$all&&count($states)>0];
        }
        return $out;
    }

    public function item(int $id): ?array{$r=DB::table('KeHoachHang')->where('id',$id)->first();return$r?(array)$r:null;}
    public function planForItem(int $itemId): ?array{$r=DB::table('KeHoach as K')->join('KeHoachHang as KH','KH.KeHoach_ID','=','K.id')->where('KH.id',$itemId)->select('K.*')->first();return$r?(array)$r:null;}
    public function group(int $id): ?array{$r=DB::table('KeHoachCatNhom')->where('id',$id)->first();return$r?(array)$r:null;}
    public function detail(int $id): ?array{$r=DB::table('KeHoachCatChiTiet')->where('id',$id)->first();return$r?(array)$r:null;}
    public function eligibleGroups(int $itemId, ?int $tonCuonLeId): array
    {
        $q=DB::table('KeHoachCatNhom as N')->where('N.KeHoachHang_ID',$itemId);$tonCuonLeId===null?$q->whereNull('N.TonCuonLe_ID'):$q->where('N.TonCuonLe_ID',$tonCuonLeId);
        $groups=$q->whereExists(function($x){$x->selectRaw('1')->from('KeHoachCatChiTiet as CT')->leftJoin('LichSuCat as LS','LS.KeHoachCatChiTiet_ID','=','CT.id')->whereColumn('CT.KeHoachCatNhom_ID','N.id')->whereNull('LS.id');})->orderBy('N.id')->get();
        if($groups->isEmpty())return[];$ids=$groups->pluck('id')->all();$details=DB::table('KeHoachCatChiTiet as CT')->leftJoin('LichSuCat as LS','LS.KeHoachCatChiTiet_ID','=','CT.id')->whereIn('CT.KeHoachCatNhom_ID',$ids)->select('CT.id','CT.KeHoachCatNhom_ID','CT.ChieuDaiCanCat',DB::raw('CASE WHEN LS.id IS NULL THEN 0 ELSE 1 END as done'))->orderBy('CT.id')->get()->groupBy('KeHoachCatNhom_ID');
        return $groups->map(fn($g)=>['id'=>(int)$g->id,'ton_cuon_le_id'=>$g->TonCuonLe_ID?(int)$g->TonCuonLe_ID:null,'details'=>collect($details[$g->id]??[])->map(fn($d)=>(array)$d)->all()])->all();
    }
}
