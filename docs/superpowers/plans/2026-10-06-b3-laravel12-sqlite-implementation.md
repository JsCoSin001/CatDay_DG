# FactoryFlow B3 Laravel 12 + SQLite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current B3 Laravel UI prototype/mock behavior with real authenticated FactoryFlow B3 execution against the existing SQLite schema, preserving the approved UI behavior and B1/B2 invariants.

**Architecture:** Keep the existing browser UI/scanner as interaction-only code. Route all business decisions through Laravel services (`QrResolver`, `PlanWorklistService`, `ScanContextService`, `ExecutionService`, `ProgressService`, `CutCalculator`) backed by focused query repositories and authoritative SQLite transactions. Use the existing FactoryFlow SQLite database and derive progress/reservation/current state from execution history; do not add business migrations unless a verified schema blocker appears.

**Tech Stack:** PHP 8.2+, Laravel 12, SQLite/PDO, Blade, plain JavaScript, existing local QR scanner package, PHPUnit 11.

**Spec:** `docs/superpowers/specs/2026-10-06-b3-laravel12-sqlite-design.md`

## Global Constraints

- Laravel 12 / PHP `^8.2`.
- Use the existing FactoryFlow SQLite DB (`DB_DATABASE` environment-configurable; development target `D:\\Database\\QLSX_v02.db`).
- `SESSION_DRIVER=file`, `CACHE_STORE=file`, `QUEUE_CONNECTION=sync`; do not create framework tables in the FactoryFlow DB.
- `users.username` from authenticated server session is the only authoritative `NguoiThucHien`.
- `KeHoach.TrangThai` remains lifecycle-only (`ACTIVE/HUY`); B3 must not mutate it to represent completion.
- One work item is one `KeHoachHang`; worklist rows are `FULL_TAKE`, `FULL_CUT`, `PARTIAL_CUT`, `COMPLETED_SUMMARY`.
- Whole-reel take is quantity-only: one scan/save = one reel; accounting source is FIFO across eligible full stock for the product.
- Full→partial cut uses the scanned MaBin to restrict source and stores the entire raw structured QR as `TonCuonLe.MaCuon`.
- Structured `cuontp;[MaBin];...`: exact `TonCuonLe.MaCuon` lookup first; if absent, parse token 2 as full-reel MaBin.
- Plain `[MaBin]` is valid only as exact partial-reel `TonCuonLe.MaCuon`; if it resolves only to full stock, reject.
- Group selection: 0 eligible → reject; 1 → auto-select; >1 → UI shows `Nhóm cần thực hiện` before the existing detail selector.
- `LichSuCat` and `LichSuLayCuon` are immutable in normal B3 flow.
- All writes re-read plan/inventory/history inside one short authoritative transaction and rollback completely on failure.
- Preserve existing B3 presentation including first-cut labels; do not rename the current preview labels.
- Production scanner camera-only (`allowImage=false`).
- Support HTTPS both on trusted LAN hostname and through Cloudflare Tunnel; business/auth behavior is identical on both paths.
- Remove mock login, mock plan rows, mock QR scenarios, random/mock save, and demo-only controls before real testing.
- Current source package has no `.git`; commit steps below are checkpoints for the real repository and are skipped when executing directly against this ZIP.

## Review Focus

1. **Plain MaBin that belongs to full stock** must be rejected and never silently reinterpreted as a full reel; pin in QR resolver tests in Task 3.
2. **B2 reservation fully consumes available stock** must still allow B3 to execute the current plan’s reserved work; pin in repository/service tests in Tasks 5–7.
3. **Network retry/double-submit after a successful commit** must not record a second whole reel or cut; pin operation-token tests in Tasks 6–7.
4. **Multiple unfinished groups on one source** must expose group selection rather than auto-picking an arbitrary group; pin scan-context/API tests in Task 5.
5. **State changed after scan resolve** (detail already done, group bound elsewhere, remaining length changed, stock changed) must fail atomically with `STALE_DATA`/specific conflict and no partial write; pin service transaction tests in Tasks 6–7.

---

## File Structure

### Create

