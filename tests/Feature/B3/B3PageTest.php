<?php
namespace Tests\Feature\B3;
use Tests\TestCase;
class B3PageTest extends TestCase
{public function test_page_contains_real_b3_shell_without_mock_controls():void{$r=$this->get('/')->assertOk();$r->assertSee('Tình trạng');$r->assertDontSee('Tình huống mock');$r->assertDontSee('Ghi nhớ đăng nhập');$r->assertSee('b3-api.js',false);$r->assertSee('b3-state.js',false);}}
