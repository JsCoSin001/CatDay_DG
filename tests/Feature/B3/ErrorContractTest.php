<?php
namespace Tests\Feature\B3;
use App\Models\User;use Illuminate\Support\Facades\DB;use Tests\Support\CreatesFactoryFlowSchema;use Tests\TestCase;
class ErrorContractTest extends TestCase
{use CreatesFactoryFlowSchema;protected function setUp():void{parent::setUp();$this->createFactoryFlowSchema();DB::table('users')->insert(['user_id'=>1,'username'=>'u','password_hash'=>'x','is_active'=>1]);}public function test_api_requires_auth_with_stable_code():void{$this->postJson('/api/b3/scan/resolve',['raw_qr'=>'x'])->assertStatus(401)->assertJsonPath('error_code','AUTH_REQUIRED');}public function test_malformed_qr_has_stable_error_code():void{$this->actingAs(User::query()->findOrFail(1))->postJson('/api/b3/scan/resolve',['raw_qr'=>'other;x'])->assertStatus(422)->assertJsonPath('error_code','QR_INVALID_FORMAT');}}
