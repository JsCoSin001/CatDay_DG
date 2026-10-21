<?php

namespace App\Services\B3;

use App\Models\User;
use App\Repositories\B3\ExecutionRepository;
use App\Repositories\B3\PlanRepository;
use App\Support\B3\B3Exception;
use App\Support\B3\B3Transaction;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class CutSessionService
{
    public function __construct(
        private QrResolver $qr,
        private PlanRepository $plans,
        private ExecutionRepository $exec,
        private B3Transaction $tx,
    ) {}

    public function version(array $source): string
    {
        $state = [$source['raw_qr'], $source['source_type'], $source['product_id']];
        if ($source['source_type'] === 'CUON_LE') {
            $p = $source['partial'];
            $state[] = [(int)$p['id'], (int)$p['TTThanhPham_ID'], (int)$p['TTCuonDay_ID'],
                (int)$p['SoDau'], (int)$p['SoCuoi'], $p['TrangThai'],
                (int)DB::table('LichSuCat')->where('TonCuonLe_ID', $p['id'])->max('id')];
        } else {
            $state[] = [$source['chieu_dai_1cuon'], $source['full']['stock_revision']];
        }
        return hash_hmac('sha256', json_encode($state, JSON_THROW_ON_ERROR), (string)config('app.key'));
    }

    public function assertVersion(?string $version, array $source): void
    {
        // Optional for older API consumers. The continuous-cut UI always supplies it.
        if ($version !== null && !hash_equals($this->version($source), $version)) {
            throw B3Exception::make('SOURCE_STATE_CHANGED', 'Thông số hoặc tồn cuộn đã thay đổi. Vui lòng tải lại dữ liệu trước khi cắt tiếp.', 409);
        }
    }

    public function recover(string $raw, int $planId, int $itemId, int $groupId, User $actor, ?string $token, ?int $detailId): array
    {
        // The same SQLite transaction guard gives recovery a consistent source/history snapshot.
        return $this->tx->run(fn() => $this->state($raw, $planId, $itemId, $groupId, $actor, $token, $detailId));
    }

    /** Called inside the existing write transaction, or by recover() inside its read guard. */
    public function state(string $raw, int $planId, int $itemId, int $groupId, User $actor, ?string $token, ?int $detailId): array
    {
        $this->plans->assertOwnedBy($planId, (int)$actor->getAuthIdentifier());
        $planState = $this->plans->loadPlanState($planId, (int)$actor->getAuthIdentifier());
        if (!$planState['plan']) throw B3Exception::make('PLAN_NOT_FOUND', 'Không tìm thấy kế hoạch.', 404);
        $item = null; $group = null;
        foreach ($planState['items'] as $candidate) {
            if ($candidate['id'] !== $itemId) continue;
            foreach ($candidate['groups'] as $g) {
                if ($g['id'] === $groupId) { $item = $candidate; $group = $g; break 2; }
            }
        }
        if (!$item || !$group) throw B3Exception::make('STALE_DATA', 'Nhóm cắt không còn thuộc kế hoạch đang thực hiện.', 409);

        $last = $token ? $this->exec->cutOperation($token) : null;
        if ($last && ((int)$last['KeHoachCatChiTiet_ID'] !== $detailId
            || (int)$last['KeHoachCatNhom_ID'] !== $groupId
            || $last['NguoiThucHien'] !== $actor->username || $last['MaQuetThucTe'] !== trim($raw))) {
            throw B3Exception::make('DUPLICATE_REQUEST', 'Mã giao dịch không thuộc thao tác cắt đang kiểm tra.', 409);
        }
        if ($token && !$last && $this->exec->operationExists($token)) {
            throw B3Exception::make('DUPLICATE_REQUEST', 'Mã giao dịch không thuộc thao tác cắt đang kiểm tra.', 409);
        }
        $source = $this->qr->resolve($raw, true, true);
        if ($source['product_id'] !== $item['product_id']
            || ($source['source_type'] === 'CUON_LE' && $group['ton_cuon_le_id'] !== $source['ton_cuon_le_id'])
            || ($source['source_type'] === 'CUON_CHAN' && $group['ton_cuon_le_id'] !== null)) {
            throw B3Exception::make('SOURCE_STATE_CHANGED', 'Cuộn không còn phù hợp với nhóm cắt đang thực hiện.', 409);
        }
        $partial = $source['source_type'] === 'CUON_LE' ? $source['partial'] : null;
        $remaining = $partial ? abs((int)$partial['SoCuoi'] - (int)$partial['SoDau']) : (int)$source['chieu_dai_1cuon'];
        $group['details'] = array_map(function($d) use ($remaining) {
            $d['selectable'] = !$d['done'] && $d['ChieuDaiCanCat'] <= $remaining;
            return $d;
        }, $group['details']);
        $hasChoice = count(array_filter($group['details'], fn($d) => $d['selectable'])) > 0;
        $active = $planState['plan']['TrangThai'] === 'ACTIVE' && $remaining > 0 && $hasChoice;
        if (!$partial && ((int)$source['full']['actual'] <= 0
            || $item['standard_length'] !== $source['chieu_dai_1cuon'])) $active = false;
        $reason = $remaining === 0 ? 'Cuộn đã hết dây.' : ($hasChoice ? 'Kế hoạch không còn hiệu lực.' : 'Không còn đoạn cắt phù hợp trong nhóm đang thực hiện.');
        return [
            'source' => $source, 'source_version' => $this->version($source),
            'context' => ['plan' => ['id' => $planId, 'ma_ke_hoach' => $planState['plan']['MaKeHoach']],
                'item' => $item, 'groups' => [$group],
                'available_actions' => [$partial ? 'CUT_PARTIAL_REEL' : 'CUT_FULL_REEL']],
            'current_start' => $partial ? (int)$partial['SoDau'] : null,
            'current_end' => $partial ? (int)$partial['SoCuoi'] : null,
            'direction' => $partial ? ((int)$partial['SoDau'] === (int)$partial['SoCuoi']
                ? (int)($last['HeSoChieu'] ?? 1) : ((int)$partial['SoDau'] < (int)$partial['SoCuoi'] ? 1 : -1)) : null,
            'remaining_length' => $remaining, 'active' => $active, 'end_reason' => $active ? null : $reason,
            'operation_token' => (string)Str::uuid(),
            'operation_status' => $last ? 'SAVED' : ($token ? 'NOT_FOUND' : null),
            'last_operation' => $last ? ['id' => (int)$last['id'], 'detail_id' => (int)$last['KeHoachCatChiTiet_ID'],
                'cut_length' => (int)$last['ChieuDaiCat'], 'end_after' => (int)$last['SoCuoiSau'], 'operation_token' => $token] : null,
        ];
    }
}
