<?php
namespace App\Http\Controllers\B3;
use App\Http\Controllers\Controller;
use App\Http\Requests\B3\TakeWholeReelRequest;
use App\Http\Requests\B3\CutReelRequest;
use App\Services\B3\ExecutionService;
class ExecutionController extends Controller{
 public function __construct(private ExecutionService $service){}
 public function takeWhole(TakeWholeReelRequest $r){return response()->json($this->service->takeWhole($r->string('raw_qr')->toString(),$r->integer('ke_hoach_id'),$r->integer('ke_hoach_hang_id'),$r->string('operation_token')->toString(),$r->user()));}
 public function cut(CutReelRequest $r){return response()->json($this->service->cut($r->string('raw_qr')->toString(),$r->integer('ke_hoach_id'),$r->integer('ke_hoach_hang_id'),$r->integer('group_id'),$r->integer('detail_id'),$r->input('end_value')!==null?(int)$r->input('end_value'):null,$r->input('direction')!==null?(int)$r->input('direction'):null,$r->string('operation_token')->toString(),$r->user()));}
}
