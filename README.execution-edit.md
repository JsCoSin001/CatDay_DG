# Nguồn B3 và thay đổi tương thích B2

Nguồn ban đầu được nhập từ `CatDay_DG-main.zip` do người dùng cung cấp. SHA-256 của ZIP:

`07F6BF6E943AF0C1262A7528B3F85F6310571C356BB84558921A5E9F51775E9C`

ZIP gốc giữ nguyên. Không nhập `.git`, `.env` của môi trường chạy, thư viện `vendor`, `node_modules`, DB, nhật ký và bộ nhớ đệm. `composer.lock` được giữ để tái tạo phụ thuộc.

Thay đổi bổ sung: nhật ký `B3ThaoTac` bất biến cho cắt/lấy nguyên; mã HUY bị từ chối khi gửi lại hoặc phục hồi; người gửi gốc tách khỏi người thực hiện đã sửa; phiên bản SQLite tăng đơn điệu để phát hiện dữ liệu đổi rồi trở về cùng giá trị.

Schema dùng chung nằm tại `../../database/Migration_B2B3_ExecutionEdit_20261026.sql`; đưa file này cùng gói triển khai, áp dụng thủ công trước khi chạy B3 mới. Hướng dẫn đầy đủ: `../../docs/deployment/b2-b3-execution-edit.md`.

Các bài kiểm thử B3 trong kho tích hợp tham chiếu fixture/schema dùng chung ở thư mục gốc dự án. Để chạy kiểm thử, giữ cấu trúc kho này và chạy `php artisan test` từ `integrations/B3`. Khi triển khai chỉ phân phối nguồn chạy B3 và các phụ thuộc theo `composer.lock`; không đưa bridge, DB mẫu hoặc cấu hình kiểm thử vào máy chủ.
