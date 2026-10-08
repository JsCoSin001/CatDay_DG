<?php
namespace Tests\Feature\B3;
use Tests\TestCase;use Tests\Support\CreatesFactoryFlowSchema;use Illuminate\Support\Facades\DB;
class DatabaseRuntimeTest extends TestCase
{use CreatesFactoryFlowSchema;protected function setUp():void{parent::setUp();$this->createFactoryFlowSchema();}public function test_sqlite_foreign_keys_are_enabled():void{$this->assertSame(1,(int)DB::selectOne('PRAGMA foreign_keys')->foreign_keys);}public function test_framework_storage_does_not_require_database_tables():void{$this->assertNotSame('database',config('session.driver'));$this->assertNotSame('database',config('cache.default'));}}