- `app/Http/Controllers/AuthController.php` — real session login/logout.
- `app/Http/Controllers/B3/B3PageController.php` — serves B3 page.
- `app/Http/Controllers/B3/PlanController.php` — plan suggestions/worklists.
- `app/Http/Controllers/B3/ScanController.php` — QR resolve endpoint.
- `app/Http/Controllers/B3/ExecutionController.php` — whole-take/cut endpoints.
- `app/Http/Requests/B3/ResolveScanRequest.php` — scan input validation.
- `app/Http/Requests/B3/TakeWholeReelRequest.php` — take input validation.
- `app/Http/Requests/B3/CutReelRequest.php` — cut input validation.
- `app/Services/B3/QrResolver.php` — QR syntax + source resolution.
- `app/Services/B3/ProgressService.php` — product/plan progress derivation.
- `app/Services/B3/PlanWorklistService.php` — row projection.
- `app/Services/B3/ScanContextService.php` — plan/action/group/detail resolution.
- `app/Services/B3/CutCalculator.php` — pure cut coordinate math.
- `app/Services/B3/ExecutionService.php` — transaction orchestration.
- `app/Repositories/B3/PlanRepository.php` — plan/item/group/detail queries.
- `app/Repositories/B3/InventoryRepository.php` — actual stock, partial state, FIFO source queries.
- `app/Repositories/B3/ExecutionRepository.php` — history, `TonCuonLe`, binding writes.
- `app/Support/B3/B3Exception.php` — stable business `error_code` + HTTP status.
- `app/Support/B3/B3Transaction.php` — bounded SQLite immediate transaction/retry helper.
- `public/js/cat-day/b3-api.js` — fetch wrapper and stable API errors.
- `public/js/cat-day/b3-state.js` — client state model only.
- `tests/Support/CreatesFactoryFlowSchema.php` — minimal schema fixture matching production columns/constraints used by B3.
- `tests/Unit/B3/QrResolverTest.php`
- `tests/Unit/B3/CutCalculatorTest.php`
- `tests/Unit/B3/ProgressServiceTest.php`
- `tests/Unit/B3/PlanWorklistServiceTest.php`
- `tests/Feature/B3/AuthTest.php`
- `tests/Feature/B3/PlanApiTest.php`
- `tests/Feature/B3/ScanResolveApiTest.php`
- `tests/Feature/B3/TakeWholeReelTest.php`
- `tests/Feature/B3/CutReelTest.php`
- `tests/Feature/B3/ConcurrencyAndIdempotencyTest.php`
- `docs/deployment/b3-lan-cloudflare.md` — LAN HTTPS + Cloudflare Tunnel deployment notes.

### Modify

- `app/Models/User.php` — map legacy `users` schema/password field.
- `routes/web.php` — page/auth/API routes with auth middleware.
- `bootstrap/app.php` — trusted proxy handling for Cloudflare/LAN reverse proxy.
- `config/database.php` — env-driven SQLite busy timeout/transaction mode/journal mode.
- `.env.example` — FactoryFlow DB path + file session/cache + SQLite options + HTTPS/proxy notes.
- `phpunit.xml` — retain isolated test SQLite/session/cache settings; add any B3-specific env flags only if needed.
- `resources/views/welcome.blade.php` — status header column, remove mock selector, preserve existing interaction containers.
- `resources/views/layouts/cat-day.blade.php` — load real B3 API/state scripts; localize runtime dependencies if bundled; preserve QR load order.
- `public/js/cat-day/cat-day-ui.js` — remove mocks; bind real login/plans/scan/execute; add conditional group selector; preserve existing preview labels/render behavior.
- `public/css/cat-day/cat-day-ui.css` — only minimal styling needed for status/group selector/error states.
- `public/js/qr-scanner/qr-camera-modal.js` or B3 modal creation call site — force `allowImage=false` for B3 without removing reusable decoder capability.

---

### Task 1: Test Harness + Runtime SQLite Configuration

**Files:**
- Create: `tests/Support/CreatesFactoryFlowSchema.php`
- Create: `tests/Feature/B3/DatabaseRuntimeTest.php`
- Modify: `config/database.php`
- Modify: `.env.example`
- Modify: `phpunit.xml` only if required for deterministic B3 tests

