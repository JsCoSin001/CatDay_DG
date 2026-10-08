<?php
namespace Tests\Feature\B3;
use Tests\TestCase;use Tests\Support\CreatesFactoryFlowSchema;use Illuminate\Support\Facades\DB;use Illuminate\Support\Facades\Hash;
class AuthTest extends TestCase
{use CreatesFactoryFlowSchema;protected function setUp():void{parent::setUp();$this->createFactoryFlowSchema();}public function test_active_user_can_login_and_inactive_cannot():void{DB::table('users')->insert([['username'=>'ok','password_hash'=>Hash::make('pw'),'is_active'=>1],['username'=>'off','password_hash'=>Hash::make('pw'),'is_active'=>0]]);$this->postJson('/login',['username'=>'ok','password'=>'pw'])->assertOk()->assertJsonPath('user.username','ok');$this->postJson('/logout')->assertOk();$this->postJson('/login',['username'=>'off','password'=>'pw'])->assertStatus(422);}}
