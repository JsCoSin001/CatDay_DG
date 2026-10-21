<?php

use App\Support\B3\B3Exception;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->web(prepend: [\App\Http\Middleware\ScanDiagnostics::class]);
        $middleware->appendToPriorityList(
            \Illuminate\Session\Middleware\StartSession::class,
            \App\Http\Middleware\ScanDiagnostics::class,
        );
        $middleware->alias([
            'active.user' => \App\Http\Middleware\EnsureActiveUser::class,
            'b3.request-id' => \App\Http\Middleware\B3RequestId::class,
        ]);
        $middleware->trustProxies(
            at: env('TRUSTED_PROXIES', '*'),
            headers: Request::HEADER_X_FORWARDED_FOR |
                Request::HEADER_X_FORWARDED_HOST |
                Request::HEADER_X_FORWARDED_PORT |
                Request::HEADER_X_FORWARDED_PROTO |
                Request::HEADER_X_FORWARDED_AWS_ELB,
        );
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        // Laravel wraps TokenMismatchException as an HTTP 419 before render callbacks run.
        $exceptions->render(function (\Symfony\Component\HttpKernel\Exception\HttpExceptionInterface $e, Request $request) {
            if ($e->getStatusCode() === 419 && ($request->is('api/b3/*') || $request->is('login', 'logout'))) {
                $token = $request->session()->token();
                return response()->json([
                    'success' => false,
                    'error_code' => 'CSRF_TOKEN_MISMATCH',
                    'message' => 'Phiên bảo mật đã thay đổi. Vui lòng thử lại thao tác.',
                    'csrf_token' => $token,
                    'request_id' => $request->attributes->get('b3_request_id'),
                ], 419)->header('X-CSRF-TOKEN', $token)->header('Cache-Control', 'no-store');
            }
        });
        $exceptions->render(function (B3Exception $e, Request $request) {
            if ($request->is('api/b3/*')) {
                Log::warning('B3 business error', [
                    'request_id' => $request->attributes->get('b3_request_id'),
                    'username' => $request->user()?->username,
                    'path' => $request->path(),
                    'error_code' => $e->errorCode,
                    'ke_hoach_id' => $request->input('ke_hoach_id'),
                    'ke_hoach_hang_id' => $request->input('ke_hoach_hang_id'),
                    'group_id' => $request->input('group_id'),
                    'detail_id' => $request->input('detail_id'),
                ]);
                return response()->json(['success'=>false,'error_code'=>$e->errorCode,'message'=>$e->getMessage(),'request_id'=>$request->attributes->get('b3_request_id')], $e->httpStatus);
            }
        });
        $exceptions->render(function (AuthenticationException $e, Request $request) {
            if ($request->is('api/b3/*') || ($request->is('logout') && $request->expectsJson())) {
                return response()->json(['success'=>false,'error_code'=>'AUTH_REQUIRED','message'=>'Phiên đăng nhập đã hết. Vui lòng đăng nhập lại.','csrf_token'=>$request->session()->token()], 401)->header('Cache-Control', 'no-store');
            }
        });
        $exceptions->render(function (\Throwable $e, Request $request) {
            if ($request->is('api/b3/*')) {
                Log::error('B3 unexpected error', [
                    'request_id' => $request->attributes->get('b3_request_id'),
                    'username' => $request->user()?->username,
                    'path' => $request->path(),
                    'ke_hoach_id' => $request->input('ke_hoach_id'),
                    'ke_hoach_hang_id' => $request->input('ke_hoach_hang_id'),
                    'group_id' => $request->input('group_id'),
                    'detail_id' => $request->input('detail_id'),
                    'exception' => $e,
                ]);
                return response()->json(['success'=>false,'error_code'=>'EXECUTION_FAILED','message'=>'Không thể lưu thao tác. Dữ liệu chưa được thay đổi.','request_id'=>$request->attributes->get('b3_request_id')], 500);
            }
        });
    })->create();
