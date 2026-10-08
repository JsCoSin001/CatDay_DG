<?php

namespace Tests\Support;

use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

trait CreatesFactoryFlowSchema
{
    protected function createFactoryFlowSchema(): void
    {
        Schema::dropAllTables();

        Schema::create('users', function (Blueprint $t) {
            $t->increments('user_id'); $t->string('username')->unique(); $t->string('name')->nullable();
            $t->string('password_hash'); $t->integer('is_active')->default(1); $t->string('Code')->nullable();
        });
        Schema::create('DanhSachMaSP', function (Blueprint $t) {
            $t->increments('id'); $t->string('Ten'); $t->string('Ma')->unique(); $t->string('DonVi')->default('m'); $t->string('KieuSP')->default('TP');
        });
        Schema::create('TTThanhPham', function (Blueprint $t) {
            $t->increments('id'); $t->unsignedInteger('DanhSachSP_ID'); $t->string('MaBin')->unique(); $t->integer('NhapKho')->default(0); $t->integer('Temp')->default(1); $t->integer('Active')->default(1);
        });
        Schema::create('TTNhapKhoTP', function (Blueprint $t) {
            $t->increments('id'); $t->string('NgayNhapKho')->nullable(); $t->unsignedInteger('TTThanhPham_ID')->unique(); $t->string('TenSP')->default(''); $t->double('TongChieuDai')->default(0); $t->string('GhiChu')->default(''); $t->string('NguoiLam')->default(''); $t->string('DateInsert')->nullable();
        });
        Schema::create('TTCuonDay', function (Blueprint $t) {
            $t->increments('id'); $t->integer('SoCuon')->nullable(); $t->integer('ChieuDai_1cuon'); $t->integer('SoDau')->nullable(); $t->integer('SoCuoi')->nullable(); $t->unsignedInteger('ThongTinNhapKho_ID'); $t->string('Ngay')->nullable(); $t->string('DateInsert')->nullable();
        });
        Schema::create('KeHoach', function (Blueprint $t) {
            $t->increments('id'); $t->string('MaKeHoach')->unique(); $t->string('NgayKeHoach'); $t->string('NguoiNhan')->nullable(); $t->string('TrangThai')->default('ACTIVE'); $t->string('GhiChu')->nullable(); $t->string('NguoiTao')->nullable();
        });
        Schema::create('KeHoachHang', function (Blueprint $t) {
            $t->increments('id'); $t->unsignedInteger('KeHoach_ID'); $t->unsignedInteger('DanhSachMaSP_ID'); $t->integer('SoLuongCuonCanLay')->default(0); $t->integer('ChieuDai1Cuon_KeHoach')->nullable(); $t->unique(['KeHoach_ID','DanhSachMaSP_ID']);
        });
        Schema::create('TonCuonLe', function (Blueprint $t) {
            $t->increments('id'); $t->string('MaCuon')->unique(); $t->unsignedInteger('TTThanhPham_ID'); $t->unsignedInteger('TTCuonDay_ID'); $t->integer('SoDau'); $t->integer('SoCuoi'); $t->string('TrangThai')->default('ACTIVE'); $t->string('GhiChu')->nullable();
        });
        Schema::create('KeHoachCatNhom', function (Blueprint $t) {
            $t->increments('id'); $t->unsignedInteger('KeHoachHang_ID'); $t->unsignedInteger('TonCuonLe_ID')->nullable(); $t->string('GhiChu')->nullable();
        });
        Schema::create('KeHoachCatChiTiet', function (Blueprint $t) {
            $t->increments('id'); $t->unsignedInteger('KeHoachCatNhom_ID'); $t->integer('ChieuDaiCanCat'); $t->string('GhiChu')->nullable();
        });
        Schema::create('LichSuLayCuon', function (Blueprint $t) {
            $t->increments('id'); $t->unsignedInteger('KeHoachHang_ID'); $t->unsignedInteger('TTCuonDay_ID'); $t->integer('SoLuong'); $t->string('NguoiThucHien'); $t->string('GhiChu')->nullable();
        });
        Schema::create('LichSuCat', function (Blueprint $t) {
            $t->increments('id'); $t->unsignedInteger('KeHoachCatChiTiet_ID')->unique(); $t->unsignedInteger('TonCuonLe_ID'); $t->string('LoaiNguon'); $t->integer('ChieuDaiCat');
            $t->integer('SoDauTruoc'); $t->integer('SoCuoiTruoc'); $t->integer('SoDauCat'); $t->integer('SoCuoiCat'); $t->integer('SoDauSau'); $t->integer('SoCuoiSau'); $t->integer('HeSoChieu'); $t->string('MaQuetThucTe'); $t->string('NguoiThucHien'); $t->string('GhiChu')->nullable();
        });
    }
}
