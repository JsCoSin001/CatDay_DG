<?php

namespace App\Repositories\B3;

use Illuminate\Support\Facades\DB;

class InventoryRepository
{
    public function partialByExactCode(string $maCuon): ?array
    {
        $row = DB::table('TonCuonLe as TCL')
            ->join('TTThanhPham as TP', 'TP.id', '=', 'TCL.TTThanhPham_ID')
            ->leftJoin('TTCuonDay as SRC_CD', 'SRC_CD.id', '=', 'TCL.TTCuonDay_ID')
            ->leftJoin('TTNhapKhoTP as SRC_NK', 'SRC_NK.id', '=', 'SRC_CD.ThongTinNhapKho_ID')
            ->leftJoin('TTThanhPham as SRC_TP', 'SRC_TP.id', '=', 'SRC_NK.TTThanhPham_ID')
            ->where('TCL.MaCuon', $maCuon)
            ->select(
                'TCL.*',
                'TP.DanhSachSP_ID as product_id', 'TP.MaBin as ma_bin', 'TP.NhapKho as nhap_kho', 'TP.Temp as temp',
                'SRC_CD.id as source_ttc_id', 'SRC_CD.SoDau as source_so_dau', 'SRC_CD.SoCuoi as source_so_cuoi',
                'SRC_NK.id as source_nhap_kho_id',
                'SRC_TP.id as source_tt_thanh_pham_id', 'SRC_TP.DanhSachSP_ID as source_product_id',
                'SRC_TP.NhapKho as source_nhap_kho', 'SRC_TP.Temp as source_temp'
            )
            ->first();
        return $row ? (array) $row : null;
    }

    public function fullByMaBin(string $maBin): ?array
    {
        $row = DB::table('TTThanhPham as TP')
            ->join('TTNhapKhoTP as NK', 'NK.TTThanhPham_ID', '=', 'TP.id')
            ->join('TTCuonDay as CD', 'CD.ThongTinNhapKho_ID', '=', 'NK.id')
            ->where('TP.MaBin', $maBin)
            ->where('TP.NhapKho', 1)
            ->where('TP.Temp', 0)
            ->whereNull('CD.SoDau')->whereNull('CD.SoCuoi')
            ->select('TP.id as tt_thanh_pham_id', 'TP.DanhSachSP_ID as product_id', 'TP.MaBin as ma_bin')
            ->first();
        if (!$row) return null;
        $a = (array) $row;
        $a['actual'] = $this->fullActualForMaBin($maBin, (int)$a['product_id']);
        return $a;
    }

    public function fullActualForProduct(int $productId, ?int $standardLength = null): int
    {
        return array_sum(array_column($this->eligibleFullSources($productId, $standardLength), 'remaining'));
    }

    public function fullActualForMaBin(string $maBin, int $productId, ?int $standardLength = null): int
    {
        return array_sum(array_column($this->eligibleFullSources($productId, $standardLength, $maBin), 'remaining'));
    }

    public function fifoFullSourceForProduct(int $productId, int $standardLength): ?array
    {
        return $this->eligibleFullSources($productId, $standardLength)[0] ?? null;
    }

    public function fifoFullSourceForMaBin(string $maBin, int $productId, int $standardLength): ?array
    {
        return $this->eligibleFullSources($productId, $standardLength, $maBin)[0] ?? null;
    }

