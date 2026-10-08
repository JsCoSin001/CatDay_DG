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
            $hasPhysicalSuffix = count($parts) >= 3 && count(array_filter(array_slice($parts,2), fn($v) => trim((string)$v) !== '')) > 0;
            if(strcasecmp(trim($parts[0]??''),'cuontp')!==0 || trim($parts[1]??'')==='' || !$hasPhysicalSuffix){
                throw B3Exception::make('QR_INVALID_FORMAT','Mã QR không đúng định dạng.');
            }
            return ['kind'=>'STRUCTURED','raw'=>$raw,'ma_bin'=>trim($parts[1])];
        }
        return ['kind'=>'PLAIN','raw'=>$raw,'ma_bin'=>null];
    }

    public function resolve(string $rawQr): array
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

            if ((int)($partial['nhap_kho'] ?? 0) !== 1 || (int)($partial['temp'] ?? 1) !== 0 || ($partial['TrangThai'] ?? null) !== 'ACTIVE' || abs((int)$partial['SoCuoi'] - (int)$partial['SoDau']) <= 0 || !$lineageValid) {
                throw B3Exception::make('QR_SOURCE_NOT_USABLE','Cuộn này không còn khả dụng để thực hiện.',409);
            }
            return ['source_type'=>'CUON_LE','raw_qr'=>$raw,'ma_bin'=>$partial['ma_bin']??null,'product_id'=>(int)$partial['product_id'],'tt_thanh_pham_id'=>(int)$partial['TTThanhPham_ID'],'ton_cuon_le_id'=>(int)$partial['id'],'partial'=>$partial];
        }
        $parsed=$this->parse($raw);
        if($parsed['kind']==='PLAIN'){
            if($this->inventory->fullByMaBin($parsed['raw'])) throw B3Exception::make('PLAIN_QR_IS_FULL_REEL','Mã quét không hợp lệ cho cuộn chẵn.');
            throw B3Exception::make('QR_SOURCE_NOT_FOUND','Không tìm thấy dữ liệu nhập kho phù hợp với mã quét.',404);
        }
        $full=$this->inventory->fullByMaBin($parsed['ma_bin']);
        if(!$full) throw B3Exception::make('QR_SOURCE_NOT_FOUND','Không tìm thấy dữ liệu nhập kho phù hợp với mã quét.',404);
        if((int)($full['actual']??0)<=0) throw B3Exception::make('QR_SOURCE_NOT_USABLE','Cuộn này không còn khả dụng để thực hiện.',409);
        return ['source_type'=>'CUON_CHAN','raw_qr'=>$parsed['raw'],'ma_bin'=>$parsed['ma_bin'],'product_id'=>(int)$full['product_id'],'tt_thanh_pham_id'=>(int)$full['tt_thanh_pham_id'],'ton_cuon_le_id'=>null,'full'=>$full];
    }
}
