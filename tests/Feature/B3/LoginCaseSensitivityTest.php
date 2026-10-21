<?php

namespace Tests\Feature\B3;

use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\CreatesFactoryFlowSchema;
use Tests\TestCase;

class LoginCaseSensitivityTest extends TestCase
{
    use CreatesFactoryFlowSchema;

    protected function setUp(): void
    {
        parent::setUp();
        $this->createFactoryFlowSchema();
        DB::table('users')->insert([
            'user_id'=>58,'username'=>'CatDay1',
            'password_hash'=>password_hash('MatKhauAbC123', PASSWORD_DEFAULT),'is_active'=>1,
        ]);
    }

    #[DataProvider('usernameVariants')]
    public function test_username_is_case_insensitive_and_preserves_stored_identity(string $username): void
    {
        $this->postJson('/login', ['username'=>$username,'password'=>'MatKhauAbC123'])
            ->assertOk()->assertJsonPath('user.user_id',58)->assertJsonPath('user.username','CatDay1');
        $this->getJson('/api/b3/session')->assertOk()->assertJsonPath('user.user_id',58);
        $this->assertDatabaseHas('users',['user_id'=>58,'username'=>'CatDay1']);
    }

    public static function usernameVariants(): array
    {
        return [['catday1'], ['CATDAY1'], ['cAtDaY1'], ['CatDay1']];
    }

    #[DataProvider('incorrectPasswords')]
    public function test_password_still_requires_the_exact_letter_case(string $password): void
    {
        $this->postJson('/login', ['username'=>'CATDAY1','password'=>$password])
            ->assertStatus(422)->assertJsonPath('error_code','AUTH_INVALID');
        $this->assertGuest();
    }

    public static function incorrectPasswords(): array
    {
        return [['matkhauabc123'], ['MATKHAUABC123'], ['MatKhauAbc123']];
    }

    public function test_inactive_user_cannot_login_with_different_username_case(): void
    {
        DB::table('users')->where('user_id',58)->update(['is_active'=>0]);
        $this->postJson('/login', ['username'=>'CATDAY1','password'=>'MatKhauAbC123'])
            ->assertStatus(422)->assertJsonPath('error_code','AUTH_INVALID');
        $this->assertGuest();
    }
}
