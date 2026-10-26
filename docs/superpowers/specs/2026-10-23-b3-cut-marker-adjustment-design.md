# Lưu dấu vết điều chỉnh thông số cuộn tại lần cắt

Ngày: 2026-10-23

Trạng thái: Người dùng đã duyệt thiết kế. Chưa triển khai. Người dùng tự thay đổi schema thủ công; không tạo migration hoặc code tự cập nhật schema ứng dụng.

## Mục tiêu và phạm vi đã chốt

Biết được tại một lần cắt cuộn lẻ, người thực hiện đã thay đổi số cuối hoặc chiều so với dữ liệu tồn trước lần cắt. Lưu đủ giá trị cũ/mới và phân biệt số đầu tự tính lại với trường người dùng sửa.

- Chỉ ghi nhận cùng lần cắt lưu thành công; xác nhận trên giao diện chưa ghi database.
- So sánh giá trị cuối cùng dùng cắt với dữ liệu tồn trong giao dịch lưu. Nhập rồi đổi về giá trị cũ không tính là điều chỉnh.
- Chỉ đánh dấu điều chỉnh đối với cuộn lẻ đã có thông số. Cuộn chẵn cắt lần đầu là xác lập thông số, đã được phản ánh trong các cột lịch sử hiện có.
- Chỉ lưu database, chưa bổ sung giao diện, lý do hoặc màn hình tra cứu.
- Người thực hiện và thời gian dùng chung NguoiThucHien, ThoiGianThucHien của lần cắt.
- Dự án đang phát triển, chưa có dữ liệu phát sinh từ code: không chuyển đổi, suy luận hoặc bổ sung dấu vết cho dữ liệu cũ; không xây dựng bộ đọc định dạng dấu vết cũ.

## Căn cứ hiện tại

Schema database được cấu hình trong .env đã được kiểm tra chỉ đọc:

- LichSuCat có các mốc trước cắt, đoạn cắt, sau cắt, HeSoChieu, NguoiThucHien, ThoiGianThucHien và GhiChu TEXT.
- TonCuonLe giữ SoDau, SoCuoi hiện tại. Chiều cuộn đang còn dây suy ra từ thứ tự hai mốc.
- GhiChu của LichSuCat đang chứa __B3_OP__:<mã giao dịch>. ExecutionRepository sử dụng để chống lưu trùng và tìm lại giao dịch khi khôi phục.
- ExecutionService::cut đọc cuộn lẻ, tính các mốc, thêm lịch sử và cập nhật tồn trong B3Transaction.
- Các mốc SoDauTruoc/SoCuoiTruoc hiện thể hiện thông số đã xác nhận dùng cắt, không phải thông số database trước khi điều chỉnh.
- Giao diện đã gửi end_value/direction ở lần lưu đầu của phiên; các lần tiếp theo dùng tồn đã lưu. Không cần thêm dữ liệu đầu vào để phát hiện chênh lệch.

## Các phương án đã cân nhắc

| Phương án | Đánh đổi | Kết luận |
|---|---|---|
| Dùng GhiChu | Không thêm cột nhưng phải thay cách đọc mã giao dịch và xử lý khôi phục | Không chọn |
| Thêm một cột TEXT vào LichSuCat | Thêm một cột, gắn trực tiếp dấu vết vào lần cắt, giữ nguyên chức năng GhiChu | Đã chọn |
| Tạo bảng điều chỉnh riêng | Phù hợp khi điều chỉnh là sự kiện độc lập, nhưng thêm bảng và liên kết | Không chọn |

## Thiết kế dữ liệu đề xuất

Thêm LichSuCat.DieuChinhThongSo TEXT NULL. Nội dung là JSON (văn bản lưu dữ liệu có cấu trúc). Đây là tên cột và định dạng do người thiết kế đề xuất, chưa phải tên đã được người dùng chọn riêng.

- NULL khi không điều chỉnh, khi không gửi thông số mới, hoặc khi cắt cuộn chẵn lần đầu.
- Khi điều chỉnh, lưu đủ mốc cũ từ TonCuonLe và mốc mới trước cắt từ kết quả tính toán server.
- Không dùng cột này thay thế các mốc lịch sử hiện có.

Ví dụ nội dung khi chỉ sửa số cuối 800 thành 900, tồn 600 m:

```json
{
  "phien_ban": 1,
  "truoc_dieu_chinh": {"so_dau": 200, "so_cuoi": 800, "chieu": 1},
  "sau_dieu_chinh": {"so_dau": 300, "so_cuoi": 900, "chieu": 1},
  "truong_nguoi_dung_thay_doi": ["so_cuoi"],
  "so_dau_tinh_lai": true
}
```

