# Cut Marker Adjustment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lưu dấu vết thay đổi số cuối/chiều vào chính lần cắt cuộn lẻ thành công.

**Architecture:** Người dùng tự thêm một cột TEXT nullable vào LichSuCat. ExecutionService so sánh tồn cũ với thông số dùng cắt bên trong giao dịch hiện có và ghi JSON khi có thay đổi. Không thêm API, giao diện hoặc thay cách dùng GhiChu.

**Tech Stack:** PHP, Laravel, SQLite, PHPUnit.

**Spec:** docs/superpowers/specs/2026-10-23-b3-cut-marker-adjustment-design.md

## Global Constraints

- Chỉ ghi nhận cùng lần cắt lưu thành công; xác nhận trên giao diện chưa ghi database.
- Chỉ đánh dấu điều chỉnh đối với cuộn lẻ đã có thông số.
- Chỉ lưu database, chưa bổ sung giao diện, lý do hoặc màn hình tra cứu.
- Người thực hiện và thời gian dùng chung NguoiThucHien, ThoiGianThucHien của lần cắt.
- Không tạo migration, không thêm code tự cập nhật schema ứng dụng. Người dùng tự thay đổi database thực tế.
- Không chuyển đổi dữ liệu cũ hoặc tạo bộ đọc dấu vết cũ: dự án chưa có dữ liệu phát sinh từ code.
- Không sửa các thay đổi đang có của người dùng trong workspace.

## Review Focus

- Chỉ đổi chiều phải ghi đúng chiều cũ và chiều mới, không hiểu nhầm số đầu tự tính là người dùng nhập.
- Thông số cuối cùng trùng tồn cũ không tạo dấu vết.
- Cắt hết dây vẫn lưu dấu vết và chuyển tồn sang HET.
- Giao dịch bị lỗi sau khi thêm lịch sử phải hoàn tác cả lịch sử lẫn tồn.
- Lưu trùng hoặc cắt tiếp không được nhân bản dấu vết của lần trước.

## Bước chuẩn bị: schema do người dùng sửa thủ công

Database hiện được cấu hình: D:/Database/QLSX_v02.db. Kiểm tra lại đường dẫn trong .env nếu cấu hình thay đổi.

1. Đóng các thao tác cắt/ghi trên ứng dụng và tạo bản sao database qua công cụ quản lý SQLite.
2. Kiểm tra cột:

```sql
PRAGMA table_info('LichSuCat');
```

3. Chỉ khi chưa có DieuChinhThongSo, chạy một lần:

```sql
ALTER TABLE "LichSuCat"
ADD COLUMN "DieuChinhThongSo" TEXT DEFAULT NULL;
```

4. Chạy lại PRAGMA và xác nhận cột TEXT, cho phép NULL. Áp dụng/commit thay đổi nếu công cụ đang mở giao dịch. Không cần cập nhật bản ghi cũ.

## Task 1: Ghi nhận điều chỉnh trong giao dịch cắt

**Files:**
- Modify: app/Services/B3/ExecutionService.php
- Modify: tests/Support/CreatesFactoryFlowSchema.php (schema database kiểm thử, không phải schema ứng dụng)
- Test: tests/Feature/B3/PartialCutMarkersTest.php

**Interfaces:**
- Consumes: cut(..., ?int $endValue, ?int $direction, ...) hiện có; $p là tồn cũ đọc trong giao dịch; $c là kết quả CutCalculator.
- Produces: private markerAdjustment(array $partial, array $calculation, ?int $endValue, ?int $direction): ?string; trả NULL khi không đổi, hoặc JSON UTF-8 theo thiết kế.
- cutHistory(..., string $token, ?string $markerAdjustment = null): array; bổ sung khóa DieuChinhThongSo. Nhánh cuộn chẵn dùng NULL mặc định.

- [ ] Thêm cột nullable text DieuChinhThongSo vào schema kiểm thử.
- [ ] Viết kiểm thử dữ liệu cho ba tình huống: tồn 200→800, cắt 100; (900,+1) cho mốc 300→800 và trường so_cuoi; (800,-1) cho 1400→900 và trường chieu; (900,-1) cho 1500→1000 và cả hai trường. Giải mã JSON, xác nhận phien_ban=1, truoc_dieu_chinh=(200,800,1), sau_dieu_chinh đúng mốc trước cắt, so_dau_tinh_lai=true, tồn còn 500.
- [ ] Thêm kiểm thử gửi (800,+1) cho dấu vết NULL; kiểm thử không gửi hai thông số cũng NULL; cuộn chẵn cắt lần đầu NULL. Không cần mô phỏng mọi thao tác gõ: server chỉ nhận giá trị cuối cùng.
- [ ] Chạy php artisan test --filter=PartialCutMarkersTest, xác nhận kiểm thử mới thất bại do thiếu dữ liệu dấu vết.
- [ ] Bổ sung helper và tham số cutHistory như giao diện trên. So sánh endValue/direction với SoCuoi và chiều suy ra từ SoDau/SoCuoi cũ. Dùng $c để tạo mốc mới trước cắt. Tạo danh sách trường theo thứ tự so_cuoi, chieu; so_dau_tinh_lai là so sánh số đầu cũ/mới. Mã hóa JSON với JSON_THROW_ON_ERROR. Chỉ truyền dấu vết ở nhánh cuộn lẻ, trong cùng giao dịch hiện có.
- [ ] Chạy lại nhóm kiểm thử, xác nhận PASS; kiểm tra lịch sử trước đó và GhiChu không bị sửa.