    public function eligibleFullSources(int $productId, ?int $standardLength = null, ?string $maBin = null): array
    {
        $query = DB::table('TTCuonDay as CD')
            ->join('TTNhapKhoTP as NK', 'NK.id', '=', 'CD.ThongTinNhapKho_ID')
            ->join('TTThanhPham as TP', 'TP.id', '=', 'NK.TTThanhPham_ID')
            ->where('TP.DanhSachSP_ID', $productId)
            ->where('TP.NhapKho', 1)->where('TP.Temp', 0)
            ->whereNull('CD.SoDau')->whereNull('CD.SoCuoi');
        if ($standardLength !== null) $query->where('CD.ChieuDai_1cuon', $standardLength);
        if ($maBin !== null) $query->where('TP.MaBin', $maBin);

        $rows = $query->select(
            'CD.id', 'CD.SoCuon', 'CD.ChieuDai_1cuon', 'CD.DateInsert', 'CD.Ngay',
            'NK.NgayNhapKho', 'NK.DateInsert as nk_date_insert',
            'TP.id as tt_thanh_pham_id', 'TP.MaBin as ma_bin', 'TP.DanhSachSP_ID as product_id'
        )->orderByRaw("COALESCE(NULLIF(NK.NgayNhapKho,''), NULLIF(NK.DateInsert,''), NULLIF(CD.Ngay,''), NULLIF(CD.DateInsert,''), '9999-12-31') ASC")
          ->orderBy('CD.id')->get();

        if ($rows->isEmpty()) return [];
        $ids = $rows->pluck('id')->all();
        $take = DB::table('LichSuLayCuon')->whereIn('TTCuonDay_ID', $ids)->selectRaw('TTCuonDay_ID, SUM(SoLuong) used')->groupBy('TTCuonDay_ID')->pluck('used', 'TTCuonDay_ID');
        $cut = DB::table('LichSuCat as LS')
            ->join('TonCuonLe as TCL', 'TCL.id', '=', 'LS.TonCuonLe_ID')
            ->where('LS.LoaiNguon', 'CUON_CHAN')->whereIn('TCL.TTCuonDay_ID', $ids)
            ->selectRaw('TCL.TTCuonDay_ID, COUNT(*) used')->groupBy('TCL.TTCuonDay_ID')->pluck('used', 'TTCuonDay_ID');

        $out=[];
        foreach ($rows as $r) {
            $remaining = max(0, (int)$r->SoCuon - (int)($take[$r->id] ?? 0) - (int)($cut[$r->id] ?? 0));
            if ($remaining <= 0) continue;
            $a=(array)$r; $a['remaining']=$remaining; $out[]=$a;
        }
        return $out;
    }

    public function partialReservedLength(int $tonCuonLeId): int
    {
        return (int) DB::table('KeHoachCatChiTiet as CT')
            ->join('KeHoachCatNhom as N', 'N.id', '=', 'CT.KeHoachCatNhom_ID')
            ->join('KeHoachHang as KH', 'KH.id', '=', 'N.KeHoachHang_ID')
            ->join('KeHoach as K', 'K.id', '=', 'KH.KeHoach_ID')
            ->leftJoin('LichSuCat as LS', 'LS.KeHoachCatChiTiet_ID', '=', 'CT.id')
            ->where('K.TrangThai', 'ACTIVE')->where('N.TonCuonLe_ID', $tonCuonLeId)->whereNull('LS.id')
            ->sum('CT.ChieuDaiCanCat');
    }

    public function fullReservedForProduct(int $productId): int
    {
        $whole = DB::table('KeHoachHang as KH')->join('KeHoach as K','K.id','=','KH.KeHoach_ID')
            ->where('K.TrangThai','ACTIVE')->where('KH.DanhSachMaSP_ID',$productId)
            ->selectRaw('COALESCE(SUM(CASE WHEN KH.SoLuongCuonCanLay > COALESCE((SELECT SUM(LSL.SoLuong) FROM LichSuLayCuon LSL WHERE LSL.KeHoachHang_ID = KH.id),0) THEN KH.SoLuongCuonCanLay - COALESCE((SELECT SUM(LSL2.SoLuong) FROM LichSuLayCuon LSL2 WHERE LSL2.KeHoachHang_ID = KH.id),0) ELSE 0 END),0) v')->value('v');
        $groups = DB::table('KeHoachCatNhom as N')->join('KeHoachHang as KH','KH.id','=','N.KeHoachHang_ID')->join('KeHoach as K','K.id','=','KH.KeHoach_ID')
            ->where('K.TrangThai','ACTIVE')->where('KH.DanhSachMaSP_ID',$productId)->whereNull('N.TonCuonLe_ID')
            ->whereExists(function($q){$q->selectRaw('1')->from('KeHoachCatChiTiet as CT')->leftJoin('LichSuCat as LS','LS.KeHoachCatChiTiet_ID','=','CT.id')->whereColumn('CT.KeHoachCatNhom_ID','N.id')->whereNull('LS.id');})->count();
        return max(0,(int)$whole)+(int)$groups;
    }
}
