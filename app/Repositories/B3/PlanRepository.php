<?php

namespace App\Repositories\B3;

use App\Support\B3\B3Exception;
use Illuminate\Support\Facades\DB;

class PlanRepository
{
    public function activeIncompletePlans(int $userId, ?string $search = null): array
    {
        $q = DB::table('KeHoach as K')->where('K.TrangThai','ACTIVE')
            ->where('K.Users_id', $userId)
            ->whereExists(function($x){
                $x->selectRaw('1')->from('KeHoachHang as KH')->whereColumn('KH.KeHoach_ID','K.id')
                    ->where(function($w){
                        $w->whereExists(function($z){$z->selectRaw('1')->from('KeHoachHangQuyCachCuonChan as QC')
                            ->whereColumn('QC.KeHoachHang_ID','KH.id')
                            ->whereRaw('QC.SoLuongCuonCanLay > COALESCE((SELECT SUM(LS.SoLuong) FROM LichSuLayCuon LS WHERE LS.QuyCachCuonChan_ID=QC.id),0)');})
                          ->orWhereExists(function($c){$c->selectRaw('1')->from('KeHoachCatNhom as N')
                            ->join('KeHoachCatChiTiet as CT','CT.KeHoachCatNhom_ID','=','N.id')
                            ->leftJoin('LichSuCat as LS','LS.KeHoachCatChiTiet_ID','=','CT.id')
                            ->whereColumn('N.KeHoachHang_ID','KH.id')->whereNull('LS.id');});
                    });
            });
        if($search!==null && trim($search)!=='') $q->where('K.MaKeHoach','like','%'.trim($search).'%');
        return $q->orderByDesc('K.NgayKeHoach')->orderByDesc('K.id')
            ->select('K.id','K.MaKeHoach','K.NgayKeHoach')->get()
            ->map(fn($p)=>['id'=>(int)$p->id,'ma_ke_hoach'=>$p->MaKeHoach,'ngay'=>$p->NgayKeHoach])->all();
    }

    /** All active plans, including fully completed ones, for the persistent worklist. */
    public function activePlans(int $userId): array
    {
        return DB::table('KeHoach as K')->where('K.TrangThai', 'ACTIVE')
            ->where('K.Users_id', $userId)
            ->whereExists(function($x) {
                $x->selectRaw('1')->from('KeHoachHang as KH')
                    ->whereColumn('KH.KeHoach_ID', 'K.id');
            })->orderByDesc('K.NgayKeHoach')->orderByDesc('K.id')
            ->select('K.id','K.MaKeHoach','K.NgayKeHoach')->get()
            ->map(fn($p)=>['id'=>(int)$p->id,'ma_ke_hoach'=>$p->MaKeHoach,'ngay'=>$p->NgayKeHoach])->all();
    }

    public function assertOwnedBy(int $planId, int $userId): void
    {
        if (!DB::table('KeHoach')->where('id', $planId)->where('Users_id', $userId)->exists()) {
            throw B3Exception::make('PLAN_NOT_FOUND', 'Không tìm thấy kế hoạch.', 404);
        }
    }

    public function loadPlanState(int $planId, int $userId): array
    {
        return $this->loadPlanStates([$planId], $userId)[$planId] ?? ['plan'=>null,'items'=>[],'complete'=>false];
    }

