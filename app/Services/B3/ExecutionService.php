<?php
namespace App\Services\B3;

use App\Models\User;
use App\Repositories\B3\ExecutionRepository;
use App\Repositories\B3\InventoryRepository;
use App\Repositories\B3\PlanRepository;
use App\Support\B3\B3Exception;
use App\Support\B3\B3Transaction;

class ExecutionService
{
    public function __construct(
        private B3Transaction $tx,
        private QrResolver $qr,
        private PlanRepository $plans,
        private InventoryRepository $inventory,
        private ExecutionRepository $exec,
        private CutCalculator $calc,
        private PlanWorklistService $worklist,
    ) {}

    public function takeWhole(string $rawQr,int $planId,int $itemId,string $token,User $actor):array
    {
        return $this->tx->run(function() use($rawQr,$planId,$itemId,$token,$actor){
            if($this->exec->operationExists($token)) throw B3Exception::make('DUPLICATE_REQUEST','Thao tác này đã được ghi nhận trước đó.',409);
            $source=$this->qr->resolve($rawQr);
            if($source['source_type']!=='CUON_CHAN') throw B3Exception::make('STALE_DATA','Dữ liệu đã thay đổi. Vui lòng quét lại để cập nhật.',409);
            $item=$this->plans->item($itemId); $plan=$this->plans->planForItem($itemId);
            if(!$item||!$plan) throw B3Exception::make('PLAN_NOT_FOUND','Không tìm thấy kế hoạch.',404);
            if((int)$plan['id']!==$planId) throw B3Exception::make('STALE_DATA','Dữ liệu đã thay đổi. Vui lòng quét lại để cập nhật.',409);
            if($plan['TrangThai']!=='ACTIVE') throw B3Exception::make('PLAN_NOT_ACTIVE','Kế hoạch không còn hiệu lực.',409);
            if((int)$item['DanhSachMaSP_ID']!==$source['product_id']) throw B3Exception::make('QR_NOT_IN_PLAN','Sản phẩm quét không thuộc kế hoạch đang thực hiện.',422);
            $done=(int)\Illuminate\Support\Facades\DB::table('LichSuLayCuon')->where('KeHoachHang_ID',$itemId)->sum('SoLuong');
            if($done >= (int)$item['SoLuongCuonCanLay']) throw B3Exception::make('PLAN_REQUIREMENT_COMPLETED','Số lượng lấy nguyên của sản phẩm này đã hoàn thành.',409);
            $std=(int)($item['ChieuDai1Cuon_KeHoach']??0); if($std<=0) throw B3Exception::make('STALE_DATA','Dữ liệu đã thay đổi. Vui lòng quét lại để cập nhật.',409);
            $scannedActual=$this->inventory->fullActualForMaBin((string)$source['ma_bin'],(int)$item['DanhSachMaSP_ID'],$std);
            if($scannedActual<=0) throw B3Exception::make('QR_SOURCE_NOT_USABLE','Cuộn này không còn khả dụng để thực hiện.',409);
            $actual=$this->inventory->fullActualForProduct((int)$item['DanhSachMaSP_ID'],$std);
            $reserved=$this->inventory->fullReservedForProduct((int)$item['DanhSachMaSP_ID']);
            if($actual<=0) throw B3Exception::make('INSUFFICIENT_FULL_STOCK','Không còn đủ cuộn chẵn để thực hiện.',409);
            if($actual<$reserved) throw B3Exception::make('STALE_DATA','Dữ liệu đã thay đổi. Vui lòng quét lại để cập nhật.',409);
            $fifo=$this->inventory->fifoFullSourceForProduct((int)$item['DanhSachMaSP_ID'],$std);
            if(!$fifo) throw B3Exception::make('INSUFFICIENT_FULL_STOCK','Không còn đủ cuộn chẵn để thực hiện.',409);
            $this->exec->insertWhole($itemId,(int)$fifo['id'],$actor->username,$token);
            return $this->resultForPlan($planId);
        });
    }

