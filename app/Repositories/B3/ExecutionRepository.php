<?php
namespace App\Repositories\B3;
use Illuminate\Support\Facades\DB;

class ExecutionRepository
{
    public function operationExists(string $token): bool
    {
        $m='__B3_OP__:'.$token;
        return DB::table('LichSuLayCuon')->where('GhiChu','like','%'.$m.'%')->exists() || DB::table('LichSuCat')->where('GhiChu','like','%'.$m.'%')->exists();
    }
    public function insertWhole(int $itemId,int $sourceId,string $username,string $token): int
    {return (int)DB::table('LichSuLayCuon')->insertGetId(['KeHoachHang_ID'=>$itemId,'TTCuonDay_ID'=>$sourceId,'SoLuong'=>1,'NguoiThucHien'=>$username,'GhiChu'=>'__B3_OP__:'.$token]);}
    public function createPartial(array $data): int { return (int)DB::table('TonCuonLe')->insertGetId($data); }
    public function bindGroup(int $groupId,int $partialId): int { return DB::table('KeHoachCatNhom')->where('id',$groupId)->whereNull('TonCuonLe_ID')->update(['TonCuonLe_ID'=>$partialId]); }
    public function insertCut(array $data): int { return (int)DB::table('LichSuCat')->insertGetId($data); }
    public function updatePartial(int $id,int $soDau,int $soCuoi,string $status): int { return DB::table('TonCuonLe')->where('id',$id)->update(['SoDau'=>$soDau,'SoCuoi'=>$soCuoi,'TrangThai'=>$status]); }
}
