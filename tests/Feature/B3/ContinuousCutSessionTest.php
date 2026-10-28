<?php

namespace Tests\Feature\B3;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\CreatesFactoryFlowSchema;
use Tests\TestCase;

class ContinuousCutSessionTest extends TestCase
{
    use CreatesFactoryFlowSchema;

    private const QR = 'cuontp;264772;500;SESSION-REEL;extra';

    protected function setUp(): void
    {
        parent::setUp();
        config(['database.default' => 'sqlite', 'database.connections.sqlite.database' => ':memory:']);
        DB::purge('sqlite');
        $this->assertSame(':memory:', DB::connection()->getDatabaseName());
        $this->createFactoryFlowSchema();
        DB::table('users')->insert([
            ['user_id' => 58, 'username' => 'worker', 'password_hash' => 'x', 'is_active' => 1],
            ['user_id' => 73, 'username' => 'other', 'password_hash' => 'x', 'is_active' => 1],
        ]);
        DB::table('DanhSachMaSP')->insert(['id' => 6784, 'Ten' => 'Dây điện A', 'Ma' => 'A']);
        DB::table('TTThanhPham')->insert(['id' => 10, 'DanhSachSP_ID' => 6784, 'MaBin' => 'E7-264772/4-01-00', 'NhapKho' => 1, 'Temp' => 0]);
        DB::table('TTNhapKhoTP')->insert(['id' => 20, 'TTThanhPham_ID' => 10, 'NgayNhapKho' => '2026-10-21']);
        DB::table('TTCuonDay')->insert(['id' => 30, 'ThongTinNhapKho_ID' => 20, 'ChieuDai_1cuon' => 500, 'SoCuon' => 5]);
        DB::table('KeHoach')->insert(['id' => 1, 'Users_id' => 58, 'MaKeHoach' => 'KH001', 'NgayKeHoach' => '2026-10-21', 'TrangThai' => 'ACTIVE']);
        DB::table('KeHoachHang')->insert(['id' => 40, 'KeHoach_ID' => 1, 'DanhSachMaSP_ID' => 6784]);
        DB::table('KeHoachHangQuyCachCuonChan')->insert(['id' => 80, 'KeHoachHang_ID' => 40, 'ChieuDai1Cuon' => 500, 'SoLuongCuonCanLay' => 1]);
        DB::table('KeHoachCatNhom')->insert(['id' => 50, 'KeHoachHang_ID' => 40, 'QuyCachCuonChan_ID' => 80]);
        DB::table('KeHoachCatChiTiet')->insert([
            ['id' => 60, 'KeHoachCatNhom_ID' => 50, 'ChieuDaiCanCat' => 100],
            ['id' => 61, 'KeHoachCatNhom_ID' => 50, 'ChieuDaiCanCat' => 150],
            ['id' => 62, 'KeHoachCatNhom_ID' => 50, 'ChieuDaiCanCat' => 50],
        ]);
        $this->actingAs(User::query()->findOrFail(58));
    }

    private function existingPartial(int $start = 500, int $end = 1000): void
    {
        DB::table('TonCuonLe')->insert(['id' => 70, 'MaCuon' => self::QR, 'TTThanhPham_ID' => 10, 'TTCuonDay_ID' => 30, 'SoDau' => $start, 'SoCuoi' => $end, 'TrangThai' => 'ACTIVE']);
        DB::table('KeHoachCatNhom')->where('id', 50)->update(['TonCuonLe_ID' => 70]);
    }

    private function scan(): array
    {
        return $this->postJson('/api/b3/scan/resolve', ['raw_qr' => self::QR, 'ke_hoach_id' => 1])->assertOk()->json();
    }

    private function payload(array $state, int $detail, array $extra = []): array
    {
        return array_replace([
            'raw_qr' => self::QR, 'ke_hoach_id' => 1, 'ke_hoach_hang_id' => 40,
            'group_id' => 50, 'detail_id' => $detail,
            'operation_token' => $state['operation_token'],
        ], isset($state['source_version']) ? ['source_version' => $state['source_version']] : [], $extra);
    }

