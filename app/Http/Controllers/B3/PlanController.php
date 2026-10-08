<?php
namespace App\Http\Controllers\B3;
use App\Http\Controllers\Controller;
use App\Repositories\B3\PlanRepository;
use App\Services\B3\PlanWorklistService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
class PlanController extends Controller{
 public function __construct(private PlanRepository $plans,private PlanWorklistService $worklist){}
 public function index(Request $r):JsonResponse{return response()->json(['success'=>true,'plans'=>$this->plans->activeIncompletePlans($r->query('q'))]);}
 public function worklist(int $id):JsonResponse{$s=$this->plans->loadPlanState($id);if(!$s['plan'])return response()->json(['success'=>false,'error_code'=>'PLAN_NOT_FOUND','message'=>'Không tìm thấy kế hoạch.'],404);if(($s['plan']['TrangThai']??null)!=='ACTIVE')return response()->json(['success'=>false,'error_code'=>'PLAN_NOT_ACTIVE','message'=>'Kế hoạch không còn hiệu lực.'],409);return response()->json(['success'=>true,'plan'=>$s['plan'],'complete'=>$s['complete'],'rows'=>$this->worklist->project($s)]);}
 public function all():JsonResponse{$ps=$this->plans->activeIncompletePlans();$states=$this->plans->loadPlanStates(array_column($ps,'id'));$rows=[];foreach($ps as $p){$rows=array_merge($rows,$this->worklist->project($states[$p['id']]));}return response()->json(['success'=>true,'rows'=>$rows]);}
}
