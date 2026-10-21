<?php

namespace Tests\Feature\B3;

use App\Models\User;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\CreatesFactoryFlowSchema;
use Tests\TestCase;

class PlanOwnershipTest extends TestCase
{
    use CreatesFactoryFlowSchema;

    protected function setUp(): void
    {
        parent::setUp();
        $this->createFactoryFlowSchema();
        DB::table('users')->insert([
            ['user_id' => 58, 'username' => 'worker-a', 'password_hash' => 'x', 'is_active' => 1],
            ['user_id' => 73, 'username' => 'worker-b', 'password_hash' => 'x', 'is_active' => 1],
        ]);
        DB::table('DanhSachMaSP')->insert(['id' => 1, 'Ten' => 'SP A', 'Ma' => 'A']);
        DB::table('TTThanhPham')->insert(['id' => 10, 'DanhSachSP_ID' => 1, 'MaBin' => 'E7-STOCK/4-01-00', 'NhapKho' => 1, 'Temp' => 0]);
        DB::table('TTNhapKhoTP')->insert(['id' => 20, 'TTThanhPham_ID' => 10, 'NgayNhapKho' => '2026-01-01']);
        DB::table('TTCuonDay')->insert(['id' => 30, 'ThongTinNhapKho_ID' => 20, 'ChieuDai_1cuon' => 100, 'SoCuon' => 24]);
        $this->createPlan(1, 58);
        $this->createPlan(2, 73);
        $this->createPlan(3, null);
        $this->createPlan(4, 58, 'ACTIVE', false);
        $this->createPlan(5, 58, 'HUY');
        DB::table('KeHoach')->insert(['id' => 6, 'MaKeHoach' => 'KH6', 'NgayKeHoach' => '2026-10-06', 'Users_id' => 58]);
    }

    private function createPlan(int $id, ?int $owner, string $status = 'ACTIVE', bool $pending = true): void
    {
        DB::table('KeHoach')->insert([
            'id' => $id, 'MaKeHoach' => 'KH'.$id, 'NgayKeHoach' => '2026-10-0'.$id,
            'TrangThai' => $status, 'Users_id' => $owner,
        ]);
        DB::table('KeHoachHang')->insert(['id' => 10 + $id, 'KeHoach_ID' => $id, 'DanhSachMaSP_ID' => 1]);
        DB::table('KeHoachHangQuyCachCuonChan')->insert([
            'id' => 100 + $id, 'KeHoachHang_ID' => 10 + $id, 'ChieuDai1Cuon' => 100, 'SoLuongCuonCanLay' => 2,
        ]);
        if (!$pending) {
            DB::table('LichSuLayCuon')->insert([
                'KeHoachHang_ID' => 10 + $id, 'QuyCachCuonChan_ID' => 100 + $id,
                'TTCuonDay_ID' => 30, 'SoLuong' => 2, 'NguoiThucHien' => 'worker-a',
            ]);
            return;
        }
        DB::table('KeHoachCatNhom')->insert([
            'id' => 200 + $id, 'KeHoachHang_ID' => 10 + $id, 'QuyCachCuonChan_ID' => 100 + $id,
        ]);
        DB::table('KeHoachCatChiTiet')->insert(['id' => 300 + $id, 'KeHoachCatNhom_ID' => 200 + $id, 'ChieuDaiCanCat' => 40]);
    }

    private function signIn(int $userId = 58): void
    {
        $this->actingAs(User::query()->findOrFail($userId));
    }

    public static function users(): array
    {
        return ['worker A' => [58, [1], [4, 1]], 'worker B' => [73, [2], [2]]];
    }

    public static function inaccessiblePlans(): array
    {
        return ['another worker' => [2], 'unassigned' => [3]];
    }

    public static function actions(): array
    {
        return ['take whole reel' => ['take-whole'], 'cut reel' => ['cut']];
    }

    #[DataProvider('users')]
    public function test_search_only_returns_own_pending_active_plans(int $userId, array $pending, array $all): void
    {
        $this->signIn($userId);
        foreach (['/api/b3/plans', '/api/b3/plans?q=KH'] as $url) {
            $this->assertSame($pending, array_column($this->getJson($url)->assertOk()->json('plans'), 'id'));
        }
    }