    private function recovery(string $token, int $detail = 60, array $extra = [])
    {
        return $this->getJson('/api/b3/cut-session?'.http_build_query(array_replace([
            'raw_qr' => self::QR, 'ke_hoach_id' => 1, 'ke_hoach_hang_id' => 40,
            'group_id' => 50, 'detail_id' => $detail, 'operation_token' => $token,
        ], $extra)));
    }

    public static function startingReels(): array
    {
        return ['full forward' => [false, 1, 1000, [900, 750, 700]],
            'partial forward' => [true, 1, 1000, [900, 750, 700]],
            'full reverse' => [false, -1, 500, [600, 750, 800]],
            'partial reverse' => [true, -1, 500, [600, 750, 800]]];
    }

    public static function worklistMarkerCases(): array
    {
        return [
            'full forward' => [false, 1, 1000],
            'partial forward' => [true, 1, 1000],
            'full reverse from zero' => [false, -1, 0],
            'partial reverse from zero' => [true, -1, 0],
        ];
    }

    #[DataProvider('worklistMarkerCases')]
    public function test_worklist_retains_each_actual_cut_range_across_separate_batches(
        bool $partial, int $direction, int $end
    ): void {
        if ($partial) $this->existingPartial($end - $direction * 500, $end);
        $expected = [];
        // Cut 150m before 100m: display order must never determine physical markers.
        foreach ([61 => 150, 60 => 100, 62 => 50] as $detail => $length) {
            $state = $this->scan(); // Resume from a fresh scan for each batch.
            $nextEnd = $end - $direction * $length;
            $expected[$detail] = [$end, $nextEnd];
            $payload = $this->payload($state, $detail, count($expected) === 1
                ? ['end_value' => $end, 'direction' => $direction] : []);
            $saved = $this->postJson('/api/b3/execute/cut', $payload)->assertOk()->json('worklist');
            $lists = [$saved];
            foreach (['/api/b3/plans/1/worklist', '/api/b3/worklist'] as $endpoint) {
                $lists[] = $this->getJson($endpoint)->assertOk()->json('rows');
            }
            foreach ($lists as $rows) {
                foreach ($rows as $row) {
                    if (!$row['completed']) {
                        $this->assertNull($row['so_dau']);
                        $this->assertNull($row['so_cuoi']);
                    }
                }
                $byDetail = collect($rows)->where('row_type', 'CUT_DONE')->keyBy('detail_id');
                foreach ($expected as $doneDetail => [$start, $finish]) {
                    $this->assertSame($start, $byDetail[$doneDetail]['so_dau']);
                    $this->assertSame($finish, $byDetail[$doneDetail]['so_cuoi']);
                }
            }
            $end = $nextEnd;
        }
    }

