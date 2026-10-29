# B3 – Sửa menu tài khoản và đổi mật khẩu (29/10/2026)

## Phạm vi

- Mobile: nút `⋮` bên phải header mở menu `Đổi mật khẩu` / `Đăng xuất`, đóng khi nhấn ra ngoài hoặc `Escape`, cập nhật `aria-expanded`.
- Desktop: thêm `Đổi mật khẩu` cạnh `Đăng xuất`.
- Đăng xuất: dùng API cũ `POST /logout`, chỉ trở về màn hình đăng nhập khi yêu cầu thành công (hoặc khi máy chủ thông báo phiên đã hết); mất mạng thì giữ trạng thái giao diện để người dùng thử lại.
- Đổi mật khẩu: hộp thoại có 3 ô (mật khẩu cũ, mới, xác nhận), kiểm tra dữ liệu ở cả client và server, hiển thị lỗi ngay trong hộp thoại, xoá nội dung nhạy cảm khi đóng.
- Không sửa nghiệp vụ cắt/lấy dây, không đổi schema database.

## API mới

`POST /api/account/password` (phải đăng nhập, tài khoản còn hoạt động, bảo vệ CSRF, giới hạn 5 yêu cầu/phút).

Dữ liệu JSON:

```json
{
  "current_password": "<mat-khau-hien-tai>",
  "new_password": "<mat-khau-moi>",
  "new_password_confirmation": "<nhap-lai-mat-khau-moi>"
}
```

Mật khẩu mới phải khác mật khẩu cũ, dài 8–72 ký tự và tối đa 72 byte (ngăn sự cố bcrypt cắt ngầm mật khẩu UTF-8 dài). Dùng `Hash::make()` để lưu vào cột `users.password_hash`; không lưu mật khẩu dạng rõ và không trả mật khẩu qua API. Sau khi đổi thành công, phiên hiện tại vẫn đăng nhập; mã phiên và CSRF được thay mới rồi đồng bộ sang JavaScript.

**Giới hạn phạm vi:** Đổi mật khẩu không tự động đăng xuất các *phiên đang hoạt động trên thiết bị khác*. Nếu nghiệp vụ yêu cầu thu hồi toàn bộ phiên, cần một thiết kế bổ sung phù hợp với `SESSION_DRIVER` đang dùng tại triển khai thực tế.

## Các file sửa

- `resources/views/welcome.blade.php` – menu và hộp thoại.
- `resources/views/layouts/cat-day.blade.php` – cache-busting cho `b3-api.js` sau phát hành.
- `public/css/cat-day/cat-day-ui.css` – giao diện menu/hộp thoại responsive.
- `public/js/cat-day/cat-day-ui.js` – sự kiện menu, đổi mật khẩu, đăng xuất.
- `public/js/cat-day/b3-api.js` – API và đồng bộ CSRF.
- `app/Http/Controllers/AuthController.php` – xử lý an toàn phía server.
- `routes/web.php` – khai báo API bảo vệ bằng middleware.
- `tests/JavaScript/B3AccountMenuTest.cjs`, `tests/JavaScript/B3ApiSessionTest.cjs` – kiểm thử JavaScript.
- `tests/Feature/B3/AccountPasswordTest.php` – kiểm thử Laravel cần chạy khi có `vendor`.

## Kiểm thử khi triển khai

1. Sau khi `composer install` trên bản có Laravel, chạy `php artisan test --filter=AccountPasswordTest`.
2. Chạy `node --test tests/JavaScript/B3AccountMenuTest.cjs tests/JavaScript/B3ApiSessionTest.cjs`.
3. Mobile: đăng nhập, nhấn ba chấm → thấy hai lệnh, mở/đóng bằng tap ngoài và `Escape`.
4. Nhấn `Đổi mật khẩu`: thử bỏ trống, gõ sai mật khẩu hiện tại, gõ 7 ký tự, nhập xác nhận khác; phải không được cập nhật mật khẩu.
5. Đổi hợp lệ → được báo thành công, vẫn đăng nhập, thao tác tra cứu/QR tiếp tục dùng CSRF mới.
6. Đăng xuất → quay về form; thử đăng nhập lại với mật khẩu cũ (thất bại) và mới (thành công).
7. Khi API đăng xuất mất kết nối, màn hình vẫn giữ đăng nhập để người dùng thử lại.

**Chưa triển khai lên server**; chỉ là bản ZIP sửa từ mã nguồn được cung cấp.
