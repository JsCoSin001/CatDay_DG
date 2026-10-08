<?php
namespace Tests\Feature\B3;
use Tests\TestCase;
class ConcurrencyAndIdempotencyTest extends TestCase
{
 public function test_idempotency_is_persisted_in_history_not_process_cache():void{$code=file_get_contents(app_path('Repositories/B3/ExecutionRepository.php'));$this->assertStringContainsString('__B3_OP__:', $code);$this->assertStringContainsString('LichSuLayCuon',$code);$this->assertStringContainsString('LichSuCat',$code);}
}