    public function cut(string $rawQr,int $planId,int $itemId,int $groupId,int $detailId,?int $endValue,?int $direction,string $token,User $actor):array
    {
        return $this->tx->run(function() use($rawQr,$planId,$itemId,$groupId,$detailId,$endValue,$direction,$token,$actor){
            if($this->exec->operationExists($token)) throw B3Exception::make('DUPLICATE_REQUEST','Thao tác này đã được ghi nhận trước đó.',409);
            $source=$this->qr->resolve($rawQr);
            $item=$this->plans->item($itemId); $plan=$this->plans->planForItem($itemId); $group=$this->plans->group($groupId); $detail=$this->plans->detail($detailId);
            if(!$item||!$plan||!$group||!$detail) throw B3Exception::make('STALE_DATA','Dữ liệu đã thay đổi. Vui lòng quét lại để cập nhật.',409);
            if((int)$plan['id']!==$planId) throw B3Exception::make('STALE_DATA','Dữ liệu đã thay đổi. Vui lòng quét lại để cập nhật.',409);
            if($plan['TrangThai']!=='ACTIVE' || (int)$group['KeHoachHang_ID']!==$itemId || (int)$detail['KeHoachCatNhom_ID']!==$groupId || (int)$item['DanhSachMaSP_ID']!==$source['product_id']) throw B3Exception::make('STALE_DATA','Dữ liệu đã thay đổi. Vui lòng quét lại để cập nhật.',409);
            if(\Illuminate\Support\Facades\DB::table('LichSuCat')->where('KeHoachCatChiTiet_ID',$detailId)->exists()) throw B3Exception::make('DETAIL_ALREADY_DONE','Nội dung cắt này đã được thực hiện.',409);
            $cutLen=(int)$detail['ChieuDaiCanCat'];
            if($source['source_type']==='CUON_LE' && ($endValue!==null || $direction!==null)) throw B3Exception::make('STALE_DATA','Dữ liệu đã thay đổi. Vui lòng quét lại để cập nhật.',409);
            if($source['source_type']==='CUON_CHAN'){
                if($group['TonCuonLe_ID']!==null) throw B3Exception::make('STALE_DATA','Dữ liệu đã thay đổi. Vui lòng quét lại để cập nhật.',409);
                $std=(int)($item['ChieuDai1Cuon_KeHoach']??0); if($std<=0 || $endValue===null || !in_array($direction,[-1,1],true)) throw B3Exception::make('CUT_INPUT_INVALID','Dữ liệu cắt không hợp lệ.');
                if($cutLen===$std) throw B3Exception::make('STALE_DATA','Dữ liệu kế hoạch không còn phù hợp để cắt lẻ. Vui lòng kiểm tra lại kế hoạch.',409);
                $groupRemaining=(int)\Illuminate\Support\Facades\DB::table('KeHoachCatChiTiet as CT')->leftJoin('LichSuCat as LS','LS.KeHoachCatChiTiet_ID','=','CT.id')->where('CT.KeHoachCatNhom_ID',$groupId)->whereNull('LS.id')->sum('CT.ChieuDaiCanCat');
                if($groupRemaining>$std) throw B3Exception::make('STALE_DATA','Dữ liệu đã thay đổi. Vui lòng quét lại để cập nhật.',409);
                $productActual=$this->inventory->fullActualForProduct((int)$item['DanhSachMaSP_ID'],$std);
                $productReserved=$this->inventory->fullReservedForProduct((int)$item['DanhSachMaSP_ID']);
                if($productActual<$productReserved) throw B3Exception::make('STALE_DATA','Dữ liệu đã thay đổi. Vui lòng quét lại để cập nhật.',409);
                $actual=$this->inventory->fullActualForMaBin((string)$source['ma_bin'],(int)$item['DanhSachMaSP_ID'],$std);
                if($actual<=0) throw B3Exception::make('INSUFFICIENT_FULL_STOCK','Không còn đủ cuộn chẵn để thực hiện.',409);
                $fifo=$this->inventory->fifoFullSourceForMaBin((string)$source['ma_bin'],(int)$item['DanhSachMaSP_ID'],$std);
                if(!$fifo) throw B3Exception::make('INSUFFICIENT_FULL_STOCK','Không còn đủ cuộn chẵn để thực hiện.',409);
                $c=$this->calc->firstCut($std,$cutLen,$endValue,$direction);
                $partialId=$this->exec->createPartial(['MaCuon'=>$source['raw_qr'],'TTThanhPham_ID'=>(int)$fifo['tt_thanh_pham_id'],'TTCuonDay_ID'=>(int)$fifo['id'],'SoDau'=>$c['soDauSau'],'SoCuoi'=>$c['soCuoiSau'],'TrangThai'=>$c['remainingLength']===0?'HET':'ACTIVE','GhiChu'=>null]);
                if($this->exec->bindGroup($groupId,$partialId)!==1) throw B3Exception::make('STALE_DATA','Dữ liệu đã thay đổi. Vui lòng quét lại để cập nhật.',409);
                $this->exec->insertCut($this->cutHistory($detailId,$partialId,'CUON_CHAN',$cutLen,$c,$source['raw_qr'],$actor->username,$token));
            } else {
                if((int)($group['TonCuonLe_ID']??0)!==(int)$source['ton_cuon_le_id']) throw B3Exception::make('STALE_DATA','Dữ liệu đã thay đổi. Vui lòng quét lại để cập nhật.',409);
                $p=$this->inventory->partialByExactCode($source['raw_qr']); if(!$p) throw B3Exception::make('QR_SOURCE_NOT_USABLE','Cuộn này không còn khả dụng để thực hiện.',409);
                $actual=abs((int)$p['SoCuoi']-(int)$p['SoDau']); $reserved=$this->inventory->partialReservedLength((int)$p['id']);
                if($reserved>$actual) throw B3Exception::make('STALE_DATA','Dữ liệu đã thay đổi. Vui lòng quét lại để cập nhật.',409);
                $c=$this->calc->partialCut((int)$p['SoDau'],(int)$p['SoCuoi'],$cutLen);
                $this->exec->insertCut($this->cutHistory($detailId,(int)$p['id'],'CUON_LE',$cutLen,$c,$source['raw_qr'],$actor->username,$token));
                $this->exec->updatePartial((int)$p['id'],$c['soDauSau'],$c['soCuoiSau'],$c['remainingLength']===0?'HET':'ACTIVE');
            }
            return $this->resultForPlan($planId);
        });
    }

    private function cutHistory(int $detailId,int $partialId,string $kind,int $len,array $c,string $raw,string $user,string $token):array
    {return ['KeHoachCatChiTiet_ID'=>$detailId,'TonCuonLe_ID'=>$partialId,'LoaiNguon'=>$kind,'ChieuDaiCat'=>$len,'SoDauTruoc'=>$c['soDauTruoc'],'SoCuoiTruoc'=>$c['soCuoiTruoc'],'SoDauCat'=>$c['soDauCat'],'SoCuoiCat'=>$c['soCuoiCat'],'SoDauSau'=>$c['soDauSau'],'SoCuoiSau'=>$c['soCuoiSau'],'HeSoChieu'=>$c['heSoChieu'],'MaQuetThucTe'=>$raw,'NguoiThucHien'=>$user,'GhiChu'=>'__B3_OP__:'.$token];}
    private function resultForPlan(int $planId):array{ $state=$this->plans->loadPlanState($planId); return ['success'=>true,'plan_id'=>$planId,'plan_complete'=>$state['complete'],'worklist'=>$this->worklist->project($state),'plan_state'=>$state]; }
}
