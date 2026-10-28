<?php

namespace Tests\Unit\B3;

use App\Services\B3\PlanWorklistService;
use App\Services\B3\ProgressService;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class PlanWorklistServiceTest extends TestCase
{
    #[DataProvider('wholeProgressCases')]
    public function test_whole_reels_share_one_row_with_the_planned_total_and_their_own_progress(
        int $taken, string $status, bool $completed
    ): void {
        $rows = $this->project([$this->item(['whole_done' => $taken])]);

        $this->assertCount(1, $rows);
        $this->assertSame('FULL_TAKE', $rows[0]['row_type']);
        $this->assertSame(12, $rows[0]['so_luong_cuon']);
        $this->assertSame($status, $rows[0]['tinh_trang']);
        $this->assertSame($completed, $rows[0]['completed']);
        $this->assertNull($rows[0]['so_cuon_cat_le']);
        $this->assertNull($rows[0]['so_dau']);
        $this->assertNull($rows[0]['so_cuoi']);
        $this->assertNull($rows[0]['lot']);
    }

    public static function wholeProgressCases(): array
    {
        return [
            'not started' => [0, 'Chưa thực hiện (0/12)', false],
            'in progress' => [3, 'Đang thực hiện (3/12)', false],
            'completed' => [12, 'Hoàn thành (12/12)', true],
        ];
    }

    public function test_different_lengths_keep_separate_totals_and_progress(): void
    {
        $rows = $this->project([
            $this->item(['whole_done' => 3]),
            $this->item(['quy_cach_id' => 200, 'standard_length' => 1000,
                'whole_required' => 5, 'whole_done' => 1]),
        ]);

        $this->assertCount(2, $rows);
        $this->assertSame([500, 1000], array_column($rows, 'standard_length'));
        $this->assertSame([12, 5], array_column($rows, 'so_luong_cuon'));
        $this->assertSame(['Đang thực hiện (3/12)', 'Đang thực hiện (1/5)'],
            array_column($rows, 'tinh_trang'));
        $this->assertNotSame($rows[0]['work_id'], $rows[1]['work_id']);
    }

    public function test_twelve_whole_reels_and_two_partial_reels_have_three_rows(): void
    {
        $rows = $this->project([$this->item(), $this->item([
            'quy_cach_id' => null, 'standard_length' => null, 'whole_required' => 0,
            'cut_required' => 2, 'groups' => [
                $this->partialGroup(1, 101, 'LE-01'),
                $this->partialGroup(2, 102, 'LE-02'),
            ],
        ])]);

        $this->assertCount(3, $rows);
        $this->assertSame(['FULL_TAKE', 'PARTIAL_CUT', 'PARTIAL_CUT'], array_column($rows, 'row_type'));
        $this->assertSame([12, null, null], array_column($rows, 'so_luong_cuon'));
        $this->assertSame([null, 1, 1], array_column($rows, 'so_cuon_cat_le'));
        $this->assertSame([null, null, null], array_column($rows, 'so_dau'));
        $this->assertSame([null, null, null], array_column($rows, 'so_cuoi'));
        $this->assertSame([null, 'LE-01', 'LE-02'], array_column($rows, 'lot'));
    }

    public function test_whole_progress_does_not_depend_on_unfinished_cuts(): void
    {
        $rows = $this->project([$this->item([
            'whole_done' => 12, 'cut_required' => 1,
            'groups' => [$this->partialGroup(1, 101, 'LE-01')],
        ])]);

        $this->assertCount(2, $rows);
        $this->assertSame('Hoàn thành (12/12)', $rows[0]['tinh_trang']);
        $this->assertTrue($rows[0]['completed']);
        $this->assertSame('PARTIAL_CUT', $rows[1]['row_type']);
        $this->assertFalse($rows[1]['completed']);
    }

    public function test_cut_only_specification_does_not_add_a_zero_whole_row(): void
    {
        $rows = $this->project([$this->item([
            'whole_required' => 0, 'cut_required' => 1,
            'groups' => [['id' => 1, 'ton_cuon_le_id' => null,
                'details' => [['id' => 1, 'ChieuDaiCanCat' => 100, 'done' => 0]]]],
        ])]);

        $this->assertCount(1, $rows);
        $this->assertSame('FULL_CUT', $rows[0]['row_type']);
        $this->assertNull($rows[0]['so_luong_cuon']);
        $this->assertSame(1, $rows[0]['so_cuon_cat_le']);
    }

    public function test_completed_plan_keeps_its_grouped_whole_row(): void
    {
        $rows = (new PlanWorklistService(new ProgressService))->project([
            'plan' => ['id' => 1, 'MaKeHoach' => 'KH1'], 'complete' => true,
            'items' => [$this->item(['whole_done' => 12, 'complete' => true])],
        ]);

        $this->assertCount(1, $rows);
        $this->assertSame(12, $rows[0]['so_luong_cuon']);
        $this->assertSame('Hoàn thành (12/12)', $rows[0]['tinh_trang']);
        $this->assertTrue($rows[0]['completed']);
    }

    #[DataProvider('twentyWholeAndTwoCutReelCases')]
    public function test_400m_example_has_one_row_per_cut_piece(
        int $wholeDone, array $cutDone, array $statuses
    ): void {
        $rows = $this->project([$this->item([
            'standard_length' => 400, 'whole_required' => 20, 'whole_done' => $wholeDone,
            'cut_required' => 3, 'cut_done' => array_sum($cutDone),
            'groups' => [
                ['id' => 1, 'ton_cuon_le_id' => $cutDone[0] ? 101 : null,
                    'partial' => ['MaCuon' => 'QR-01', 'SoDau' => 70, 'SoCuoi' => 400],
                    'details' => [
                        ['id' => 1, 'ChieuDaiCanCat' => 70, 'done' => $cutDone[0]],
                        ['id' => 2, 'ChieuDaiCanCat' => 100, 'done' => $cutDone[1]],
                    ]],
                ['id' => 2, 'ton_cuon_le_id' => $cutDone[2] ? 102 : null,
                    'details' => [['id' => 3, 'ChieuDaiCanCat' => 150, 'done' => $cutDone[2]]]],
            ],
        ])]);

        $this->assertCount(4, $rows);
        $this->assertSame([20, null, null, null], array_column($rows, 'so_luong_cuon'));
        $this->assertSame([null, 1, 1, 1], array_column($rows, 'so_cuon_cat_le'));
        $this->assertSame([400, 70, 100, 150], array_column($rows, 'chieu_dai_lay'));
        $this->assertCount(4, array_unique(array_column($rows, 'work_id')));
        $this->assertSame(['cut-detail-1', 'cut-detail-2', 'cut-detail-3'],
            array_column(array_slice($rows, 1), 'work_id'));
        $this->assertSame($statuses, array_column($rows, 'tinh_trang'));
    }

    public static function twentyWholeAndTwoCutReelCases(): array
    {
        return [
            'before execution' => [0, [0, 0, 0],
                ['Chưa thực hiện (0/20)', 'Chưa thực hiện', 'Chưa thực hiện', 'Chưa thực hiện']],
            'whole reels taken, cuts pending' => [20, [0, 0, 0],
                ['Hoàn thành (20/20)', 'Đang thực hiện', 'Đang thực hiện', 'Đang thực hiện']],
            'first 70m cut completed' => [20, [1, 0, 0],
                ['Hoàn thành (20/20)', 'Đã thực hiện', 'Đang thực hiện', 'Đang thực hiện']],
            'first cut reel completed' => [20, [1, 1, 0],
                ['Hoàn thành (20/20)', 'Đã thực hiện', 'Đã thực hiện', 'Đang thực hiện']],
            'all completed' => [20, [1, 1, 1],
                ['Hoàn thành (20/20)', 'Đã thực hiện', 'Đã thực hiện', 'Đã thực hiện']],
        ];
    }

    public function test_multiple_groups_on_same_partial_reel_keep_all_cut_details(): void
    {
        $first = $this->partialGroup(1, 101, 'LE-01');
        $first['details'][] = ['id' => 3, 'ChieuDaiCanCat' => 70, 'done' => 1];
        $rows = $this->project([$this->item([
            'whole_required' => 0, 'cut_required' => 3, 'cut_done' => 1,
            'groups' => [$first, $this->partialGroup(2, 101, 'LE-01')],
        ])]);

        $this->assertCount(3, $rows);
        $this->assertSame([100, 70, 100], array_column($rows, 'chieu_dai_lay'));
        $this->assertSame([false, true, false], array_column($rows, 'completed'));
        $this->assertSame([101, 101, 101], array_column($rows, 'ton_cuon_le_id'));
        $this->assertSame([1, 3, 2], array_column($rows, 'detail_id'));
    }

    private function item(array $overrides = []): array
    {
        return array_replace([
            'id' => 10, 'product_id' => 1, 'product_name' => 'A',
            'quy_cach_id' => 100, 'standard_length' => 500,
            'whole_required' => 12, 'whole_done' => 0, 'whole_histories' => [],
            'cut_required' => 0, 'cut_done' => 0, 'groups' => [], 'complete' => false,
        ], $overrides);
    }

    private function partialGroup(int $groupId, int $partialId, string $lot): array
    {
        return ['id' => $groupId, 'ton_cuon_le_id' => $partialId,
            'partial' => ['MaCuon' => $lot, 'SoDau' => 100, 'SoCuoi' => 500],
            'details' => [['id' => $groupId, 'ChieuDaiCanCat' => 100, 'done' => 0]]];
    }

    private function project(array $items): array
    {
        return (new PlanWorklistService(new ProgressService))->project([
            'plan' => ['id' => 1, 'MaKeHoach' => 'KH1'], 'complete' => false, 'items' => $items,
        ]);
    }
}