truong_nguoi_dung_thay_doi chỉ gồm so_cuoi và/hoặc chieu. so_dau_tinh_lai cho biết giá trị số đầu thực sự thay đổi do tính lại; không coi số đầu là trường người dùng trực tiếp chỉnh.

## Luồng xử lý dự kiến

1. Giữ nguyên bước xác nhận và kiểm tra hợp lệ hiện tại.
2. Trong giao dịch lưu, giữ nguyên kiểm tra quyền, mã giao dịch, phiên bản tồn, kế hoạch và chiều dài.
3. Với cuộn lẻ: lấy mốc cũ từ bản ghi TonCuonLe được đọc trong giao dịch, trước khi cập nhật. Không lấy mốc cũ từ giao diện hoặc suy ngược từ lịch sử trước đó.
4. Giữ nguyên cách tính mốc cắt. Nếu có end_value/direction, so sánh với số cuối và chiều suy ra từ tồn cũ. Nếu thiếu cả hai thì không điều chỉnh.
5. Khi có chênh lệch cuối cùng: tạo nội dung điều chỉnh, đưa vào chính bản ghi LichSuCat mới. SoDauTruoc/SoCuoiTruoc vẫn là mốc đã điều chỉnh dùng cắt.
6. Cập nhật TonCuonLe bằng các mốc sau cắt như hiện tại. Không sửa TTCuonDay hoặc lịch sử trước đó.
7. Cùng thành công hoặc cùng hoàn tác với toàn bộ lần cắt. Lỗi, lưu trùng, hoặc từ chối dữ liệu đã thay đổi không tạo dấu vết riêng.
8. Phản hồi và đồng bộ phiên cắt tiếp tục dùng luồng hiện có.

## Ví dụ nghiệm thu

Đầu vào trước lần 1: 200 → 1.000, chiều thuận, tồn 800 m. Mỗi lần cắt 100 m. Hai lần đầu lần lượt còn 200 → 900 và 200 → 800; dấu vết điều chỉnh là NULL.

Ba tình huống lần 3 độc lập, đều bắt đầu từ 200 → 800, tồn 600 m:

| Tình huống | Mốc cũ | Mốc dùng cắt sau xác nhận | Tồn sau lưu | Trường người dùng thay đổi |
|---|---|---|---|---|
| Chỉ sửa số cuối thành 900 | 200 → 800, thuận | 300 → 900, thuận | 300 → 800, 500 m | so_cuoi |
| Chỉ đổi sang nghịch | 200 → 800, thuận | 1.400 → 800, nghịch | 1.400 → 900, 500 m | chieu |
| Đổi số cuối thành 900 và sang nghịch | 200 → 800, thuận | 1.500 → 900, nghịch | 1.500 → 1.000, 500 m | so_cuoi, chieu |

Kiểm chứng thêm khi triển khai:

- Xác nhận rồi đóng trang không có ghi dữ liệu.
- Nhập rồi trả về giá trị cũ, hoặc xác nhận nguyên giá trị: dấu vết NULL.
- Cuộn chẵn lần đầu: dấu vết NULL, lịch sử cắt vẫn đầy đủ.
- Lần cắt tiếp theo không chỉnh dùng tồn mới và không đánh dấu lại điều chỉnh cũ.
- Lưu hết dây vẫn lưu dấu vết hợp lệ và cập nhật trạng thái HET.
- Lỗi giao dịch, lưu trùng và dữ liệu thay đổi không tạo thêm lịch sử hoặc dấu vết.
- Không tăng chiều dài tồn bằng thao tác chỉnh mốc.

## Phạm vi thay đổi dự kiến khi được phép triển khai

- Người dùng tự thêm cột NULL theo hướng dẫn SQL; không tạo migration, không thêm code tự sửa schema ứng dụng, không tự chạy SQL trên database sử dụng thực tế.
- ExecutionService: tạo dấu vết từ tồn cũ và thông số dùng cắt, thêm vào dữ liệu lịch sử.
- Schema kiểm thử và kiểm thử nghiệp vụ điều chỉnh/cuộn chẵn/cắt tiếp/lỗi giao dịch.
- Giữ nguyên API đầu vào, giao diện và cách dùng GhiChu.
- Không dọn dữ liệu phát triển, không chuyển đổi dữ liệu cũ, không sửa các thay đổi đang có của người dùng.

Đây là thay đổi nhỏ. Thiết kế đã được duyệt; bước tiếp theo là kế hoạch triển khai. Schema dành riêng cho kiểm thử vẫn cần khai báo cột mới để kiểm thử độc lập; việc đó không thay đổi database sử dụng thực tế.