    #[DataProvider('startingReels')]
    public function test_three_cuts_use_database_markers_distinct_tokens_and_one_partial(bool $partial, int $direction, int $end, array $ends): void
    {
        if ($partial) $this->existingPartial($direction === 1 ? 500 : 1000, $end);
        $state = $this->scan();
        $this->assertNotEmpty($state['source_version'] ?? null, 'scan supplies a source fingerprint');
        $tokens = [];
        foreach ([60, 61, 62] as $index => $detail) {
            $tokens[] = $state['operation_token'];
            // Confirm markers only on the first cut; later cuts must use the database.
            $payload = $this->payload($state, $detail, $index === 0 ? ['end_value' => $end, 'direction' => $direction] : []);
            $response = $this->postJson('/api/b3/execute/cut', $payload)->assertOk();
            $state = $response->json('cut_session');
            $this->assertIsArray($state);
            $this->assertSame('CUON_LE', $state['source']['source_type']);
            $this->assertSame($ends[$index], $state['current_end']);
            $this->assertSame($direction === 1 ? 500 : 1000, $state['current_start']);
            $this->assertSame($direction, $state['direction']);
            $this->assertSame([400, 250, 200][$index], $state['remaining_length']);
            $this->assertSame($index < 2, $state['active']);
            $this->assertSame(50, $state['context']['groups'][0]['id']);
            $this->assertDatabaseHas('LichSuCat', ['KeHoachCatChiTiet_ID' => $detail, 'SoCuoiSau' => $ends[$index]]);
        }
        $this->assertCount(3, array_unique($tokens));
        $this->assertSame(1, DB::table('TonCuonLe')->count());
        $this->assertSame(3, DB::table('LichSuCat')->count());
        $this->assertDatabaseHas('TonCuonLe', ['SoCuoi' => $ends[2], 'TrangThai' => 'ACTIVE']);
        $this->assertSame($partial ? 0 : 1, DB::table('B3QrSuDung')->count());
    }

    public function test_other_device_changes_are_rejected_without_rebasing_stale_markers(): void
    {
        $this->existingPartial();
        $old = $this->scan();
        $this->postJson('/api/b3/execute/cut', $this->payload($old, 60))->assertOk();
        $this->postJson('/api/b3/execute/cut', $this->payload($old, 61, ['operation_token' => (string) Str::uuid(), 'end_value' => 1000, 'direction' => 1]))
            ->assertStatus(409)->assertJsonPath('error_code', 'SOURCE_STATE_CHANGED');
        $this->assertSame(1, DB::table('LichSuCat')->count());
        $this->assertDatabaseHas('TonCuonLe', ['SoCuoi' => 900]);
    }

    public function test_external_marker_edit_and_forged_source_versions_are_rejected(): void
    {
        $this->existingPartial();
        $state = $this->scan();
        DB::table('TonCuonLe')->where('id', 70)->update(['SoDau' => 400, 'SoCuoi' => 900]);
        $this->postJson('/api/b3/execute/cut', $this->payload($state, 60))->assertStatus(409)->assertJsonPath('error_code', 'SOURCE_STATE_CHANGED');
        $state = $this->scan();
        $this->postJson('/api/b3/execute/cut', $this->payload($state, 60, ['source_version' => 'forged']))->assertStatus(409);
        $this->assertSame(0, DB::table('LichSuCat')->count());
    }

    public function test_full_source_stock_changes_since_scan_are_rejected(): void
    {
        $state = $this->scan();
        DB::table('TTCuonDay')->where('id', 30)->update(['SoCuon' => 4]);
        $this->postJson('/api/b3/execute/cut', $this->payload($state, 60, ['end_value' => 1000, 'direction' => 1]))->assertStatus(409)->assertJsonPath('error_code', 'SOURCE_STATE_CHANGED');
        $this->assertSame(0, DB::table('TonCuonLe')->count());
    }

    public function test_lost_response_is_recovered_by_exact_token_without_inserting_history(): void
    {
        $this->existingPartial();
        $state = $this->scan();
        $payload = $this->payload($state, 60);
        $this->postJson('/api/b3/execute/cut', $payload)->assertOk();
        $this->recovery($state['operation_token'])->assertOk()->assertJsonPath('cut_session.operation_status', 'SAVED')
            ->assertJsonPath('cut_session.current_end', 900)->assertJsonPath('cut_session.last_operation.detail_id', 60);
        $this->postJson('/api/b3/execute/cut', $payload)->assertStatus(409)->assertJsonPath('error_code', 'DUPLICATE_REQUEST');
        $this->assertSame(1, DB::table('LichSuCat')->count());
    }