**Interfaces:**
- Produces: `Tests\Support\CreatesFactoryFlowSchema::createFactoryFlowSchema(): void` used by all B3 feature/integration tests.
- Produces: SQLite config keys driven by env: `DB_BUSY_TIMEOUT`, `DB_TRANSACTION_MODE`, optional `DB_JOURNAL_MODE`.

- [ ] **Step 1: Write failing runtime/schema tests**
  - Assert B3 tests can create the exact minimal tables/constraints used by B3 (`users`, B2 tables, inventory tables).
  - Assert SQLite connection has foreign keys enabled.
  - Assert test runtime uses isolated in-memory SQLite and does not require framework `sessions/cache/jobs` tables.

- [ ] **Step 2: Run tests to verify failure**

  Run: `php artisan test tests/Feature/B3/DatabaseRuntimeTest.php`

  Expected: FAIL because fixture/config helpers do not exist.

- [ ] **Step 3: Implement schema fixture and env-driven SQLite config**
  - `CreatesFactoryFlowSchema` must mirror the supplied production column names/constraints used by tests, including `KeHoach.TrangThai ACTIVE/HUY`, unique `TonCuonLe.MaCuon`, unique `LichSuCat.KeHoachCatChiTiet_ID`.
  - `config/database.php` must read timeout/transaction-mode env without changing non-SQLite connections.
  - `.env.example` sets file session/cache, sync queue, and documents `DB_DATABASE` path.

- [ ] **Step 4: Run tests**

  Run: `php artisan test tests/Feature/B3/DatabaseRuntimeTest.php`

  Expected: PASS.

- [ ] **Step 5: Commit checkpoint (real repo only)**

  `git commit -am "test(b3): establish FactoryFlow sqlite test harness"`

---

### Task 2: Real Authentication Against Legacy `users`

**Files:**
- Modify: `app/Models/User.php`
- Create: `app/Http/Controllers/AuthController.php`
- Modify: `routes/web.php`
- Create: `tests/Feature/B3/AuthTest.php`

**Interfaces:**
- Produces: `POST /login` with `username`, `password`; `POST /logout`.
- Produces: authenticated `App\Models\User` where `getAuthPassword()` returns `password_hash` and primary key is `user_id`.
- Consumers later use: `auth()->user()->username` as authoritative execution actor.

- [ ] **Step 1: Write failing auth tests**
  - Active user + correct bcrypt password logs in and session regenerates.
  - Wrong password returns validation/auth error and no session.
  - `is_active=0` user cannot login.
  - Logout invalidates session.
  - No remember-token behavior is required.

- [ ] **Step 2: Run failing tests**

  Run: `php artisan test tests/Feature/B3/AuthTest.php`

- [ ] **Step 3: Implement legacy user model and AuthController**
  - `User::$primaryKey = 'user_id'`, no timestamps, hidden `password_hash`.
  - `getAuthPasswordName()`/`getAuthPassword()` map Laravel auth to `password_hash`.
  - Authenticate `username + is_active=1`; regenerate session on success.

- [ ] **Step 4: Run tests**

  Run: `php artisan test tests/Feature/B3/AuthTest.php`

  Expected: PASS.

- [ ] **Step 5: Commit checkpoint**

  `git commit -am "feat(b3): authenticate FactoryFlow users"`

---

### Task 3: QR Resolver + Cut Calculator Pure Domain Logic

**Files:**
- Create: `app/Services/B3/QrResolver.php`
- Create: `app/Services/B3/CutCalculator.php`
- Create: `app/Support/B3/B3Exception.php`
- Create: `tests/Unit/B3/QrResolverTest.php`
- Create: `tests/Unit/B3/CutCalculatorTest.php`

**Interfaces:**
- `QrResolver::parse(string $rawQr): array{kind:string, raw:string, ma_bin:?string}` parses syntax only.
- `QrResolver::resolve(string $rawQr): array{source_type:string, raw_qr:string, ma_bin:?string, product_id:int, tt_thanh_pham_id:int, ton_cuon_le_id:?int, ...}` resolves via `InventoryRepository` once injected in later task; unit tests may use a fake repository contract.
- `CutCalculator::firstCut(int $standardLength, int $cutLength, int $endValue, int $direction): array` where direction is `+1/-1`.
- `CutCalculator::partialCut(int $soDau, int $soCuoi, int $cutLength): array`.
- `B3Exception` carries `errorCode`, user Vietnamese message, HTTP status.

