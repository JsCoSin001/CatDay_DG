<?php
namespace App\Http\Controllers\B3;
use App\Http\Controllers\Controller;
use App\Http\Requests\B3\ResolveScanRequest;
use App\Services\B3\ScanContextService;
class ScanController extends Controller{public function __construct(private ScanContextService $service){} public function resolve(ResolveScanRequest $r){return response()->json(['success'=>true]+$this->service->resolve($r->string('raw_qr')->toString(),$r->integer('ke_hoach_id')?:null));}}