    public function test_recovery_not_found_is_read_only_and_does_not_start_another_reel(): void
    {
        $state = $this->scan();
        $this->recovery($state['operation_token'])->assertOk()->assertJsonPath('cut_session.operation_status', 'NOT_FOUND')
            ->assertJsonPath('cut_session.source.source_type', 'CUON_CHAN');
        $this->assertSame(0, DB::table('LichSuCat')->count());
        $this->assertSame(0, DB::table('TonCuonLe')->count());
    }

    public function test_recovery_checks_owner_qr_and_detail_not_just_token(): void
    {
        $this->existingPartial();
        $state = $this->scan();
        $this->postJson('/api/b3/execute/cut', $this->payload($state, 60))->assertOk();
        $this->recovery($state['operation_token'], 61)->assertStatus(409);
        $this->actingAs(User::query()->findOrFail(73));
        $this->recovery($state['operation_token'])->assertNotFound();
    }

    public function test_completed_group_does_not_move_to_another_group_or_mark_remainder_empty(): void
    {
        $this->existingPartial();
        DB::table('KeHoachCatNhom')->insert(['id' => 51, 'KeHoachHang_ID' => 40, 'QuyCachCuonChan_ID' => 80]);
        DB::table('KeHoachCatChiTiet')->insert(['id' => 63, 'KeHoachCatNhom_ID' => 51, 'ChieuDaiCanCat' => 40]);
        DB::table('KeHoachCatChiTiet')->whereIn('id', [61, 62])->delete();
        $state = $this->scan();
        $this->postJson('/api/b3/execute/cut', $this->payload($state, 60))->assertOk()
            ->assertJsonPath('cut_session.active', false)->assertJsonPath('cut_session.remaining_length', 400)
            ->assertJsonPath('cut_session.context.groups.0.id', 50);
        $this->assertDatabaseHas('KeHoachCatNhom', ['id' => 51, 'TonCuonLe_ID' => null]);
        $this->assertDatabaseHas('TonCuonLe', ['id' => 70, 'TrangThai' => 'ACTIVE']);
    }

    public function test_physically_empty_reel_is_returned_as_finished_without_resolver_error(): void
    {
        $this->existingPartial();
        DB::table('KeHoachCatChiTiet')->whereIn('id', [61, 62])->delete();
        DB::table('KeHoachCatChiTiet')->where('id', 60)->update(['ChieuDaiCanCat' => 500]);
        $state = $this->scan();
        $this->postJson('/api/b3/execute/cut', $this->payload($state, 60))->assertOk()
            ->assertJsonPath('cut_session.active', false)->assertJsonPath('cut_session.remaining_length', 0)
            ->assertJsonPath('cut_session.direction', 1);
        $this->assertDatabaseHas('TonCuonLe', ['id' => 70, 'SoDau' => 500, 'SoCuoi' => 500, 'TrangThai' => 'HET']);
        $this->recovery($state['operation_token'])->assertOk()->assertJsonPath('cut_session.operation_status', 'SAVED');
    }

    public function test_insufficient_remaining_length_finishes_session_and_cannot_be_cut(): void
    {
        $this->existingPartial(900, 1000);
        DB::table('KeHoachCatChiTiet')->whereIn('id', [60, 62])->delete();
        $this->recovery((string) Str::uuid(), 61)->assertOk()->assertJsonPath('cut_session.active', false);
        $this->postJson('/api/b3/execute/cut', $this->payload(['operation_token' => (string) Str::uuid()], 61))->assertStatus(409);
        $this->assertSame(0, DB::table('LichSuCat')->count());
    }

    public function test_selected_plan_length_changed_after_preview_is_rejected(): void
    {
        $this->existingPartial();
        $state = $this->scan();
        DB::table('KeHoachCatChiTiet')->where('id', 60)->update(['ChieuDaiCanCat' => 125]);
        $this->postJson('/api/b3/execute/cut', $this->payload($state, 60, ['expected_cut_length' => 100]))
            ->assertStatus(409)->assertJsonPath('error_code', 'STALE_DATA');
        $this->assertSame(0, DB::table('LichSuCat')->count());
    }
}