    #[DataProvider('inaccessiblePlans')]
    public function test_exact_search_cannot_find_other_or_unassigned_plans(int $planId): void
    {
        $this->signIn();
        $this->getJson('/api/b3/plans?q=KH'.$planId)->assertOk()->assertJsonCount(0, 'plans');
    }

    #[DataProvider('users')]
    public function test_all_worklist_only_contains_own_plans_including_completed(int $userId, array $pending, array $all): void
    {
        $this->signIn($userId);
        $rows = $this->getJson('/api/b3/worklist')->assertOk()->json('rows');
        $this->assertSame($all, array_values(array_unique(array_column($rows, 'ke_hoach_id'))));
    }

    public function test_own_completed_plan_is_still_readable(): void
    {
        $this->signIn();
        $this->getJson('/api/b3/plans/4/worklist')->assertOk()->assertJsonPath('complete', true)
            ->assertJsonPath('rows.0.tinh_trang', 'Hoàn thành (2/2)');
    }

    #[DataProvider('inaccessiblePlans')]
    public function test_direct_worklist_rejects_other_or_unassigned_plans(int $planId): void
    {
        $this->signIn();
        $this->getJson('/api/b3/plans/'.$planId.'/worklist')->assertNotFound()->assertJsonPath('error_code', 'PLAN_NOT_FOUND');
    }

    #[DataProvider('users')]
    public function test_scan_without_selected_plan_only_offers_own_work(int $userId, array $pending, array $all): void
    {
        $this->signIn($userId);
        $contexts = $this->postJson('/api/b3/scan/resolve', ['raw_qr' => 'cuontp;STOCK;100;SCAN-OWN'])
            ->assertOk()->json('candidate_contexts');
        $this->assertSame($pending, array_column(array_column($contexts, 'plan'), 'id'));
    }

    #[DataProvider('inaccessiblePlans')]
    public function test_scan_rejects_selected_other_or_unassigned_plan(int $planId): void
    {
        $this->signIn();
        $this->postJson('/api/b3/scan/resolve', ['raw_qr' => 'cuontp;STOCK;100;SCAN-OTHER', 'ke_hoach_id' => $planId])
            ->assertNotFound()->assertJsonPath('error_code', 'PLAN_NOT_FOUND');
    }

    private function payload(string $action, int $planId): array
    {
        $payload = [
            'raw_qr' => 'cuontp;STOCK;100;SAVE-OWNERSHIP', 'ke_hoach_id' => $planId,
            'ke_hoach_hang_id' => 10 + $planId, 'operation_token' => '11111111-1111-4111-8111-111111111111',
        ];
        return $action === 'take-whole'
            ? $payload + ['quy_cach_cuon_chan_id' => 100 + $planId]
            : $payload + ['group_id' => 200 + $planId, 'detail_id' => 300 + $planId, 'end_value' => 100, 'direction' => 1];
    }

    private function assertNoExecution(): void
    {
        $this->assertDatabaseCount('LichSuLayCuon', 1);
        $this->assertDatabaseCount('LichSuCat', 0);
        $this->assertDatabaseCount('TonCuonLe', 0);
        $this->assertDatabaseCount('B3QrSuDung', 0);
        $this->assertSame(0, DB::table('KeHoachCatNhom')->whereNotNull('TonCuonLe_ID')->count());
    }

    #[DataProvider('inaccessiblePlans')]
    public function test_take_whole_cannot_write_other_or_unassigned_plan(int $planId): void
    {
        $this->signIn();
        $this->postJson('/api/b3/execute/take-whole', $this->payload('take-whole', $planId))
            ->assertNotFound()->assertJsonPath('error_code', 'PLAN_NOT_FOUND');
        $this->assertNoExecution();
    }

    #[DataProvider('inaccessiblePlans')]
    public function test_cut_cannot_write_other_or_unassigned_plan(int $planId): void
    {
        $this->signIn();
        $this->postJson('/api/b3/execute/cut', $this->payload('cut', $planId))
            ->assertNotFound()->assertJsonPath('error_code', 'PLAN_NOT_FOUND');
        $this->assertNoExecution();
    }

