<?php
namespace App\Services\B3;

use App\Models\User;
use App\Repositories\B3\ExecutionRepository;
use App\Repositories\B3\InventoryRepository;
use App\Repositories\B3\PlanRepository;
use App\Repositories\B3\QrUsageRepository;
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
        private QrUsageRepository $qrUsage,
        private CutCalculator $calc,
        private PlanWorklistService $worklist,
        private CutSessionService $cutSession,
    ) {}

    public function takeWhole(string $rawQr,int $planId,int $itemId,int $quyCachId,string $token,User $actor):array
    {
        return $this->tx->run(function() use($rawQr,$planId,$itemId,$quyCachId,$token,$actor){
            $this->plans->assertOwnedBy($planId, (int) $actor->getAuthIdentifier());
            if($this->exec->operationExists($token)) throw B3Exception::make('DUPLICATE_REQUEST','Thao tác này đã được ghi nhận trước đó.',409);
            // Allocate only within the scanned MaBin segment and QR length.
            $source=$this->qr->resolve($rawQr, true);
            if($source['source_type']!=='CUON_CHAN') throw B3Exception::make('STALE_DATA','Dữ liệu đã thay đổi. Vui lòng quét lại để cập nhật.',409);
            $item=$this->plans->item($itemId); $plan=$this->plans->planForItem($itemId);
            if(!$item||!$plan) throw B3Exception::make('PLAN_NOT_FOUND','Không tìm thấy kế hoạch.',404);
            if((int)$plan['id']!==$planId) throw B3Exception::make('STALE_DATA','Dữ liệu đã thay đổi. Vui lòng quét lại để cập nhật.',409);
            if($plan['TrangThai']!=='ACTIVE') throw B3Exception::make('PLAN_NOT_ACTIVE','Kế hoạch không còn hiệu lực.',409);
            if((int)$item['DanhSachMaSP_ID']!==$source['product_id']) throw B3Exception::make('QR_NOT_IN_PLAN','Sản phẩm quét không thuộc kế hoạch đang thực hiện.',422);
            $qc=$this->plans->quyCach($quyCachId);
            if(!$qc || (int)$qc['KeHoachHang_ID']!==$itemId || (int)$qc['ChieuDai1Cuon']!==(int)$source['chieu_dai_1cuon'])
                throw B3Exception::make('STALE_DATA','Quy cách cuộn không phù hợp với QR hoặc kế hoạch.',409);
            $done=(int)\Illuminate\Support\Facades\DB::table('LichSuLayCuon')->where('QuyCachCuonChan_ID',$quyCachId)->sum('SoLuong');
            if($done >= (int)$qc['SoLuongCuonCanLay']) throw B3Exception::make('PLAN_REQUIREMENT_COMPLETED','Số lượng lấy nguyên của sản phẩm này đã hoàn thành.',409);
            $productId=(int)$item['DanhSachMaSP_ID'];
            $length=(int)$qc['ChieuDai1Cuon'];
            $actual=$this->inventory->fullActualForProduct($productId,$length);
            $reserved=$this->inventory->fullReservedForProductLength($productId,$length);
            if($actual<$reserved) throw B3Exception::make('STALE_DATA','Tồn kho hoặc đặt trước đã thay đổi.',409);
            $fifo=$this->inventory->fifoFullSourceForMaBins($source['ma_bins'],$productId,$length);
            if(!$fifo) throw B3Exception::make('INSUFFICIENT_FULL_STOCK','MaBin được quét không còn cuộn có chiều dài phù hợp.',409);
            $this->qrUsage->ensureUnused($source['raw_qr']);
            $historyId=$this->exec->insertWhole($itemId,(int)$fifo['id'],$quyCachId,$actor->username,$token);
            $this->qrUsage->markWholeTaken($source['raw_qr'],$historyId,$actor->username);
            return $this->resultForPlan($planId, (int) $actor->getAuthIdentifier());
        });
    }

    public function cut(string $rawQr,int $planId,int $itemId,int $groupId,int $detailId,?int $endValue,?int $direction,string $token,User $actor,?string $sourceVersion=null,?int $expectedCutLength=null):array
    {
        return $this->tx->run(function() use($rawQr,$planId,$itemId,$groupId,$detailId,$endValue,$direction,$token,$actor,$sourceVersion,$expectedCutLength){
            $this->plans->assertOwnedBy($planId, (int) $actor->getAuthIdentifier());
            if($this->exec->operationExists($token)) throw B3Exception::make('DUPLICATE_REQUEST','Thao tác này đã được ghi nhận trước đó.',409);
            $source=$this->qr->resolve($rawQr);
            $this->cutSession->assertVersion($sourceVersion,$source);
            $item=$this->plans->item($itemId); $plan=$this->plans->planForItem($itemId); $group=$this->plans->group($groupId); $detail=$this->plans->detail($detailId);
            if(!$item||!$plan||!$group||!$detail) throw B3Exception::make('STALE_DATA','Dữ liệu đã thay đổi. Vui lòng quét lại để cập nhật.',409);
            if((int)$plan['id']!==$planId) throw B3Exception::make('STALE_DATA','Dữ liệu đã thay đổi. Vui lòng quét lại để cập nhật.',409);
            if($plan['TrangThai']!=='ACTIVE' || (int)$group['KeHoachHang_ID']!==$itemId || (int)$detail['KeHoachCatNhom_ID']!==$groupId || (int)$item['DanhSachMaSP_ID']!==$source['product_id']) throw B3Exception::make('STALE_DATA','Dữ liệu đã thay đổi. Vui lòng quét lại để cập nhật.',409);
            if(\Illuminate\Support\Facades\DB::table('LichSuCat')->where('KeHoachCatChiTiet_ID',$detailId)->exists()) throw B3Exception::make('DETAIL_ALREADY_DONE','Nội dung cắt này đã được thực hiện.',409);
            $cutLen=(int)$detail['ChieuDaiCanCat'];
            if($expectedCutLength!==null && $cutLen!==$expectedCutLength)
                throw B3Exception::make('STALE_DATA','Chiều dài trong kế hoạch đã thay đổi. Vui lòng tải lại dữ liệu.',409);
            if($source['source_type']==='CUON_CHAN'){
                if($group['TonCuonLe_ID']!==null) throw B3Exception::make('STALE_DATA','Dữ liệu đã thay đổi. Vui lòng quét lại để cập nhật.',409);
                $qc=$this->plans->quyCach((int)($group['QuyCachCuonChan_ID']??0));
                $std=(int)($qc['ChieuDai1Cuon']??0);
                if(!$qc || (int)$qc['KeHoachHang_ID']!==$itemId || $std!==(int)$source['chieu_dai_1cuon'])
                    throw B3Exception::make('STALE_DATA','Chiều dài QR không phù hợp với nhóm cắt.',409);
                if($std<=0 || $endValue===null || !in_array($direction,[-1,1],true)) throw B3Exception::make('CUT_INPUT_INVALID','Dữ liệu cắt không hợp lệ.');
                if($cutLen===$std) throw B3Exception::make('STALE_DATA','Dữ liệu kế hoạch không còn phù hợp để cắt lẻ. Vui lòng kiểm tra lại kế hoạch.',409);
                $groupRemaining=(int)\Illuminate\Support\Facades\DB::table('KeHoachCatChiTiet as CT')->leftJoin('LichSuCat as LS','LS.KeHoachCatChiTiet_ID','=','CT.id')->where('CT.KeHoachCatNhom_ID',$groupId)->whereNull('LS.id')->sum('CT.ChieuDaiCanCat');
                if($groupRemaining>$std) throw B3Exception::make('STALE_DATA','Dữ liệu đã thay đổi. Vui lòng quét lại để cập nhật.',409);
                $productActual=$this->inventory->fullActualForProduct((int)$item['DanhSachMaSP_ID'],$std);
                $productReserved=$this->inventory->fullReservedForProductLength((int)$item['DanhSachMaSP_ID'],$std);
                if($productActual<$productReserved) throw B3Exception::make('STALE_DATA','Dữ liệu đã thay đổi. Vui lòng quét lại để cập nhật.',409);
                $actual=(int)$source['full']['actual'];
                if($actual<=0) throw B3Exception::make('INSUFFICIENT_FULL_STOCK','Không còn đủ cuộn chẵn để thực hiện.',409);
                $fifo=$this->inventory->fifoFullSourceForMaBins($source['ma_bins'],(int)$item['DanhSachMaSP_ID'],$std);
                if(!$fifo) throw B3Exception::make('INSUFFICIENT_FULL_STOCK','Không còn đủ cuộn chẵn để thực hiện.',409);
                $c=$this->calc->firstCut($std,$cutLen,$endValue,$direction);
                $this->qrUsage->ensureUnused($source['raw_qr']);
                $partialId=$this->exec->createPartial(['MaCuon'=>$source['raw_qr'],'TTThanhPham_ID'=>(int)$fifo['tt_thanh_pham_id'],'TTCuonDay_ID'=>(int)$fifo['id'],'SoDau'=>$c['soDauSau'],'SoCuoi'=>$c['soCuoiSau'],'TrangThai'=>$c['remainingLength']===0?'HET':'ACTIVE','GhiChu'=>null]);
                $this->qrUsage->markConverted($source['raw_qr'],$partialId,$actor->username);
                if($this->exec->bindGroup($groupId,$partialId)!==1) throw B3Exception::make('STALE_DATA','Dữ liệu đã thay đổi. Vui lòng quét lại để cập nhật.',409);
                $this->exec->insertCut($this->cutHistory($detailId,$partialId,'CUON_CHAN',$cutLen,$c,$source['raw_qr'],$actor->username,$token));
            } else {
                if((int)($group['TonCuonLe_ID']??0)!==(int)$source['ton_cuon_le_id']) throw B3Exception::make('STALE_DATA','Dữ liệu đã thay đổi. Vui lòng quét lại để cập nhật.',409);
                if(($endValue===null)!==($direction===null)) throw B3Exception::make('CUT_INPUT_INVALID','Dữ liệu cắt không hợp lệ.');
                $p=$this->inventory->partialByExactCode($source['raw_qr']); if(!$p) throw B3Exception::make('QR_SOURCE_NOT_USABLE','Cuộn này không còn khả dụng để thực hiện.',409);
                $actual=abs((int)$p['SoCuoi']-(int)$p['SoDau']); $reserved=$this->inventory->partialReservedLength((int)$p['id']);
                if($reserved>$actual) throw B3Exception::make('STALE_DATA','Dữ liệu đã thay đổi. Vui lòng quét lại để cập nhật.',409);
                // Rebase edited markers using the actual remaining length; marker edits cannot add stock.
                $c=$endValue!==null
                    ? $this->calc->firstCut($actual,$cutLen,$endValue,$direction)
                    : $this->calc->partialCut((int)$p['SoDau'],(int)$p['SoCuoi'],$cutLen);
                $this->exec->insertCut($this->cutHistory($detailId,(int)$p['id'],'CUON_LE',$cutLen,$c,$source['raw_qr'],$actor->username,$token));
                $this->exec->updatePartial((int)$p['id'],$c['soDauSau'],$c['soCuoiSau'],$c['remainingLength']===0?'HET':'ACTIVE');
            }
            return $this->resultForPlan($planId, (int) $actor->getAuthIdentifier())
                + ['cut_session'=>$this->cutSession->state($rawQr,$planId,$itemId,$groupId,$actor,$token,$detailId)];
        });
    }

    private function cutHistory(int $detailId,int $partialId,string $kind,int $len,array $c,string $raw,string $user,string $token):array
    {return ['KeHoachCatChiTiet_ID'=>$detailId,'TonCuonLe_ID'=>$partialId,'LoaiNguon'=>$kind,'ChieuDaiCat'=>$len,'SoDauTruoc'=>$c['soDauTruoc'],'SoCuoiTruoc'=>$c['soCuoiTruoc'],'SoDauCat'=>$c['soDauCat'],'SoCuoiCat'=>$c['soCuoiCat'],'SoDauSau'=>$c['soDauSau'],'SoCuoiSau'=>$c['soCuoiSau'],'HeSoChieu'=>$c['heSoChieu'],'MaQuetThucTe'=>$raw,'NguoiThucHien'=>$user,'GhiChu'=>'__B3_OP__:'.$token];}
    private function resultForPlan(int $planId,int $userId):array{ $state=$this->plans->loadPlanState($planId,$userId); return ['success'=>true,'plan_id'=>$planId,'plan_complete'=>$state['complete'],'worklist'=>$this->worklist->project($state),'plan_state'=>$state]; }
}
