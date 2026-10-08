# Vendor runtime files

Thư mục này phải chứa hai file runtime local trước khi triển khai:

- `html5-qrcode.min.js` — html5-qrcode 2.3.8
- `jsQR.js` — jsQR 1.4.0 (chỉ cần nếu dùng đọc QR từ ảnh)

Chạy một trong các script tại `tools/install-vendor-dependencies.*` để tải đúng phiên bản vào đây.
Ứng dụng Laravel sau khi cài đặt sẽ nạp các file local này; không nạp CDN trong runtime.
