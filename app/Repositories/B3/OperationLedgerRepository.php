<?php
namespace App\Repositories\B3;

use App\Support\B3\B3Exception;
use Illuminate\Support\Facades\DB;

class OperationLedgerRepository
{
    public function find(string $token): ?array
    {
        $row=DB::table('B3ThaoTac')->where('MaThaoTac',$token)->first();
        return $row ? (array)$row : null;
    }

    public function assertNotCancelled(string $token): ?array
    {
        $operation=$this->find($token);
        if ($operation && $operation['TrangThai']==='HUY') {
            throw B3Exception::make('OPERATION_CANCELLED','Thao tác này đã được hủy tại B2. Vui lòng tải lại dữ liệu.',409);
        }
        return $operation;
    }

    public function assertUnused(string $token): void
    {
        if ($this->assertNotCancelled($token) ||
            DB::table('LichSuCat')->where('GhiChu','__B3_OP__:'.$token)->exists() ||
            DB::table('LichSuLayCuon')->where('GhiChu','__B3_OP__:'.$token)->exists()) {
            throw B3Exception::make('DUPLICATE_REQUEST','Thao tác này đã được ghi nhận trước đó.',409);
        }
    }

    public function record(array $operation): int
    {
        return (int)DB::table('B3ThaoTac')->insertGetId($operation,'ThuTu');
    }
}