- [ ] **Step 1: Write QR resolver tests**
  - Structured `cuontp;MB001;QR-A` preserves full raw string and token 2 MaBin.
  - Exact `TonCuonLe.MaCuon == raw` wins before structured full resolution.
  - Plain `MB001` can resolve only exact partial reel.
  - Plain `MB001` that exists only as full MaBin throws `PLAIN_QR_IS_FULL_REEL`.
  - Unsupported/malformed structured QR throws `QR_INVALID_FORMAT`.

- [ ] **Step 2: Write cut math tests**
  - First-cut THUAN and NGHICH produce exact before/cut/after coordinates and `HeSoChieu`.
  - Partial cut derives direction from `SoDau < SoCuoi` or `SoDau > SoCuoi`.
  - Insufficient length/zero state throws stable business error.
  - Preserve current UI label behavior; tests assert values only, never presentation labels.

- [ ] **Step 3: Run tests and verify failure**

  Run: `php artisan test tests/Unit/B3/QrResolverTest.php tests/Unit/B3/CutCalculatorTest.php`

- [ ] **Step 4: Implement minimal domain logic**

- [ ] **Step 5: Run tests**

  Expected: PASS.

- [ ] **Step 6: Commit checkpoint**

  `git commit -am "feat(b3): add QR resolution and cut calculations"`

---

### Task 4: Plan/Inventory/Execution Repositories + Progress/Worklist Projection

**Files:**
- Create: `app/Repositories/B3/PlanRepository.php`
- Create: `app/Repositories/B3/InventoryRepository.php`
- Create: `app/Repositories/B3/ExecutionRepository.php`
- Create: `app/Services/B3/ProgressService.php`
- Create: `app/Services/B3/PlanWorklistService.php`
- Create: `tests/Unit/B3/ProgressServiceTest.php`
- Create: `tests/Unit/B3/PlanWorklistServiceTest.php`
- Create: `tests/Feature/B3/PlanApiTest.php`

**Interfaces:**
- `PlanRepository::activeIncompletePlans(?string $search = null): array`
- `PlanRepository::loadPlanState(int $planId): array`
- `PlanRepository::eligibleGroups(int $keHoachHangId, ?int $tonCuonLeId): array`
- `InventoryRepository::fullActualForProduct(int $productId, ?int $standardLength = null): int`
- `InventoryRepository::fifoFullSourceForProduct(int $productId, int $standardLength): ?array`
- `InventoryRepository::fifoFullSourceForMaBin(string $maBin, int $productId, int $standardLength): ?array`
- `InventoryRepository::partialByExactCode(string $maCuon): ?array`
- `ProgressService::itemProgress(array $state): string` returns exact Vietnamese status.
- `PlanWorklistService::project(array $planState): array` returns row DTOs.

- [ ] **Step 1: Write progress/worklist tests**
  - `Chưa thực hiện`, `Đang thực hiện`, `Hoàn thành` transition rules.
  - Whole remaining 3 → exactly 3 `FULL_TAKE` rows with `SoLuongCuon=1` and non-applicable columns null.
  - One unfinished unbound group → one `FULL_CUT` row with `SoCuonCatLe=1`.
  - Multiple unfinished groups bound to same `TonCuonLe` → one `PARTIAL_CUT` physical row.
  - Completed product within incomplete plan → one `COMPLETED_SUMMARY` row.
  - Fully completed plan omitted from active worklist.

- [ ] **Step 2: Write repository/API integration tests**
  - Active plan suggestions exclude `HUY` and fully completed plans.
  - Specific incomplete plan includes completed item summary rows.
  - “all plans” worklist includes every active incomplete plan.
  - Actual full stock formula subtracts `LichSuLayCuon` and first cuts (`LoaiNguon=CUON_CHAN`).
  - Reservation=actual does not make the current plan’s already-reserved B3 work disappear.
  - FIFO source ordering is oldest applicable source then `TTCuonDay.id`.