    #[DataProvider('actions')]
    public function test_save_rechecks_owner_after_plan_is_reassigned(string $action): void
    {
        $this->signIn();
        $payload = $this->payload($action, 1);
        $this->postJson('/api/b3/scan/resolve', ['raw_qr' => $payload['raw_qr'], 'ke_hoach_id' => 1])->assertOk();
        DB::table('KeHoach')->where('id', 1)->update(['Users_id' => 73]);
        $this->postJson('/api/b3/execute/'.$action, $payload)->assertNotFound()->assertJsonPath('error_code', 'PLAN_NOT_FOUND');
        $this->assertNoExecution();

        $this->signIn(73);
        $this->postJson('/api/b3/execute/'.$action, $payload)->assertOk()->assertJsonPath('plan_id', 1);
        if ($action === 'take-whole') {
            $this->assertDatabaseHas('LichSuLayCuon', ['KeHoachHang_ID' => 11, 'NguoiThucHien' => 'worker-b']);
        } else {
            $this->assertDatabaseHas('LichSuCat', ['KeHoachCatChiTiet_ID' => 301, 'NguoiThucHien' => 'worker-b']);
        }
    }

    public function test_client_cannot_choose_another_user_id(): void
    {
        $this->signIn();
        $plans = $this->getJson('/api/b3/plans?user_id=73&Users_id=73')->assertOk()->json('plans');
        $this->assertSame([1], array_column($plans, 'id'));
        $this->postJson('/api/b3/scan/resolve', [
            'raw_qr' => 'cuontp;STOCK;100;SPOOF', 'ke_hoach_id' => 2, 'user_id' => 73, 'Users_id' => 73,
        ])->assertNotFound()->assertJsonPath('error_code', 'PLAN_NOT_FOUND');
    }

    #[DataProvider('actions')]
    public function test_owned_plan_id_cannot_be_combined_with_another_plans_item(string $action): void
    {
        $this->signIn();
        $payload = $this->payload($action, 2);
        $payload['ke_hoach_id'] = 1;
        $this->postJson('/api/b3/execute/'.$action, $payload)->assertStatus(409)->assertJsonPath('error_code', 'STALE_DATA');
        $this->assertNoExecution();
    }

    private function reassignAfterRead(array $bindings): void
    {
        $reassigned = false;
        DB::listen(function (QueryExecuted $query) use ($bindings, &$reassigned): void {
            if ($reassigned || !str_contains($query->sql, '"KeHoach"') || $query->bindings !== $bindings) {
                return;
            }
            $reassigned = true;
            DB::table('KeHoach')->where('id', 1)->update(['Users_id' => 73]);
        });
    }

    public function test_direct_worklist_rechecks_owner_when_loading_state(): void
    {
        $this->signIn();
        $this->reassignAfterRead([1, 58]);
        $response = $this->getJson('/api/b3/plans/1/worklist');
        $this->assertDatabaseHas('KeHoach', ['id' => 1, 'Users_id' => 73]);
        $response->assertNotFound()->assertJsonPath('error_code', 'PLAN_NOT_FOUND');
    }

    public function test_selected_scan_rechecks_owner_when_loading_state(): void
    {
        $this->signIn();
        $this->reassignAfterRead([1, 58]);
        $response = $this->postJson('/api/b3/scan/resolve', ['raw_qr' => 'cuontp;STOCK;100;READ-RACE', 'ke_hoach_id' => 1]);
        $this->assertDatabaseHas('KeHoach', ['id' => 1, 'Users_id' => 73]);
        $response->assertNotFound()->assertJsonPath('error_code', 'PLAN_NOT_FOUND');
    }

    public function test_all_worklist_omits_plan_reassigned_after_listing(): void
    {
        $this->signIn();
        $this->reassignAfterRead(['ACTIVE', 58]);
        $rows = $this->getJson('/api/b3/worklist')->assertOk()->json('rows');
        $this->assertDatabaseHas('KeHoach', ['id' => 1, 'Users_id' => 73]);
        $this->assertSame([4], array_values(array_unique(array_column($rows, 'ke_hoach_id'))));
    }

    public function test_scan_omits_plan_reassigned_after_listing(): void
    {
        $this->signIn();
        $this->reassignAfterRead(['ACTIVE', 58]);
        $response = $this->postJson('/api/b3/scan/resolve', ['raw_qr' => 'cuontp;STOCK;100;READ-RACE']);
        $this->assertDatabaseHas('KeHoach', ['id' => 1, 'Users_id' => 73]);
        $response->assertStatus(422)->assertJsonPath('error_code', 'NO_MATCHING_PLAN');
    }
}
