<?php
namespace App\Repositories\B3;

use Illuminate\Support\Facades\DB;

class ExecutionRevisionRepository
{
    public function __construct(private OperationLedgerRepository $ledger) {}

    public function sourceRevision(array $source): array
    {
        $keys=['FACTORY'];
        if ($source['source_type']==='CUON_LE') $keys[]='REEL:'.$source['ton_cuon_le_id'];
        $versions=DB::table('B3PhienBanDuLieu')->whereIn('Khoa',$keys)->pluck('GiaTri','Khoa')->all();
        ksort($versions);
        return array_map(fn($v)=>(int)$v,$versions);
    }
}
