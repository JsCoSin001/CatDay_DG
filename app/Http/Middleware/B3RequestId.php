<?php
namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

class B3RequestId
{
    public function handle(Request $request, Closure $next): Response
    {
        $requestId = $request->attributes->get('b3_request_id')
            ?: (trim((string) $request->header('X-Request-ID')) ?: (string) Str::uuid());
        $request->attributes->set('b3_request_id', $requestId);
        $response = $next($request);
        $response->headers->set('X-Request-ID', $requestId);
        return $response;
    }
}