## Task 2: Kiểm chứng lưu tiếp, lưu lỗi và chống trùng

**Files:**
- Test: tests/Feature/B3/PartialCutMarkersTest.php
- Test: tests/Feature/B3/ContinuousCutSessionTest.php

**Interfaces:**
- Consumes: DieuChinhThongSo JSON/NULL và API cắt hiện có từ Task 1.
- Produces: bằng chứng giao dịch và phiên cắt tiếp vẫn nhất quán; không thêm giao diện hoặc API.

- [ ] Thêm tình huống lần sau không gửi thông số mới: tiếp tục từ tồn đã điều chỉnh; dấu vết mới NULL, dấu vết lần trước giữ nguyên.
- [ ] Kiểm chứng lưu lại cùng mã giao dịch bị từ chối, chỉ có một bản ghi mang dấu vết; kiểm chứng source_version cũ bị từ chối, không có lịch sử mới.
- [ ] Thêm trường hợp điều chỉnh rồi cắt hết 600 m: tồn 300→300, HET; dấu vết trước cắt vẫn là 300→900, không nhầm mốc sau cắt.
- [ ] Mô phỏng updatePartial ném lỗi sau insertCut bằng mock repository chỉ trong kiểm thử; xác nhận tồn giữ nguyên và không có lịch sử/dấu vết được commit.
- [ ] Chạy php artisan test --filter='PartialCutMarkersTest|ContinuousCutSessionTest|ConcurrencyAndIdempotencyTest', xác nhận PASS. Nếu môi trường PHP lỗi extension_dir, dùng php -d extension_dir=D:/php-8.4.25-Win32-vs17-x64/ext artisan test với cùng bộ lọc.
- [ ] Rà diff: chỉ code ghi lịch sử và kiểm thử thay đổi; không migration hoặc code tự sửa database. Không cần thêm điều khiển sửa thông số trong phiên hiện tại: người dùng quét lại theo luồng đang có.
- [ ] Chỉ commit các thay đổi của nhiệm vụ sau khi kiểm thử đạt và môi trường cho phép; không gộp thay đổi có sẵn của người dùng.

## Tự rà soát kế hoạch

Yêu cầu đã phủ: ba loại điều chỉnh, giá trị không đổi, cuộn chẵn lần đầu, cắt tiếp, cắt hết, lưu trùng, dữ liệu tồn thay đổi và hoàn tác giao dịch. Schema thực tế do người dùng sửa thủ công; schema kiểm thử là nội bộ để chạy kiểm thử độc lập. Không có bước xử lý dữ liệu cũ hoặc sửa giao diện.

## Kết quả triển khai — 2026-10-23

- Task 1 và Task 2: đã triển khai và kiểm chứng. Kiểm thử riêng của chức năng đặt tại `tests/Feature/B3/CutMarkerAdjustmentTest.php` thay vì sửa hai file kiểm thử đang có chỉnh sửa của người dùng.
- Đã quan sát kiểm thử mới thất bại trước triển khai: 8 trường hợp thiếu dấu vết; sau triển khai 13 trường hợp mới đạt.
- Bộ kiểm thử liên quan: 51 kiểm thử, 825 khẳng định, tất cả đạt.
- Toàn bộ PHP: 195 kiểm thử, 1.490 khẳng định, 2 lỗi thực thi và 24 kiểm thử thất bại. Đã chạy đối chiếu bằng bản ExecutionService trước thay đổi, không ghi đè nguồn: 182 kiểm thử cũ có đúng cùng 26 tên kiểm thử lỗi; không phát sinh lỗi mới.
- Rà soát độc lập: không có phát hiện cần sửa. Kiểm tra cú pháp ba file PHP và kiểm tra khoảng trắng diff đạt.
- Do PHP trong sandbox báo is_readable=false ngay cả với file đọc được, kiểm thử chạy ngoài sandbox qua cơ chế phê duyệt. Database kiểm thử là SQLite trong bộ nhớ; không thay đổi database thực tế.
- Chỉnh sửa thực hiện ngay trong workspace hiện tại, chưa commit. Không tạo nhánh/worktree và không ghi đè các chỉnh sửa có sẵn. Nhật ký và bản nguồn trước thay đổi giữ tại `storage/logs/cut-marker-review/*.log` để đối chiếu, chưa xóa vì chưa commit.
- Không tạo migration hoặc code tự sửa schema ứng dụng. Người dùng cần thực hiện hướng dẫn `docs/deployment/b3-cut-marker-adjustment.md` trước khi lưu cắt bằng code mới.