- [ ] **Step 3: Run and verify failure**

  Run: `php artisan test tests/Unit/B3/ProgressServiceTest.php tests/Unit/B3/PlanWorklistServiceTest.php tests/Feature/B3/PlanApiTest.php`

- [ ] **Step 4: Implement batch-oriented repositories/services**
  - Avoid `for each row -> query` N+1 patterns.
  - Use grouped aggregates for whole-done/cut-done/group completion.
  - Keep SQL in repositories; services compose business state.

- [ ] **Step 5: Run tests**

  Expected: PASS.

- [ ] **Step 6: Commit checkpoint**

  `git commit -am "feat(b3): add plan worklist and inventory queries"`

---

### Task 5: Scan Context Resolution API

**Files:**
- Create: `app/Services/B3/ScanContextService.php`
- Create: `app/Http/Controllers/B3/ScanController.php`
- Create: `app/Http/Requests/B3/ResolveScanRequest.php`
- Modify: `routes/web.php`
- Create: `tests/Feature/B3/ScanResolveApiTest.php`

**Interfaces:**
- `ScanContextService::resolve(string $rawQr, ?int $planId): array`
- `POST /api/b3/scan/resolve` request `{raw_qr, ke_hoach_id?}`.
- Response includes `source`, candidate/selected plan, item, `available_actions`, eligible `groups`, optional auto-selected group, details, and single-use `operation_token`.

- [ ] **Step 1: Write failing API tests**
  - Auth required.
  - QR product outside selected plan → `QR_NOT_IN_PLAN`.
  - Search-all: 0 plan → `NO_MATCHING_PLAN`; 1 → auto-select; >1 → return candidate plans for existing `Phạm vi kế hoạch` UI.
  - Full source with whole requirement only → `TAKE_WHOLE_REEL`.
  - Full source with unbound cut group only → `CUT_FULL_REEL`.
  - Both needs → both actions; server does not auto-prioritize.
  - Partial source → only `CUT_PARTIAL_REEL` and only groups bound to exact reel.
  - 0 group → `NO_ELIGIBLE_GROUP`; 1 → auto-select; >1 → return group list (no arbitrary selection).
  - Duplicate cut lengths remain distinct by `KeHoachCatChiTiet.id`.

- [ ] **Step 2: Run and verify failure**

  Run: `php artisan test tests/Feature/B3/ScanResolveApiTest.php`

- [ ] **Step 3: Implement request/controller/service**
  - Generate cryptographically random operation token.
  - Do not trust browser inventory/progress/action state.

- [ ] **Step 4: Run tests**

  Expected: PASS.

- [ ] **Step 5: Commit checkpoint**

  `git commit -am "feat(b3): resolve scan context from plan and inventory"`

---

### Task 6: Whole-Reel Execution + Persistent Idempotency

**Files:**
- Create: `app/Support/B3/B3Transaction.php`
- Create: `app/Services/B3/ExecutionService.php`
- Create: `app/Http/Controllers/B3/ExecutionController.php`
- Create: `app/Http/Requests/B3/TakeWholeReelRequest.php`
- Modify: `app/Repositories/B3/ExecutionRepository.php`
- Modify: `routes/web.php`
- Create: `tests/Feature/B3/TakeWholeReelTest.php`
- Create: `tests/Feature/B3/ConcurrencyAndIdempotencyTest.php`

**Interfaces:**
- `B3Transaction::run(callable $callback): mixed` starts an explicit SQLite `BEGIN IMMEDIATE` transaction, retries bounded `SQLITE_BUSY`, fully rolls back on exception.
- `ExecutionService::takeWhole(string $rawQr, int $keHoachHangId, string $operationToken, User $actor): array`
- `POST /api/b3/execute/take-whole` request `{raw_qr, ke_hoach_hang_id, operation_token}`.
- Operation marker format stored in history `GhiChu`: `__B3_OP__:<uuid>`.

