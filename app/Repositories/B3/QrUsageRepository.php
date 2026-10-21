<?php
namespace App\Repositories\B3;

use Illuminate\Support\Facades\DB;
use App\Support\B3\B3Exception;

/** Persist usage on execute (not print or scan). All operations participate in B3Transaction. */
class QrUsageRepository
{
    public function findByRawQr(string $raw): ?array
    {
        $row = DB::table('B3QrSuDung')->where('RawQr', '=', trim($raw))->first();
        return $row ? (array)$row : null;
    }

    public function ensureUnused(string $raw): void
    {
        if ($this->findByRawQr($raw)) {
            throw B3Exception::make('QR_ALREADY_USED','Mã QR này đã được thực hiện.',409);
        }
    }

    public function markWholeTaken(string $raw, int $historyId, string $actor): void
    {
        $this->ensureUnused($raw);
        DB::table('B3QrSuDung')->insert([
            'RawQr'=>trim($raw),'TrangThai'=>'DA_LAY_NGUYEN',
            'LichSuLayCuon_ID'=>$historyId,'NguoiThucHien'=>$actor
        ]);
    }

    public function markConverted(string $raw, int $partialId, string $actor): void
    {
        $this->ensureUnused($raw);
        DB::table('B3QrSuDung')->insert([
            'RawQr'=>trim($raw),'TrangThai'=>'DA_CHUYEN_LE',
            'TonCuonLe_ID'=>$partialId,'NguoiThucHien'=>$actor
        ]);
    }
}
