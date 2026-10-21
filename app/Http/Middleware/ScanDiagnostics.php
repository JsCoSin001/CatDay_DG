<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Session\TokenMismatchException;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

class ScanDiagnostics
{
    public function handle(Request $request, Closure $next): Response
    {
        if (!$request->is('api/b3/scan/resolve', 'api/b3/session', 'login', 'logout')) {
            return $next($request);
        }

        $started = hrtime(true);
        $requestId = (string) Str::uuid();
        $request->attributes->set('b3_request_id', $requestId);
        $beforeToken = $request->hasSession() ? $request->session()->token() : null;
        $base = [
            'request_id'=>$requestId,
            'method'=>$request->method(), 'path'=>$request->path(),
            'raw_qr'=>$request->is('api/b3/scan/resolve') && is_string($request->input('raw_qr'))
                ? mb_substr($request->input('raw_qr'), 0, 2000) : null,
            'ke_hoach_id'=>filter_var($request->input('ke_hoach_id'), FILTER_VALIDATE_INT) ?: null,
        ];
        $this->write('info', 'qr.request.received', $base + $this->sessionContext($request));

        $response = $next($request);
        $response->headers->set('X-Request-ID', $requestId);
        $body = method_exists($response, 'getData') ? $response->getData(true) : [];
        $body = is_array($body) ? $body : [];
        $exception = $response->exception ?? null;
        $diagnosticCode = $body['error_code'] ?? null;
        for ($cause = $exception; $cause; $cause = $cause->getPrevious()) {
            if ($cause instanceof TokenMismatchException) {
                $diagnosticCode = 'CSRF_TOKEN_MISMATCH';
                break;
            }
        }
        $contexts = [];
        foreach (($body['candidate_contexts'] ?? []) as $context) {
            $contexts[] = ['plan_id'=>$context['plan']['id'] ?? null,
                'ma_ke_hoach'=>$context['plan']['ma_ke_hoach'] ?? null,
                'available_actions'=>$context['available_actions'] ?? []];
        }
        $afterToken = $request->hasSession() ? $request->session()->token() : null;
        $this->write($response->getStatusCode() >= 400 ? 'warning' : 'info', 'qr.request.finished',
            $base + $this->sessionContext($request) + [
                'http_status'=>$response->getStatusCode(),
                'success'=>$body['success'] ?? $response->isSuccessful(),
                'error_code'=>$body['error_code'] ?? null,
                'diagnostic_code'=>$diagnosticCode,
                'exception_class'=>$exception ? get_class($exception) : null,
                'session_token_changed'=>is_string($beforeToken) && is_string($afterToken)
                    && !hash_equals($beforeToken, $afterToken),
                'source_type'=>$body['source']['source_type'] ?? null,
                'product_id'=>$body['source']['product_id'] ?? null,
                'ton_cuon_le_id'=>$body['source']['ton_cuon_le_id'] ?? null,
                'candidate_contexts'=>$contexts,
                'duration_ms'=>round((hrtime(true) - $started) / 1_000_000, 2),
            ]);
        return $response;
    }

    private function sessionContext(Request $request): array
    {
        $token = $request->hasSession() ? $request->session()->token() : null;
        $header = $request->header('X-CSRF-TOKEN');
        return [
            'user_id'=>$request->user()?->getAuthIdentifier(),
            'username'=>$request->user()?->username,
            'has_session'=>$request->hasSession(),
            'csrf_header_present'=>is_string($header) && $header !== '',
            'csrf_header_matches_current_session'=>is_string($token) && is_string($header)
                && hash_equals($token, $header),
        ];
    }

    private function write(string $level, string $event, array $context): void
    {
        try {
            Log::channel('qr_scan')->log($level, $event, $context + [
                'observed_at'=>now('Asia/Ho_Chi_Minh')->toIso8601String(),
            ]);
        } catch (\Throwable $ignored) {
            // Diagnostics must not interrupt scanning if the log cannot be written.
        }
    }
}
