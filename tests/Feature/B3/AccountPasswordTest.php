<?php

namespace Tests\Feature\B3;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Tests\Support\CreatesFactoryFlowSchema;
use Tests\TestCase;

class AccountPasswordTest extends TestCase
{
    use CreatesFactoryFlowSchema;

    protected function setUp(): void
    {
        parent::setUp();
        $this->createFactoryFlowSchema();
        DB::table('users')->insert([
            'user_id' => 58,
            'username' => 'worker',
            'password_hash' => password_hash('OldPassword123!', PASSWORD_DEFAULT),
            'is_active' => 1,
        ]);
    }

    private function payload(array $override = []): array
    {
        return array_merge([
            'current_password' => 'OldPassword123!',
            'new_password' => 'NewPassword456!',
            'new_password_confirmation' => 'NewPassword456!',
        ], $override);
    }

    public function test_guest_cannot_change_password(): void
    {
        $this->postJson('/api/account/password', $this->payload())
            ->assertUnauthorized();
        $this->assertTrue(password_verify('OldPassword123!', User::findOrFail(58)->password_hash));
    }

    public function test_change_password_requires_correct_current_password(): void
    {
        $this->actingAs(User::findOrFail(58))
            ->postJson('/api/account/password', $this->payload(['current_password' => 'wrong']))
            ->assertStatus(422)->assertJsonPath('error_code', 'PASSWORD_CURRENT_INVALID');
        $this->assertTrue(password_verify('OldPassword123!', User::findOrFail(58)->password_hash));
    }

    public function test_new_password_requires_confirmation_minimum_length_and_difference(): void
    {
        $this->actingAs(User::findOrFail(58));
        $this->postJson('/api/account/password', $this->payload(['new_password_confirmation'=>'no']))
            ->assertUnprocessable()->assertJsonValidationErrors('new_password');
        $this->postJson('/api/account/password', $this->payload(['new_password'=>'short', 'new_password_confirmation'=>'short']))
            ->assertUnprocessable()->assertJsonValidationErrors('new_password');
        $this->postJson('/api/account/password', $this->payload(['new_password'=>str_repeat('a',73), 'new_password_confirmation'=>str_repeat('a',73)]))
            ->assertUnprocessable()->assertJsonValidationErrors('new_password');
        $unicodeTooLong = str_repeat('ậ',30);
        $this->postJson('/api/account/password', $this->payload(['new_password'=>$unicodeTooLong, 'new_password_confirmation'=>$unicodeTooLong]))
            ->assertUnprocessable()->assertJsonPath('error_code','PASSWORD_TOO_LONG');
        $this->postJson('/api/account/password', $this->payload([
            'new_password'=>'OldPassword123!', 'new_password_confirmation'=>'OldPassword123!',
        ]))->assertUnprocessable()->assertJsonPath('error_code','PASSWORD_UNCHANGED');
        $this->assertTrue(password_verify('OldPassword123!', User::findOrFail(58)->password_hash));
    }

    public function test_success_persists_hash_rotates_token_and_requires_new_password_for_login(): void
    {
        $this->actingAs(User::findOrFail(58));
        $before = $this->withSession(['_token'=>'before-password-change'])->getJson('/api/b3/session')->json('csrf_token');
        $response = $this->postJson('/api/account/password', $this->payload())
            ->assertOk()->assertJsonPath('success', true)->assertHeader('Cache-Control', 'no-store');
        $this->assertNotSame($before, $response->json('csrf_token'));
        $this->assertArrayNotHasKey('password_hash', $response->json());
        $saved = User::findOrFail(58)->password_hash;
        $this->assertTrue(password_verify('NewPassword456!', $saved));
        $this->assertFalse(password_verify('OldPassword123!', $saved));
        $this->getJson('/api/b3/session')->assertOk()->assertJsonPath('user.username', 'worker');
        $this->postJson('/logout')->assertOk();
        $this->postJson('/login',['username'=>'worker','password'=>'OldPassword123!'])->assertUnprocessable();
        $this->postJson('/login',['username'=>'worker','password'=>'NewPassword456!'])->assertOk();
    }

    public function test_inactive_account_cannot_change_password(): void
    {
        DB::table('users')->where('user_id',58)->update(['is_active'=>0]);
        $this->actingAs(User::findOrFail(58))
            ->postJson('/api/account/password',$this->payload())
            ->assertStatus(403)->assertJsonPath('error_code','USER_INACTIVE');
    }
}
