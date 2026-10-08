<?php
namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureActiveUser
{
    public function handle(Request $request, Closure $next): Response
    {
        $user=$request->user();
        if(!$user || !(bool)$user->is_active){
            if($user) auth()->logout();
            return response()->json(['success'=>false,'error_code'=>'USER_INACTIVE','message'=>'Tài khoản không còn hoạt động.'],403);
        }
        return $next($request);
    }
}
