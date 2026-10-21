<?php
namespace App\Services\B3;

use App\Repositories\B3\InventoryRepository;
use App\Support\B3\B3Exception;

class QrResolver
{
    public function __construct(private InventoryRepository $inventory) {}

    public function parse(string $rawQr): array
    {
        $raw=trim($rawQr);
        if($raw==='') throw B3Exception::make('QR_INVALID_FORMAT','Mã QR không đúng định dạng.');
        if(str_contains($raw,';')){
            $parts=explode(';',$raw);
            if(strcasecmp(trim($parts[0]),'cuontp')!==0
                || trim($parts[1]??'')==='' || !preg_match('/^[1-9][0-9]*$/D',trim($parts[2]??''))
                || (int)trim($parts[2])>2147483647) {
                throw B3Exception::make('QR_INVALID_FORMAT','Mã QR cuộn chẵn phải có tiền tố cuontp, mã MaBin và chiều dài nguyên dương.');
            }
            return ['kind'=>'STRUCTURED','raw'=>$raw,'ma_bin'=>trim($parts[1]),
                'chieu_dai_1cuon'=>(int)trim($parts[2])];
        }
        return ['kind'=>'PLAIN','raw'=>$raw,'ma_bin'=>null];
    }

    public function resolve(string $rawQr, bool $allowExhaustedFull = false, bool $allowFinishedPartial = false): array
    {
        $raw=trim($rawQr);
        if($raw==='') throw B3Exception::make('QR_INVALID_FORMAT','Mã QR không đúng định dạng.');
        $partial=$this->inventory->partialByExactCode($raw);
        if($partial){
            $sourceSoDau = $partial['source_so_dau'] ?? null;
            $sourceSoCuoi = $partial['source_so_cuoi'] ?? null;
            $sourceHasPartialNull = is_null($sourceSoDau) !== is_null($sourceSoCuoi);
            $lineageValid = isset($partial['source_ttc_id'], $partial['source_nhap_kho_id'], $partial['source_tt_thanh_pham_id'])
                && (int)$partial['TTCuonDay_ID'] === (int)$partial['source_ttc_id']
                && (int)$partial['TTThanhPham_ID'] === (int)$partial['source_tt_thanh_pham_id']
                && (int)($partial['product_id'] ?? 0) === (int)($partial['source_product_id'] ?? -1)
                && (int)($partial['source_nhap_kho'] ?? 0) === 1
                && (int)($partial['source_temp'] ?? 1) === 0
                && !$sourceHasPartialNull;

            $usable = ($partial['TrangThai'] ?? null) === 'ACTIVE' && abs((int)$partial['SoCuoi'] - (int)$partial['SoDau']) > 0;
            $finished = $allowFinishedPartial && ($partial['TrangThai'] ?? null) === 'HET' && (int)$partial['SoCuoi'] === (int)$partial['SoDau'];
            if ((int)($partial['nhap_kho'] ?? 0) !== 1 || (int)($partial['temp'] ?? 1) !== 0 || (!$usable && !$finished) || !$lineageValid) {
                throw B3Exception::make('QR_SOURCE_NOT_USABLE','Cuộn này không còn khả dụng để thực hiện.',409);
            }
            return ['source_type'=>'CUON_LE','raw_qr'=>$raw,'ma_bin'=>$partial['ma_bin']??null,'product_id'=>(int)$partial['product_id'],'tt_thanh_pham_id'=>(int)$partial['TTThanhPham_ID'],'ton_cuon_le_id'=>(int)$partial['id'],'partial'=>$partial];
        }
        $parsed=$this->parse($raw);
        // A whole-taken QR must never be accepted again, even if stock is still positive.
        if(\Illuminate\Support\Facades\DB::table('B3QrSuDung')->where('RawQr',$raw)->where('TrangThai','DA_LAY_NGUYEN')->exists())
            throw B3Exception::make('QR_ALREADY_USED','Mã QR này đã được lấy nguyên trước đó.',409);
        if(\Illuminate\Support\Facades\DB::table('B3QrSuDung')->where('RawQr',$raw)->where('TrangThai','DA_CHUYEN_LE')->exists())
            throw B3Exception::make('QR_SOURCE_NOT_USABLE','Cuộn này đã chuyển lẻ và không còn khả dụng.',409);
        if($parsed['kind']==='PLAIN'){
            if($this->inventory->fullByMaBin($parsed['raw'])) throw B3Exception::make('PLAIN_QR_IS_FULL_REEL','Mã quét không hợp lệ cho cuộn chẵn.');
            throw B3Exception::make('QR_SOURCE_NOT_FOUND','Không tìm thấy dữ liệu nhập kho phù hợp với mã quét.',404);
        }
        $matches=$this->inventory->fullMaBinsByCode($parsed['ma_bin']);
        if(!$matches) throw B3Exception::make('QR_SOURCE_NOT_FOUND','Không tìm thấy dữ liệu nhập kho phù hợp với mã quét.',404);
        $productIds=array_values(array_unique(array_map(fn($row)=>(int)$row['product_id'],$matches)));
        // Check identity across all matching lengths before narrowing by QR length or plan.
        if(count($productIds)!==1) {
            throw B3Exception::make('QR_PRODUCT_AMBIGUOUS','Mã “'.$parsed['ma_bin'].'” đang khớp với nhiều sản phẩm khác nhau. Vui lòng kiểm tra lại mã QR hoặc dữ liệu MaBin.',409);
        }
        $matchingLength=array_values(array_filter($matches,fn($row)=>(int)$row['standard_length']===$parsed['chieu_dai_1cuon']));
        if(!$matchingLength) throw B3Exception::make('QR_SOURCE_NOT_FOUND','Không tìm thấy dữ liệu nhập kho phù hợp với mã quét.',404);
        $maBins=array_values(array_unique(array_column($matchingLength,'ma_bin')));
        $eligible=$this->inventory->eligibleFullSources($productIds[0],$parsed['chieu_dai_1cuon'],$maBins);
        $full=$eligible[0]??$matchingLength[0];
        $full['actual']=array_sum(array_column($eligible,'remaining'));
        $full['stock_revision']=hash('sha256',json_encode(array_map(fn($row)=>[
            (int)$row['id'],(int)$row['tt_thanh_pham_id'],(int)$row['ChieuDai_1cuon'],(int)$row['remaining']
        ],$eligible),JSON_THROW_ON_ERROR));
        if(!$allowExhaustedFull && (int)($full['actual']??0)<=0) throw B3Exception::make('QR_SOURCE_NOT_USABLE','Cuộn này không còn khả dụng để thực hiện.',409);
        return ['source_type'=>'CUON_CHAN','raw_qr'=>$parsed['raw'],'ma_bin'=>$parsed['ma_bin'],'ma_bins'=>$maBins,'product_id'=>$productIds[0],'tt_thanh_pham_id'=>(int)$full['tt_thanh_pham_id'],'ton_cuon_le_id'=>null,'chieu_dai_1cuon'=>$parsed['chieu_dai_1cuon'],'full'=>$full];
    }
}