    public function loadPlanStates(array $planIds, int $userId): array
    {
        $planIds=array_values(array_unique(array_map('intval',$planIds)));
        if(!$planIds) return [];
        $plans=DB::table('KeHoach')->whereIn('id',$planIds)->where('Users_id', $userId)->get()->keyBy('id');
        $planIds=array_values(array_filter($planIds, fn($id) => $plans->has($id)));
        if(!$planIds) return [];
        $items=DB::table('KeHoachHang as KH')->join('DanhSachMaSP as SP','SP.id','=','KH.DanhSachMaSP_ID')
            ->whereIn('KH.KeHoach_ID',$planIds)->select('KH.*','SP.Ten as product_name')->orderBy('KH.id')->get();
        $itemIds=$items->pluck('id')->all();
        $qcs=$itemIds?DB::table('KeHoachHangQuyCachCuonChan')->whereIn('KeHoachHang_ID',$itemIds)->orderBy('ChieuDai1Cuon')->get():collect();
        $qcIds=$qcs->pluck('id')->all();
        $histories=$qcIds?DB::table('LichSuLayCuon')->whereIn('QuyCachCuonChan_ID',$qcIds)
            ->orderBy('id')->get():collect();
        $groups=$itemIds?DB::table('KeHoachCatNhom')->whereIn('KeHoachHang_ID',$itemIds)->orderBy('id')->get():collect();
        $groupIds=$groups->pluck('id')->all();
        $details=$groupIds?DB::table('KeHoachCatChiTiet as CT')
            ->leftJoin('LichSuCat as LS','LS.KeHoachCatChiTiet_ID','=','CT.id')
            ->whereIn('CT.KeHoachCatNhom_ID',$groupIds)
            ->select('CT.id','CT.KeHoachCatNhom_ID','CT.ChieuDaiCanCat','LS.MaQuetThucTe as actual_cut_qr',
                'LS.SoDauCat as actual_cut_start','LS.SoCuoiCat as actual_cut_end',
                DB::raw('CASE WHEN LS.id IS NULL THEN 0 ELSE 1 END as done'))
            ->orderBy('CT.id')->get():collect();
        $partialIds=$groups->pluck('TonCuonLe_ID')->filter()->unique()->values()->all();
        $partials=$partialIds?DB::table('TonCuonLe')->whereIn('id',$partialIds)->get()->keyBy('id'):collect();
        $qcByItem=$qcs->groupBy('KeHoachHang_ID');$historyByQc=$histories->groupBy('QuyCachCuonChan_ID');
        $groupsByItem=$groups->groupBy('KeHoachHang_ID');$detailsByGroup=$details->groupBy('KeHoachCatNhom_ID');
        $out=[];
        foreach($planIds as $pid){
            $plan=$plans[$pid]??null;
            if(!$plan){$out[$pid]=['plan'=>null,'items'=>[],'complete'=>false];continue;}
            $states=[];$all=true;
            foreach($items->where('KeHoach_ID',$pid) as $it){
                $baseGroups=$groupsByItem[$it->id]??collect();
                $lengthRows=$qcByItem[$it->id]??collect();
                // Products planned only as pre-existing partial reels have no full-reel specification.
                $specs=$lengthRows;
                if($lengthRows->isEmpty() || $baseGroups->contains(fn($g)=>$g->QuyCachCuonChan_ID===null))
                    $specs=$specs->concat([null]);
                foreach($specs as $qc){
                    $qid=$qc?(int)$qc->id:null;
                    $wholeHistory=$qid?collect($historyByQc[$qid]??[]):collect();
                    $done=(int)$wholeHistory->sum('SoLuong');
                    $req=$qid?(int)$qc->SoLuongCuonCanLay:0;
                    $cutReq=0;$cutDone=0;$groupStates=[];
                    foreach($baseGroups as $g){
                        if($qid!==null && (int)($g->QuyCachCuonChan_ID??0)!==$qid) continue;
                        if($qid===null && $g->QuyCachCuonChan_ID!==null) continue;
                        $ds=collect($detailsByGroup[$g->id]??[])->map(fn($d)=>[
                            'id'=>(int)$d->id,'ChieuDaiCanCat'=>(int)$d->ChieuDaiCanCat,'done'=>(int)$d->done,
                            'actual_cut_qr'=>$d->actual_cut_qr,
                            'actual_cut_start'=>$d->actual_cut_start===null?null:(int)$d->actual_cut_start,
                            'actual_cut_end'=>$d->actual_cut_end===null?null:(int)$d->actual_cut_end])->all();
                        $cutReq+=count($ds);$cutDone+=count(array_filter($ds,fn($d)=>$d['done']===1));
                        $partial=$g->TonCuonLe_ID&&isset($partials[$g->TonCuonLe_ID])?(array)$partials[$g->TonCuonLe_ID]:null;
                        $groupStates[]=['id'=>(int)$g->id,'quy_cach_id'=>$qid,
                            'ton_cuon_le_id'=>$g->TonCuonLe_ID?(int)$g->TonCuonLe_ID:null,
                            'details'=>$ds,'partial'=>$partial];
                    }
                    $complete=$done >= $req && $cutDone===$cutReq;
                    if(!$complete)$all=false;
                    $states[]=['id'=>(int)$it->id,'product_id'=>(int)$it->DanhSachMaSP_ID,
                        'product_name'=>$it->product_name,'quy_cach_id'=>$qid,
                        'whole_required'=>$req,'whole_done'=>$done,
                        'whole_histories'=>$wholeHistory->map(fn($h)=>['id'=>(int)$h->id,'source_id'=>(int)$h->TTCuonDay_ID])->all(),
                        'standard_length'=>$qid?(int)$qc->ChieuDai1Cuon:null,
                        'cut_required'=>$cutReq,'cut_done'=>$cutDone,'groups'=>$groupStates,'complete'=>$complete];
                }
            }
            $out[$pid]=['plan'=>(array)$plan,'items'=>$states,'complete'=>$all&&count($states)>0];
        }
        return $out;
    }

    public function quyCach(int $id): ?array
    {
        $r=DB::table('KeHoachHangQuyCachCuonChan')->where('id',$id)->first();return$r?(array)$r:null;
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
