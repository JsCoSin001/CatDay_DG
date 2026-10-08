<?php
use App\Http\Controllers\AuthController;
use App\Http\Controllers\B3\B3PageController;
use App\Http\Controllers\B3\PlanController;
use App\Http\Controllers\B3\ScanController;
use App\Http\Controllers\B3\ExecutionController;
use Illuminate\Support\Facades\Route;

Route::get('/', B3PageController::class)->name('b3.page');
Route::get('/b3', B3PageController::class)->name('b3.page.explicit');
Route::post('/login',[AuthController::class,'login'])->middleware('throttle:10,1');
Route::post('/logout',[AuthController::class,'logout'])->middleware('auth');
Route::get('/api/b3/session',[AuthController::class,'status'])->middleware(['b3.request-id','auth','active.user']);
Route::middleware(['b3.request-id','auth','active.user'])->group(function(){
 Route::get('/api/b3/plans',[PlanController::class,'index']);
 Route::get('/api/b3/plans/{id}/worklist',[PlanController::class,'worklist']);
 Route::get('/api/b3/worklist',[PlanController::class,'all']);
 Route::post('/api/b3/scan/resolve',[ScanController::class,'resolve']);
 Route::post('/api/b3/execute/take-whole',[ExecutionController::class,'takeWhole']);
 Route::post('/api/b3/execute/cut',[ExecutionController::class,'cut']);
});
