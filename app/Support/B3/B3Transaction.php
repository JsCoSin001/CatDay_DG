<?php
namespace App\Support\B3;

use Illuminate\Support\Facades\DB;

class B3Transaction
{
    public function run(callable $callback): mixed
    {
        $attempts = max(1, (int) config('database.connections.sqlite.b3_busy_retries', 3));
        $sleepMs = max(0, (int) config('database.connections.sqlite.b3_busy_retry_ms', 100));

        for ($i = 1; $i <= $attempts; $i++) {
            $pdo = DB::connection()->getPdo();
            $begun = false;
            try {
                $pdo->exec('BEGIN IMMEDIATE');
                $begun = true;
                $result = $callback();
                $pdo->exec('COMMIT');
                $begun = false;
                return $result;
            } catch (\Throwable $e) {
                if ($begun) {
                    try { $pdo->exec('ROLLBACK'); } catch (\Throwable) {}
                }
                $msg = strtolower($e->getMessage());
                $busy = str_contains($msg, 'database is locked') || str_contains($msg, 'sqlite_busy');
                if ($busy && $i < $attempts) { usleep($sleepMs * 1000); continue; }
                if ($busy) throw B3Exception::make('DATABASE_BUSY', 'Hệ thống đang xử lý thao tác khác. Vui lòng thử lại.', 503);
                throw $e;
            }
        }

        throw B3Exception::make('DATABASE_BUSY', 'Hệ thống đang xử lý thao tác khác. Vui lòng thử lại.', 503);
    }
}
