<?php
namespace Tests\Feature\B3;
use Illuminate\Http\Request;use Illuminate\Support\Facades\Route;use Tests\TestCase;
class ProxyHttpsTest extends TestCase
{public function test_forwarded_https_is_seen_as_secure():void{Route::get('/_b3_proxy_test',fn(Request $r)=>response()->json(['secure'=>$r->isSecure(),'url'=>url('/')]));$this->withHeaders(['X-Forwarded-Proto'=>'https','X-Forwarded-Host'=>'factory-test.example.com'])->get('/_b3_proxy_test')->assertOk()->assertJsonPath('secure',true);}}
