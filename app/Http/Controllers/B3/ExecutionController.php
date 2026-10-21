<?php

namespace App\Http\Controllers\B3;

use App\Http\Controllers\Controller;
use App\Http\Requests\B3\CutReelRequest;
use App\Http\Requests\B3\CutSessionRequest;
use App\Http\Requests\B3\TakeWholeReelRequest;
use App\Services\B3\CutSessionService;
use App\Services\B3\ExecutionService;

class ExecutionController extends Controller
{
    public function __construct(private ExecutionService $service) {}

    public function takeWhole(TakeWholeReelRequest $r)
    {
        return response()->json($this->service->takeWhole(
            $r->string('raw_qr')->toString(), $r->integer('ke_hoach_id'), $r->integer('ke_hoach_hang_id'),
            $r->integer('quy_cach_cuon_chan_id'), $r->string('operation_token')->toString(), $r->user(),
        ));
    }

    public function cut(CutReelRequest $r)
    {
        return response()->json($this->service->cut(
            $r->string('raw_qr')->toString(), $r->integer('ke_hoach_id'), $r->integer('ke_hoach_hang_id'),
            $r->integer('group_id'), $r->integer('detail_id'),
            $r->input('end_value') !== null ? (int)$r->input('end_value') : null,
            $r->input('direction') !== null ? (int)$r->input('direction') : null,
            $r->string('operation_token')->toString(), $r->user(), $r->input('source_version'),
            $r->has('expected_cut_length') ? $r->integer('expected_cut_length') : null,
        ));
    }

    public function cutSession(CutSessionRequest $r, CutSessionService $session)
    {
        return response()->json(['success' => true, 'cut_session' => $session->recover(
            $r->string('raw_qr')->toString(), $r->integer('ke_hoach_id'), $r->integer('ke_hoach_hang_id'),
            $r->integer('group_id'), $r->user(), $r->input('operation_token'),
            $r->input('detail_id') !== null ? $r->integer('detail_id') : null,
        )])->header('Cache-Control', 'no-store');
    }
}
