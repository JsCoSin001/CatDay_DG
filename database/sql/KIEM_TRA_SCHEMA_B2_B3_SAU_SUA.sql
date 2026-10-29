-- SQL CHI DOC: kiem tra schema B2/B3 sau khi bo B3TinhNangDuLieu.
-- Chay tren BAN SAO dung DB ma B2/B3 tro toi (SQLite / DB Browser).
-- Khong tao/sua/xoa bat ky du lieu nao.

SELECT '01_BoBangTinhNang' AS KiemTra,
       CASE WHEN NOT EXISTS (
         SELECT 1 FROM sqlite_master
         WHERE type='table' AND name='B3TinhNangDuLieu'
       ) THEN 'PASS' ELSE 'FAIL' END AS KetQua;

SELECT '02_DuSauBangBatBuoc' AS KiemTra,
       CASE WHEN (
         SELECT COUNT(*) FROM sqlite_master
         WHERE type='table' AND name IN (
           'B3ThaoTac','B3QrSuDung','B3PhienBanDuLieu',
           'B2DieuChinhLanLuu','B2DieuChinhSuKien','B2DieuChinhKetQua'
         )
       )=6 THEN 'PASS' ELSE 'FAIL' END AS KetQua;

SELECT '03_KhongConSQLDoiTuongThamChieuBangCu' AS KiemTra,
       CASE WHEN NOT EXISTS (
         SELECT 1 FROM sqlite_master
         WHERE type IN ('view','trigger')
           AND instr(lower(coalesce(sql,'')), 'b3tinhnangdulieu') > 0
       ) THEN 'PASS' ELSE 'FAIL' END AS KetQua;

SELECT '04_CoKhoaTheoDoiThayDoi' AS KiemTra,
       CASE WHEN (
         SELECT COUNT(*) FROM B3PhienBanDuLieu WHERE Khoa='FACTORY'
       )=1 THEN 'PASS' ELSE 'FAIL' END AS KetQua;

SELECT '05_GiuPhienBanDinhDangNhatKy' AS KiemTra,
       CASE WHEN EXISTS (
         SELECT 1 FROM pragma_table_info('B2DieuChinhKetQua')
         WHERE name='PhienBan'
       ) THEN 'PASS' ELSE 'FAIL' END AS KetQua;

SELECT '06_GiuTriggerBaoVeNhatKy' AS KiemTra,
       CASE WHEN (
         SELECT COUNT(*) FROM sqlite_master WHERE type='trigger'
           AND name IN ('TR_B3ThaoTac_NoDelete','TR_B2LanLuu_NoDelete','TR_B3Version_NoDecrease')
       )=3 THEN 'PASS' ELSE 'FAIL' END AS KetQua;

-- Mong doi: 0 dong (khong co loi khoa ngoai).
PRAGMA foreign_key_check;

-- Mong doi: 1 dong, gia tri 'ok'.
PRAGMA integrity_check;

-- Sau khi don du lieu thu plan 123: KeHoach 123 = 0,
-- B3QrSuDung = 0, LichSuCat = 0, LichSuLayCuon = 0
-- NEU database da co du lieu thu MOI, dung cac truy van theo plan phu hop,
-- KHONG coi COUNT(*) tat ca bang = 0 la yeu cau schema.
SELECT 'KeHoach123' AS Bang, COUNT(*) AS SoLuong
FROM KeHoach WHERE MaKeHoach='123';
SELECT 'CuonNhapGoc_1' AS DoiTuong, id, SoDau, SoCuoi, TrangThai
FROM TonCuonLe WHERE id=1;
SELECT 'NguonNhapGoc' AS DoiTuong, id, SoCuon, ChieuDai_1cuon
FROM TTCuonDay WHERE id IN (1,2) ORDER BY id;
