<?php

namespace App\Http\Controllers\B3;

use App\Http\Controllers\Controller;
use App\Repositories\B3\PlanRepository;
use App\Services\B3\PlanWorklistService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PlanController extends Controller
{
    public function __construct(private PlanRepository $plans, private PlanWorklistService $worklist) {}

    public function index(Request $request): JsonResponse
    {
        return response()->json([
            'success' => true,
            'plans' => $this->plans->activeIncompletePlans((int) $request->user()->getAuthIdentifier(), $request->query('q')),
        ]);
    }

    public function worklist(Request $request, int $id): JsonResponse
    {
        $userId = (int) $request->user()->getAuthIdentifier();
        $this->plans->assertOwnedBy($id, $userId);
        $state = $this->plans->loadPlanState($id, $userId);
        if (!$state['plan']) {
            return response()->json(['success' => false, 'error_code' => 'PLAN_NOT_FOUND', 'message' => 'Không tìm thấy kế hoạch.'], 404);
        }
        if (($state['plan']['TrangThai'] ?? null) !== 'ACTIVE') {
            return response()->json(['success' => false, 'error_code' => 'PLAN_NOT_ACTIVE', 'message' => 'Kế hoạch không còn hiệu lực.'], 409);
        }
        return response()->json([
            'success' => true, 'plan' => $state['plan'], 'complete' => $state['complete'],
            'rows' => $this->worklist->project($state),
        ]);
    }

    public function all(Request $request): JsonResponse
    {
        $userId = (int) $request->user()->getAuthIdentifier();
        $plans = $this->plans->activePlans($userId);
        $states = $this->plans->loadPlanStates(array_column($plans, 'id'), $userId);
        $rows = [];
        foreach ($states as $state) {
            $rows = array_merge($rows, $this->worklist->project($state));
        }
        return response()->json(['success' => true, 'rows' => $rows]);
    }
}