- [ ] **Step 1: Write failing whole-reel tests**
  - One request inserts exactly one `LichSuLayCuon` with `SoLuong=1` and authenticated username.
  - QR confirms correct full/product eligibility, but accounting `TTCuonDay_ID` is FIFO across eligible full stock for product, not forced to scanned MaBin.
  - Requirement already complete → `PLAN_REQUIREMENT_COMPLETED`.
  - Actual full stock exhausted → `INSUFFICIENT_FULL_STOCK`.
  - `actual == reserved` still allows the current reserved execution.
  - `actual < reserved` / changed state → reject without insert.
  - Same operation token repeated after first commit → no second history and `DUPLICATE_REQUEST`.
  - Username supplied by request, if any, is ignored; server session user wins.

- [ ] **Step 2: Run and verify failure**

  Run: `php artisan test tests/Feature/B3/TakeWholeReelTest.php tests/Feature/B3/ConcurrencyAndIdempotencyTest.php`

- [ ] **Step 3: Implement transaction/idempotency/whole execution**
  - Re-resolve QR and re-read plan/progress/inventory inside transaction.
  - Persist operation marker in `LichSuLayCuon.GhiChu` so retry after lost HTTP response is detectable from DB, not process-local cache.

- [ ] **Step 4: Run tests**

  Expected: PASS.

- [ ] **Step 5: Commit checkpoint**

  `git commit -am "feat(b3): execute whole reel atomically"`

---

### Task 7: Full→Partial and Partial→Partial Cut Execution

**Files:**
- Create: `app/Http/Requests/B3/CutReelRequest.php`
- Modify: `app/Services/B3/ExecutionService.php`
- Modify: `app/Repositories/B3/ExecutionRepository.php`
- Modify: `app/Repositories/B3/InventoryRepository.php`
- Modify: `routes/web.php`
- Create: `tests/Feature/B3/CutReelTest.php`
- Extend: `tests/Feature/B3/ConcurrencyAndIdempotencyTest.php`

**Interfaces:**
- `ExecutionService::cut(string $rawQr, int $keHoachHangId, int $groupId, int $detailId, ?int $endValue, ?int $direction, string $operationToken, User $actor): array`
- `POST /api/b3/execute/cut` request `{raw_qr, ke_hoach_hang_id, group_id, detail_id, end_value?, direction?, operation_token}`.
- For first full cut `direction` maps to `+1/-1`; for partial cut server ignores browser direction and derives from current `TonCuonLe`.

- [ ] **Step 1: Write failing first-cut tests**
  - Structured full QR resolves source within scanned MaBin, FIFO if multiple eligible `TTCuonDay` inside that MaBin.
  - Source length must match `KeHoachHang.ChieuDai1Cuon_KeHoach`.
  - Create `TonCuonLe.MaCuon = entire raw QR`.
  - Create/bind/history/update happen atomically; injected failure after `TonCuonLe` insert rolls back every change.
  - `LichSuCat.LoaiNguon=CUON_CHAN`, `MaQuetThucTe=raw QR`, actor from session.

- [ ] **Step 2: Write failing partial-cut tests**
  - Exact partial reel only; group must be bound to that exact `TonCuonLe`.
  - Derive `h` from current `SoDau/SoCuoi` and cut from `SoCuoi` side.
  - Insufficient current length → `INSUFFICIENT_LENGTH`.
  - Reserved length must not exceed actual current length before execution.
  - After last length is consumed set `TonCuonLe.TrangThai=HET`.
  - Same detail executed twice → unique/history conflict maps to stable business error and no second mutation.
  - Multiple bound groups remain selectable; service executes only caller-selected eligible group/detail.

- [ ] **Step 3: Write stale/concurrency tests**
  - Group becomes bound after resolve → reject stale.
  - Detail completed after resolve → reject.
  - `TonCuonLe.SoCuoi` changes after resolve and no longer fits → reject.
  - Same operation token retry → no duplicate cut.

- [ ] **Step 4: Run and verify failure**

  Run: `php artisan test tests/Feature/B3/CutReelTest.php tests/Feature/B3/ConcurrencyAndIdempotencyTest.php`

- [ ] **Step 5: Implement cut execution**
  - Preserve existing UI labels; only server math/state changes.
  - Store idempotency marker in history `GhiChu`.

- [ ] **Step 6: Run tests**

  Expected: PASS.

- [ ] **Step 7: Commit checkpoint**

  `git commit -am "feat(b3): execute full and partial cuts atomically"`

---

