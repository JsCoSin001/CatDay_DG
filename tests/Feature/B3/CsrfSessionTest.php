<?php

namespace Tests\Feature\B3;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Tests\Support\CreatesFactoryFlowSchema;
use Tests\TestCase;

class CsrfSessionTest extends TestCase
{
    use CreatesFactoryFlowSchema;

    protected function setUp(): void
    {
        parent::setUp();
        $this->assertSame(':memory:', config('database.connections.sqlite.database'));
        $this->createFactoryFlowSchema();
        DB::table('users')->insert([
            'user_id' => 58, 'username' => 'CatDay1', 'name' => 'Người cắt',
            'password_hash' => password_hash('PassSecret', PASSWORD_DEFAULT), 'is_active' => 1,
        ]);
        // Laravel normally disables CSRF validation for tests; use the real middleware here.
        $this->app['env'] = 'local';
        Route::post('/api/b3/csrf-probe', fn () => response()->json(['success' => true]))
            ->middleware(['web', 'auth', 'active.user']);
    }

    public function test_login_returns_rotated_token_accepted_by_real_csrf_middleware(): void
    {
        $response = $this->withSession(['_token' => 'page-token'])
            ->withHeader('X-CSRF-TOKEN', 'page-token')
            ->postJson('/login', ['username' => 'cAtDaY1', 'password' => 'PassSecret'])
            ->assertOk()->assertJsonPath('user.username', 'CatDay1');
        $token = $response->json('csrf_token');
        $this->assertIsString($token);
        $this->assertNotSame('page-token', $token);
        $this->withHeader('X-CSRF-TOKEN', $token)->postJson('/api/b3/csrf-probe')->assertOk();
        $this->getJson('/api/b3/session')->assertOk()->assertJsonPath('csrf_token', $token);
    }

    public function test_logout_returns_new_guest_token_that_allows_login_again(): void
    {
        $login = $this->withSession(['_token' => 'page-token'])->withHeader('X-CSRF-TOKEN', 'page-token')
            ->postJson('/login', ['username' => 'catday1', 'password' => 'PassSecret'])->assertOk();
        $loginToken = $login->json('csrf_token') ?? session()->token();
        $logout = $this->withHeader('X-CSRF-TOKEN', $loginToken)->postJson('/logout')->assertOk();
        $token = $logout->json('csrf_token');
        $this->assertIsString($token);
        $this->assertNotSame($loginToken, $token);
        $this->withHeader('X-CSRF-TOKEN', $token)->postJson('/login', [
            'username' => 'CATDAY1', 'password' => 'PassSecret',
        ])->assertOk();
    }

    public function test_stale_token_is_419_and_supplies_current_token_without_executing_write(): void
    {
        $this->withSession(['_token' => 'current-token'])->withHeader('X-CSRF-TOKEN', 'old-token')
            ->postJson('/api/b3/csrf-probe')
            ->assertStatus(419)->assertJsonPath('error_code', 'CSRF_TOKEN_MISMATCH')
            ->assertJsonPath('csrf_token', 'current-token')->assertHeader('X-CSRF-TOKEN', 'current-token');
    }

    public function test_guest_session_check_can_refresh_token_before_logging_in(): void
    {
        $this->withSession(['_token' => 'guest-token'])->getJson('/api/b3/session')
            ->assertUnauthorized()->assertJsonPath('error_code', 'AUTH_REQUIRED')
            ->assertJsonPath('csrf_token', 'guest-token');
    }

    public function test_stale_login_is_419_and_password_remains_case_sensitive(): void
    {
        $this->withSession(['_token' => 'current-token'])->withHeader('X-CSRF-TOKEN', 'old-token')
            ->postJson('/login', ['username' => 'catday1', 'password' => 'PassSecret'])
            ->assertStatus(419)->assertJsonPath('error_code', 'CSRF_TOKEN_MISMATCH');
        $this->withHeader('X-CSRF-TOKEN', 'current-token')
            ->postJson('/login', ['username' => 'catday1', 'password' => 'passsecret'])
            ->assertStatus(422)->assertJsonPath('error_code', 'AUTH_INVALID');
        $this->assertGuest();
    }
}
