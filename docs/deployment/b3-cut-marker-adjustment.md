# Thêm cột lưu điều chỉnh thông số cuộn — thực hiện thủ công

## Database cần sửa

Cấu hình hiện tại trong `.env`: `D:/Database/QLSX_v02.db`.

Mở đúng file này bằng công cụ quản lý SQLite, chẳng hạn DB Browser for SQLite. Nếu `.env` đổi đường dẫn, dùng đường dẫn mới. Không sửa `database/database.sqlite` trong dự án khi ứng dụng đang trỏ sang file bên ngoài.

Code ứng dụng không tạo cột tự động và không có migration cho thay đổi này. Phải thêm cột trước khi sử dụng chức năng lưu cắt với code mới, kể cả cắt từ cuộn chẵn.

## Các bước

1. Tạm dừng các thao tác ghi/cắt của ứng dụng. Tạo bản sao lưu database bằng công cụ SQLite.
2. Mở cửa sổ chạy SQL và kiểm tra:

```sql
PRAGMA table_info('LichSuCat');
```

3. Nếu danh sách **chưa có** cột `DieuChinhThongSo`, chạy **một lần**:

```sql
ALTER TABLE "LichSuCat"
ADD COLUMN "DieuChinhThongSo" TEXT DEFAULT NULL;
```

Nếu cột đã tồn tại, không chạy lại. SQLite sẽ báo trùng tên cột nếu chạy lần hai.

4. Chọn lưu thay đổi/Write Changes hoặc COMMIT nếu công cụ đang dùng giao dịch chưa lưu.
5. Kiểm tra lại bằng câu PRAGMA ở bước 2. Kết quả cần có `name = DieuChinhThongSo`, `type = TEXT`, `notnull = 0`.

Không cần cập nhật dữ liệu cũ. Dự án chưa có dữ liệu phát sinh từ code nên không có bước chuyển đổi lịch sử.

## Dữ liệu sau khi lưu cắt

`DieuChinhThongSo` là `NULL` nếu không điều chỉnh, không gửi thông số mới, hoặc xác lập thông số cuộn chẵn lần đầu.

Ví dụ tồn trước lần cắt là 200 → 800, chiều thuận, còn 600 m. Người dùng sửa số cuối thành 900 rồi cắt 100 m:

- Tồn mới trong `TonCuonLe`: 300 → 800, còn 500 m.
- Các mốc lịch sử trước cắt: 300 → 900; sau cắt: 300 → 800.
- Cột bổ sung giữ mốc database trước sửa và mốc xác nhận trước cắt:

```json
{
  "phien_ban": 1,
  "truoc_dieu_chinh": {"so_dau": 200, "so_cuoi": 800, "chieu": 1},
  "sau_dieu_chinh": {"so_dau": 300, "so_cuoi": 900, "chieu": 1},
  "truong_nguoi_dung_thay_doi": ["so_cuoi"],
  "so_dau_tinh_lai": true
}
```

`sau_dieu_chinh` là thông số đã xác nhận **trước khi cắt**, không phải tồn sau cắt. `so_dau_tinh_lai` cho biết giá trị số đầu có thay đổi do tính lại. Người thực hiện/thời gian dùng `NguoiThucHien`, `ThoiGianThucHien` của cùng bản ghi lịch sử.

## Tra cứu sau khi thử lưu trên ứng dụng

```sql
SELECT id, TonCuonLe_ID, NguoiThucHien, ThoiGianThucHien,
       SoDauTruoc, SoCuoiTruoc, SoDauSau, SoCuoiSau,
       DieuChinhThongSo
FROM LichSuCat
WHERE DieuChinhThongSo IS NOT NULL
ORDER BY id DESC;
```

Xác nhận thông số rồi đóng trang mà chưa lưu lần cắt không tạo dấu vết. Thông tin điều chỉnh chỉ được lưu cùng lần cắt thành công; giao diện chưa có chức năng hiển thị dấu vết này.