### Task 8: Page/API Controllers + Stable Error Contract

**Files:**
- Create: `app/Http/Controllers/B3/B3PageController.php`
- Create: `app/Http/Controllers/B3/PlanController.php`
- Modify: `app/Http/Controllers/B3/ScanController.php`
- Modify: `app/Http/Controllers/B3/ExecutionController.php`
- Modify: `bootstrap/app.php`
- Modify: `routes/web.php`
- Create: `tests/Feature/B3/ErrorContractTest.php`

**Interfaces:**
- JSON errors: `{success:false,error_code:string,message:string}` with approved HTTP statuses.
- Page routes and all `/api/b3/*` execution/read endpoints require authenticated active user.

- [ ] **Step 1: Write failing error-contract tests**
  - 401 session-expired → `AUTH_REQUIRED`.
  - inactive/session user handling → `USER_INACTIVE`/logout path.
  - 404 missing plan/source as applicable.
  - 409 stale/detail-already-done/duplicate.
  - 422 malformed QR/business-invalid.
  - 503 bounded `SQLITE_BUSY` exhaustion → `DATABASE_BUSY`.
  - unexpected exception → generic `EXECUTION_FAILED`, no SQL/stack trace in response.

- [ ] **Step 2: Run failing tests**

- [ ] **Step 3: Implement controllers/exception rendering/middleware checks**
  - `bootstrap/app.php` configures trusted forwarded headers suitable for reverse proxy/Cloudflare without hard-coding business hostnames.

- [ ] **Step 4: Run tests**

  Run: `php artisan test tests/Feature/B3/ErrorContractTest.php`

- [ ] **Step 5: Commit checkpoint**

  `git commit -am "feat(b3): expose authenticated B3 API contract"`

---

### Task 9: Replace Prototype JavaScript With Real API State

**Files:**
- Create: `public/js/cat-day/b3-api.js`
- Create: `public/js/cat-day/b3-state.js`
- Modify: `public/js/cat-day/cat-day-ui.js`
- Modify: `resources/views/welcome.blade.php`
- Modify: `resources/views/layouts/cat-day.blade.php`
- Modify: `public/css/cat-day/cat-day-ui.css`
- Modify B3 scanner configuration call site to `allowImage=false`
- Create/extend: `tests/Feature/B3/B3PageTest.php`

**Interfaces:**
- `window.B3Api.login/logout/plans/worklist/resolveQr/takeWhole/cut` (or module-equivalent globals consistent with non-Vite existing script style).
- `B3State` stores selected plan/show-all/worklist/current scan context/current group/current detail/operation token; no business calculations beyond display preview.

- [ ] **Step 1: Write page smoke tests**
  - Unauthenticated page shows login UI.
  - Authenticated page can load app shell.
  - Blade contains `Tình trạng` header and no mock-scenario selector/demo QR controls.
  - B3 script stack includes API/state before UI script.

- [ ] **Step 2: Remove all prototype/mock data and fake login**
  - Delete `B3_MOCK_SCENARIOS`, demo rows/plans, `simulateB3Save`, local/sessionStorage fake login, mock scenario selector, demo QR success controls.

- [ ] **Step 3: Wire real login/logout and plan worklist**
  - Login form posts to Laravel and then loads real worklist.
  - Specific plan selection and `Tìm toàn bộ` use API.
  - Render row types per server DTO; leave non-applicable cells blank; show `Tình trạng`.

- [ ] **Step 4: Wire scanner resolve and actions**
  - Camera scan only; `allowImage=false`.
  - Existing `Phạm vi kế hoạch` UI handles multiple plan candidates.
  - Existing tab UI shows only server-returned valid actions.
  - If >1 group render `Nhóm cần thực hiện`; if 1 use existing detail UI directly.
  - Preserve first-cut confirmation, direction input, preview labels, detail status list, and continuous-scan timing.

- [ ] **Step 5: Wire execute + authoritative refresh**
  - Save sends operation token and minimal IDs/input only.
  - On success replace affected worklist/state from server response without full-page reload.
  - On stale error clear old context, refresh worklist, require re-scan.
  - Continuous scan reopens only after successful save and refresh.

