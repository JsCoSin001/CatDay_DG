<?php

namespace Tests\Feature\B3;

use App\Models\User;
use App\Services\B3\ScanContextService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Mockery;
use Tests\Support\CreatesFactoryFlowSchema;
use Tests\TestCase;

class ScanDiagnosticsTest extends TestCase
{
    use CreatesFactoryFlowSchema;

    private string $logPath;

    protected function setUp(): void
    {
        parent::setUp();
        $this->createFactoryFlowSchema();
        DB::table('users')->insert(['user_id'=>58,'username'=>'catday1','password_hash'=>'hidden','is_active'=>1]);
        $this->logPath = tempnam(sys_get_temp_dir(), 'qr-diagnostics-');
        config(['logging.channels.qr_scan'=>[
            'driver'=>'single','path'=>$this->logPath,'level'=>'debug',
        ]]);
        Log::forgetChannel('qr_scan');
    }

    protected function tearDown(): void
    {
        Log::forgetChannel('qr_scan');
        if (isset($this->logPath) && is_file($this->logPath)) unlink($this->logPath);
        parent::tearDown();
    }

    public function test_success_logs_decoded_qr_user_result_and_request_id_without_tokens(): void
    {
        $service = Mockery::mock(ScanContextService::class);
        $service->shouldReceive('resolve')->once()->with('E7-264772/4-47-00', 1, 58)->andReturn([
            'source'=>['source_type'=>'CUON_LE','product_id'=>6784,'ton_cuon_le_id'=>1],
            'candidate_contexts'=>[['plan'=>['id'=>1,'ma_ke_hoach'=>'123'],
                'available_actions'=>['CUT_PARTIAL_REEL']]],
            'operation_token'=>'operation-secret',
        ]);
        $this->app->instance(ScanContextService::class, $service);
        $response = $this->actingAs(User::findOrFail(58))
            ->withSession(['_token'=>'csrf-secret'])
            ->withHeader('X-CSRF-TOKEN', 'csrf-secret')
            ->postJson('/api/b3/scan/resolve', ['raw_qr'=>'E7-264772/4-47-00','ke_hoach_id'=>1]);
        $response->assertOk();
        $log = file_get_contents($this->logPath);
        $this->assertStringContainsString('qr.request.received', $log);
        $this->assertStringContainsString('qr.request.finished', $log);
        $this->assertStringContainsString('E7-264772/4-47-00', $log);
        $this->assertStringContainsString('"user_id":58', $log);
        $this->assertStringContainsString('CUT_PARTIAL_REEL', $log);
        $this->assertStringContainsString($response->headers->get('X-Request-ID'), $log);
        $this->assertStringNotContainsString('csrf-secret', $log);
        $this->assertStringNotContainsString('operation-secret', $log);
    }

    public function test_csrf_rejection_is_logged_before_scan_controller_can_run(): void
    {
        // Exercise real CSRF validation, which Laravel normally bypasses in tests.
        $this->app['env'] = 'local';
        $service = Mockery::mock(ScanContextService::class);
        $service->shouldNotReceive('resolve');
        $this->app->instance(ScanContextService::class, $service);
        $this->actingAs(User::findOrFail(58))->withSession(['_token'=>'server-secret'])
            ->withHeader('X-CSRF-TOKEN', 'stale-secret')
            ->postJson('/api/b3/scan/resolve', ['raw_qr'=>'E7-264772/4-47-00'])
            ->assertStatus(419)->assertJsonPath('error_code', 'CSRF_TOKEN_MISMATCH');
        $log = file_get_contents($this->logPath);
        $this->assertStringContainsString('CSRF_TOKEN_MISMATCH', $log);
        $this->assertStringContainsString('"csrf_header_matches_current_session":false', $log);
        $this->assertStringContainsString('"user_id":58', $log);
        $this->assertStringNotContainsString('server-secret', $log);
        $this->assertStringNotContainsString('stale-secret', $log);
    }

    public function test_login_logs_token_rotation_without_password_or_token_values(): void
    {
        DB::table('users')->where('user_id',58)->update(['password_hash'=>password_hash('password-secret',PASSWORD_DEFAULT)]);
        $this->withSession(['_token'=>'before-login-secret'])
            ->withHeader('X-CSRF-TOKEN','before-login-secret')
            ->postJson('/login',['username'=>'catday1','password'=>'password-secret'])->assertOk();
        $log = file_get_contents($this->logPath);
        $this->assertStringContainsString('"user_id":58', $log);
        $this->assertStringContainsString('"session_token_changed":true', $log);
        $this->assertStringNotContainsString('password-secret', $log);
        $this->assertStringNotContainsString('before-login-secret', $log);
    }
}