- [ ] **Step 6: Run backend page tests and static JS sanity check**

  Run: `php artisan test tests/Feature/B3/B3PageTest.php`

  Run if Node is available: `node --check public/js/cat-day/b3-api.js && node --check public/js/cat-day/b3-state.js && node --check public/js/cat-day/cat-day-ui.js`

- [ ] **Step 7: Manual UI smoke test**
  - Login.
  - plan search / all plans.
  - status rows / completed summary.
  - one/multiple plan scan context.
  - whole vs cut action tabs.
  - one/multiple group selector.
  - first full cut and partial continuation.
  - continuous scan after successful save.

- [ ] **Step 8: Commit checkpoint**

  `git commit -am "feat(b3): connect existing UI to real execution API"`

---

### Task 10: HTTPS LAN + Cloudflare Tunnel Deployment Support

**Files:**
- Modify: `bootstrap/app.php`
- Modify: `.env.example`
- Create: `docs/deployment/b3-lan-cloudflare.md`
- Create/extend: `tests/Feature/B3/ProxyHttpsTest.php`

**Interfaces:**
- Application generates secure URLs/cookies correctly when served by trusted LAN HTTPS reverse proxy or Cloudflare Tunnel.
- Business routes remain identical regardless of entry path.

- [ ] **Step 1: Write proxy tests**
  - Forwarded HTTPS request is treated as secure and generates HTTPS URLs.
  - No business permission branch depends on Cloudflare-specific headers.

- [ ] **Step 2: Implement/document deployment config**
  - Trusted proxy/forwarded-header handling in Laravel 12.
  - LAN: browser-trusted HTTPS hostname/cert.
  - Cloudflare: public HTTPS tunnel → same Laravel origin, no SQLite exposure.
  - Session cookies secure/HttpOnly/SameSite=Lax in deployed HTTPS env.
  - Document cloudflared example without hard-coding user production domain.

- [ ] **Step 3: Run tests**

  Run: `php artisan test tests/Feature/B3/ProxyHttpsTest.php`

- [ ] **Step 4: Commit checkpoint**

  `git commit -am "docs(b3): support LAN and Cloudflare HTTPS deployment"`

---

### Task 11: Full Regression, Schema Audit, and Packaging

**Files:**
- Review all B3 files above.
- Output package preserving Laravel project paths.

**Interfaces:**
- Produces a replacement ZIP containing every changed/created file in original project layout plus spec/plan and a concise verification report.

- [ ] **Step 1: Run full automated suite**

  Run: `php artisan test`

  Expected: all B3 + existing example tests pass (update/remove only genuinely obsolete skeleton tests when justified).

- [ ] **Step 2: Run syntax/static checks**

  Run: `php -l` across all modified/created PHP files.

  Run: `node --check` across B3 JavaScript when Node is available.

- [ ] **Step 3: Verify production schema compatibility**
  - Run read-only schema inspection against supplied `QLSX_v02(5).db`.
  - Confirm no code expects columns/tables absent from supplied schema.
  - Confirm no migrations are required.

- [ ] **Step 4: Run focused B3 critical scenarios**
  - malformed/plain-full QR rejection;
  - whole take FIFO/idempotency;
  - full→partial atomicity;
  - partial continuation;
  - duplicate detail rejection;
  - multiple plan/group selection;
  - stale state rollback;
  - item/plan completion worklist projection.

- [ ] **Step 5: Performance review**
  - inspect worklist/inventory queries for N+1;
  - use SQLite `EXPLAIN QUERY PLAN` on key query shapes against supplied schema when practical;
  - do not add indexes unless the query plan demonstrates need.

- [ ] **Step 6: Create verification report**
  - list commands run and exact results;
  - list anything not executable in the environment (camera, trusted LAN cert, live Cloudflare tunnel) as NOT TESTED, not PASS.

- [ ] **Step 7: Package changed files**
  - Preserve project-relative structure.
  - Include `docs/superpowers/specs/2026-10-06-b3-laravel12-sqlite-design.md`.
  - Include this plan.
  - Do not include `.env`, production DB, credentials, vendor/node_modules, or font files.

- [ ] **Step 8: Final review checkpoint**

  In a real git repository: request independent code review before merge.

