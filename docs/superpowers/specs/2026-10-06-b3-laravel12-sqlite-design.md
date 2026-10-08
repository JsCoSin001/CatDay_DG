# FactoryFlow B3 — Laravel 12 + SQLite Design Specification

**Date:** 2026-10-06  
**Scope:** B3 execution UI/backend only  
**Status:** Design approved in conversation; pending written-spec review  
**Baseline:** Existing B3 UI in `tests.zip`, B1/B2 behavior and schema already implemented separately

---

## 1. Purpose

B3 completes the remaining execution stage after B1 and B2.

The end-to-end business flow is:

1. **B1 — Physical inventory creation/import**
   - establishes full-reel quantity inventory and physical partial-reel inventory;
   - full reels are quantity-managed;
   - partial reels are managed as individual `TonCuonLe` physical reels.
2. **B2 — Planning/reservation**
   - defines what each plan/product must take or cut;
   - reserves full-reel quantity and/or partial-reel length;
   - groups cut details so all details in one `KeHoachCatNhom` must come from the same physical reel.
3. **B3 — Execution**
   - user selects one plan or the active-worklist scope;
   - user scans a physical QR;
   - server verifies the scanned product/source against the plan;
   - server determines the valid operation from plan + current DB state;
   - user performs whole-reel take or cutting;
   - server writes immutable execution history and updates physical partial-reel state atomically.

B3 is a work-execution system, not a planning editor and not a general historical-report screen.

---

## 2. Success Criteria

B3 is successful when all of the following hold:

- only authenticated active users can execute work;
- `users.username` from the authenticated server session is the authoritative `NguoiThucHien`;
- QR scans are resolved against current inventory and selected plan scope on the server;
- a scan cannot execute work for the wrong product or wrong plan;
- the server decides which operations are valid; JavaScript never decides business validity by itself;
- whole-reel take, first cut from full reel, and subsequent partial-reel cut are transaction-safe;
- execution history is immutable in normal B3 operation;
- B3 never partially commits `TonCuonLe`, group binding, or history;
- multiple work sessions can resume an unfinished plan and clearly show which product items are complete, in progress, or not started;
- the existing B3 UI interaction model is preserved unless an additional selector is required by real data ambiguity;
- the system works through both LAN HTTPS and Internet HTTPS through Cloudflare Tunnel;
- all prototype/mock login, mock plans, mock QR contexts, random/mock save behavior, and demo-only data are removed before real testing.

---

## 3. Explicit Non-Goals

B3 v1 does **not**:

- redesign B1 or B2;
- change B2 planning semantics;
- create a new reservation table;
- use `KeHoach.TrangThai` as progress state;
- track physical identity of whole reels after they are taken as whole reels;
- allow one scan to take multiple whole reels;
- implement persistent “remember me” authentication;
- allow QR decoding from image files in production;
- expose SQLite directly through Cloudflare;
- implement normal-flow correction/deletion of immutable execution history;
- add schema migrations unless an implementation blocker is discovered against the supplied schema;
- change the existing first-cut display labels or presentation purely to rename fields.

---

## 4. Database and Runtime

### 4.1 Database

Laravel 12 uses the FactoryFlow SQLite database supplied/deployed for the project.

Development example:

```text
D:\Database\QLSX_v02.db
```

Production path is environment-configurable and points to the server copy.

Laravel business/auth access uses this same FactoryFlow SQLite database.

### 4.2 Framework runtime data

Framework runtime data should not add unrelated framework tables to the FactoryFlow business schema in v1:

```env
SESSION_DRIVER=file
CACHE_STORE=file
QUEUE_CONNECTION=sync
```

### 4.3 SQLite connection invariants

Every relevant SQLite connection must enforce:

```sql
PRAGMA foreign_keys = ON;
```

Write operations use short authoritative transactions. The transaction helper should use an immediate write lock strategy appropriate for SQLite so that `re-read -> validate -> write` is serialized against competing writers.

A configured `busy_timeout` and bounded retry behavior should be used for transient `SQLITE_BUSY` conditions.

WAL may be enabled only when the DB is on a local filesystem where SQLite WAL semantics are appropriate. It is not assumed for SMB/network-share storage.

---

## 5. Existing Schema Semantics Used by B3

B3 relies on these existing tables:

```text
KeHoach
KeHoachHang
TonCuonLe
KeHoachCatNhom
KeHoachCatChiTiet
LichSuLayCuon
LichSuCat
TTThanhPham
TTNhapKhoTP
TTCuonDay
DanhSachMaSP
users
```

Important semantics:

- `KeHoach.TrangThai` is lifecycle state, currently `ACTIVE/HUY`, not completion progress.
- `(KeHoach_ID, DanhSachMaSP_ID)` identifies one `KeHoachHang` item/product.
- `TonCuonLe.MaCuon` is unique and identifies one physical partial reel.
- `KeHoachCatNhom` means all its `KeHoachCatChiTiet` must use the same physical reel.
- `KeHoachCatNhom.TonCuonLe_ID = NULL` means the plan requires an as-yet-unidentified suitable full reel.
- `KeHoachCatNhom.TonCuonLe_ID != NULL` binds the group to that exact partial reel.
- each `KeHoachCatChiTiet` is one cut length;
- `LichSuCat.KeHoachCatChiTiet_ID` is unique and is the authoritative completion marker for that detail;
- `LichSuLayCuon` records whole-reel quantity execution;
- `LichSuCat` records cutting execution and is immutable in normal B3 flow.

---

## 6. Meaning of Plan, Item, Row, and Progress

### 6.1 Plan

A `KeHoach` can contain multiple product items.

A plan remains an active worklist candidate only when:

```text
KeHoach.TrangThai = ACTIVE
AND
at least one KeHoachHang is not complete
```

A fully completed plan is derived from execution history and no longer appears in the active B3 worklist even if `KeHoach.TrangThai` remains `ACTIVE`.

B3 does not change `KeHoach.TrangThai` to represent completion.

### 6.2 Item

One business item is one `KeHoachHang`, therefore one product within one plan.

An item may contain:

- remaining whole-reel take quantity;
- one or more unbound full-reel cut groups;
- one or more groups bound to one or more partial reels.

### 6.3 Item progress

For one `KeHoachHang`:

```text
whole_required = SoLuongCuonCanLay
whole_done     = SUM(LichSuLayCuon.SoLuong)
cut_required   = COUNT(KeHoachCatChiTiet belonging to the item)
cut_done       = COUNT(LichSuCat for those details)
```

States:

```text
Chưa thực hiện
  whole_done = 0 AND cut_done = 0

Hoàn thành
  whole_done >= whole_required
  AND cut_done = cut_required

Đang thực hiện
  every other non-complete state after at least one execution history exists
```

The UI `Tình trạng` column shows this item/product state.

---

## 7. `Danh sách kế hoạch` Worklist Projection

The table remains a **worklist**, not a historical archive.

### 7.1 Scope behavior

When one specific plan is selected:

- show that active, incomplete plan’s execution rows;
- preserve visibility of any product item already completed inside that still-incomplete plan by showing one completed summary row.

When “Tìm toàn bộ kế hoạch” is selected:

- show all `ACTIVE` plans that still contain at least one unfinished item;
- within each such plan, apply the same row rules.

Fully completed plans do not remain in this active worklist.

### 7.2 Row types

Internal row types:

```text
FULL_TAKE
FULL_CUT
PARTIAL_CUT
COMPLETED_SUMMARY
```

### 7.3 Whole-reel take rows

For whole-reel take work:

```text
remaining = SoLuongCuonCanLay - SUM(LichSuLayCuon.SoLuong)
```

Generate **one displayed row per remaining full reel**.

Example: remaining = 3 -> 3 rows.

Relevant fields:

```text
Số lượng cuộn = 1
```

Columns not meaningful to this row are blank, including LOT, Số đầu, Số cuối, and Số cuộn cắt lẻ.

### 7.4 Unbound full-reel cut rows

Each unfinished `KeHoachCatNhom` with:

```text
TonCuonLe_ID IS NULL
```

is one physical full reel reserved for cutting and appears as one row.

Relevant field:

```text
Số cuộn cắt lẻ = 1
```

Physical fields not yet known are blank.

### 7.5 Partial-reel rows

For partial-reel work:

- one physical `TonCuonLe` / `MaCuon` / LOT = one row;
- if multiple unfinished groups are bound to the same `TonCuonLe`, they still appear as one physical row;
- group selection happens after scanning when more than one group is eligible.

Relevant fields may include:

```text
LOT = TonCuonLe.MaCuon
Số đầu = TonCuonLe.SoDau
Số cuối = TonCuonLe.SoCuoi
Số cuộn cắt lẻ = 1
```

### 7.6 Completed item row

If an item/product is fully complete but its parent plan is still incomplete:

- remove its completed physical work rows from the active row list;
- keep exactly one `COMPLETED_SUMMARY` row;
- set `Tình trạng = Hoàn thành`;
- leave physical-detail columns blank where they no longer apply.

---

## 8. Authentication

### 8.1 User model mapping

The Laravel user model maps to the existing `users` table and existing password hash.

Relevant fields include:

```text
user_id
username
password_hash
is_active
```

Use the existing bcrypt-compatible hash with Laravel authentication/password checking.

### 8.2 Login rules

Login succeeds only for an active user.

On successful login:

- regenerate the Laravel session;
- store/authenticate the user server-side;
- do not trust a username sent by browser requests.

`NguoiThucHien` is always:

```text
auth()->user()->username
```

### 8.3 Remember me

Persistent “remember me” is out of scope for v1. The existing prototype checkbox should not result in a remember-token schema addition.

### 8.4 Logout

Logout invalidates the session and regenerates the CSRF token.

---

## 9. QR Scanner Boundary

The reusable QR component remains generic.

It only performs:

```text
camera -> decode -> raw trimmed QR string
```

It does not:

- parse FactoryFlow business type;
- query Laravel/database;
- choose plan, item, group, detail, or action;
- save execution.

Production B3 sets image-file decoding off:

```text
allowImage = false
```

The reusable image decoder may remain in the scanner package but is not exposed by B3 production UI.

---

## 10. QR Business Resolution

### 10.1 Structured full-origin QR

Expected full-origin QR starts with:

```text
cuontp;[MaBin];...
```

Resolution order is mandatory:

1. trim raw QR;
2. exact lookup `TonCuonLe.MaCuon = raw QR`;
3. if found and usable, treat as **partial reel**, even though its prefix is `cuontp`;
4. if not found, parse token 2 as `MaBin`;
5. resolve the corresponding imported full-reel source;
6. validate that the source is imported, valid for full-reel handling, and has actual full inventory;
7. treat as **full reel**.

The prefix describes original label type, not necessarily current physical state.

### 10.2 Full -> partial identity

When a structured full reel is cut for the first time, store the **entire raw structured QR** as:

```text
TonCuonLe.MaCuon
```

No new label is required.

Future scans of that same raw QR resolve exact `TonCuonLe` first and therefore treat it as the existing partial reel.

### 10.3 Plain QR

A raw value containing only `[MaBin]` is never accepted as a full reel.

Resolution:

```text
exact TonCuonLe.MaCuon = raw plain value
```

If found and active/usable -> partial reel.

If not found as `TonCuonLe`, but the same plain value resolves to a full-reel `TTThanhPham.MaBin` -> business error and stop.

This preserves compatibility with B1 partial reels whose `TonCuonLe.MaCuon` is their plain MaBin.

---

## 11. Plan Matching and Scope

After QR resolution, the server knows at least:

```text
DanhSachMaSP_ID
source kind (full/partial)
physical source context
```

### 11.1 Specific plan selected

Only work inside that plan is considered.

Wrong product / no eligible work -> reject.

### 11.2 “Tìm toàn bộ kế hoạch”

Search only active, incomplete plans.

From the scanned product/source:

```text
0 matching plans -> reject
1 matching plan  -> auto-select
>1 matching plans -> use existing Phạm vi kế hoạch selector
```

After user chooses a plan, the server resolves again against that specific plan before execution.

---

## 12. Valid Actions

The server, not the active UI tab, determines valid actions.

### 12.1 Full reel

Possible action:

```text
TAKE_WHOLE_REEL
```

when remaining whole-reel requirement > 0.

Possible action:

```text
CUT_FULL_REEL
```

when at least one unfinished unbound cut group exists for that item.

If both are valid, the existing UI lets the operator choose.

### 12.2 Partial reel

A partial reel can only use:

```text
CUT_PARTIAL_REEL
```

and only when at least one unfinished group is bound to that exact `TonCuonLe`.

---

## 13. Group and Detail Selection

Use the same rule for full and partial reels.

After plan + item + physical source are resolved:

```text
0 eligible unfinished groups
  -> reject with no matching work

1 eligible group
  -> auto-select

>1 eligible groups
  -> show Nhóm cần thực hiện selector
```

After group selection, reuse the existing `Chiều dài cần cắt` detail-selection UI.

Details are identified by `KeHoachCatChiTiet_ID`, never by length alone. Therefore duplicate lengths in one group remain distinct tasks.

Once a first cut succeeds and a formerly unbound group is bound to a newly created `TonCuonLe`, that group must not switch to another reel.

---

## 14. Whole-Reel Take Semantics

### 14.1 Quantity-only business model

Whole-reel take does not track the physical LOT/MaBin identity of the reel after it is taken.

Each successful scan/save performs exactly:

```text
LichSuLayCuon.SoLuong = 1
```

If a plan requires 10 whole reels, the operator performs 10 scan/execute cycles.

### 14.2 Role of the scanned QR

The structured QR is still used to verify:

- this is a valid imported full reel;
- its product matches the plan/item;
- the product has eligible full inventory/work.

However the accounting source `LichSuLayCuon.TTCuonDay_ID` is not forced to the scanned MaBin.

### 14.3 FIFO accounting

Whole-reel take allocates FIFO across eligible full-reel inventory of the product:

1. oldest eligible source;
2. `TTCuonDay.id` as tie-breaker.

This preserves the quantity-managed full-reel model.

---

## 15. Full-Reel Inventory Calculation

For full-reel inventory, a `TTCuonDay` source is full when:

```text
SoDau IS NULL
AND SoCuoi IS NULL
```

Actual full quantity is based on original full quantity minus:

- whole reels already taken through `LichSuLayCuon`;
- one full reel for each first cut represented by `LichSuCat.LoaiNguon = CUON_CHAN` linked to the source through the created `TonCuonLe`.

At product level, sum remaining eligible full-source quantities.

B3 executes an existing reservation. Therefore B3 must not incorrectly reject simply because `available-after-reservation = 0` when the current plan owns the reservation being executed.

The invariants checked during execution include:

```text
current plan still has the required work
actual full inventory > 0
total ACTIVE reservations are not greater than actual inventory
```

If actual inventory is already below reservation, treat this as stale/abnormal state and do not guess.

---

## 16. Partial-Reel Inventory and Reservation

Current physical remaining length:

```text
ABS(TonCuonLe.SoCuoi - TonCuonLe.SoDau)
```

Reserved partial length is the sum of unfinished cut details from active groups bound to the exact `TonCuonLe`.

Before cutting:

```text
reserved_length <= actual_length
```

A current-plan reserved detail can still be executed even when generic `available-after-reservation = 0`, because B3 is consuming that reservation rather than creating a new one.

---

## 17. Cut Mathematics

### 17.1 Subsequent partial-reel cut

For an existing partial reel:

```text
h = +1 when SoDau < SoCuoi
h = -1 when SoDau > SoCuoi
```

Cut from the `SoCuoi` side:

```text
SoDauTruoc = current.SoDau
SoCuoiTruoc = current.SoCuoi

SoDauCat = SoCuoiTruoc
SoCuoiCat = SoCuoiTruoc - h * ChieuDaiCanCat

SoDauSau = SoDauTruoc
SoCuoiSau = SoCuoiCat
```

Then update current `TonCuonLe` state to:

```text
SoDau = SoDauSau
SoCuoi = SoCuoiSau
```

If the endpoints meet, set `TonCuonLe.TrangThai = HET`.

### 17.2 First cut from full reel

The existing UI collects the information needed for first-cut orientation/endpoint preview.

The server recalculates the same business result; browser preview is not authoritative.

The current UI labels and display wording are intentionally preserved. **Do not rename the existing preview label(s) as part of B3 implementation.**

The internal/server-side field meaning and formulas remain as agreed.

---

## 18. Transaction: Take Whole Reel

Authoritative sequence:

```text
BEGIN IMMEDIATE
  validate operation token/idempotency
  re-read KeHoach
  re-read KeHoachHang and current progress
  require KeHoach.TrangThai = ACTIVE
  require remaining whole-reel work > 0
  re-resolve QR as a valid full-reel product/source
  re-read actual inventory and reservation invariants
  resolve FIFO TTCuonDay across the product
  INSERT LichSuLayCuon(
      KeHoachHang_ID,
      TTCuonDay_ID,
      SoLuong = 1,
      NguoiThucHien = authenticated username,
      ...
  )
COMMIT
```

No `TonCuonLe` is created.

On any failure: rollback everything.

---

## 19. Transaction: First Cut Full -> Partial

Authoritative sequence:

```text
BEGIN IMMEDIATE
  validate operation token/idempotency
  re-read KeHoach / item / group / detail / histories
  require ACTIVE plan
  require group still unbound
  require detail not yet executed
  re-resolve structured QR
  require QR still resolves to valid full-reel source
  require product and plan match
  require current full inventory/invariants remain valid
  resolve TTCuonDay FIFO within the scanned MaBin/source scope
  validate standard full-reel length against ChieuDai1Cuon_KeHoach
  server-recalculate first-cut coordinates

  INSERT TonCuonLe(
      MaCuon = complete raw structured QR,
      TTThanhPham_ID,
      TTCuonDay_ID,
      current post-cut SoDau/SoCuoi,
      TrangThai
  )

  UPDATE KeHoachCatNhom
    SET TonCuonLe_ID = newly_created_id

  INSERT LichSuCat(
      KeHoachCatChiTiet_ID,
      TonCuonLe_ID,
      LoaiNguon = CUON_CHAN,
      ChieuDaiCat,
      before/cut/after coordinates,
      HeSoChieu,
      MaQuetThucTe = raw QR,
      NguoiThucHien = authenticated username
  )

  UPDATE final TonCuonLe current state if needed
COMMIT
```

Atomicity requirement:

- never leave a `TonCuonLe` without its intended group/history because a later statement failed;
- never bind a group without the corresponding successful history;
- rollback the complete transaction on any error.

---

## 20. Transaction: Cut Existing Partial Reel

Authoritative sequence:

```text
BEGIN IMMEDIATE
  validate operation token/idempotency
  exact re-read TonCuonLe by resolved identity
  re-read group / detail / histories / reservation
  require TonCuonLe ACTIVE
  require group bound to this exact TonCuonLe
  require detail unfinished
  require actual current length >= requested detail
  require reservation invariant valid
  derive h from current DB SoDau/SoCuoi
  calculate cut coordinates on server

  INSERT LichSuCat(
      ...,
      LoaiNguon = CUON_LE,
      ...
  )

  UPDATE TonCuonLe current SoDau/SoCuoi
  set TrangThai = HET when remaining length reaches zero
COMMIT
```

The browser does not supply authoritative direction for an already-existing partial reel.

---

## 21. Idempotency and Duplicate Requests

B3 must protect against:

- double-click;
- browser retry;
- network response loss followed by retry;
- two submissions of the same logical operation.

`LichSuCat.KeHoachCatChiTiet_ID UNIQUE` is the final DB protection for cut-detail duplication.

Whole-reel take has no physical unique identity in history, so B3 uses a server-generated operation token.

Preferred v1 mechanism:

- issue a unique operation token from scan/resolve context;
- persist an internal token marker in execution history `GhiChu` using a reserved prefix such as `__B3_OP__:<uuid>`;
- under the same immediate write transaction, check whether the token marker already exists before writing;
- retry of a committed operation returns duplicate/already-recorded behavior instead of consuming another reel.

The token is not a replacement for re-read business validation.

---

## 22. Application Architecture

Approved structure:

```text
HTTP Controller
    -> B3 Service layer
        -> Repository / Query Builder layer
            -> SQLite
```

Suggested classes:

```text
AuthController
B3PageController
PlanController
ScanController
ExecutionController

QrResolver
PlanWorklistService
ScanContextService
ExecutionService
ProgressService
CutCalculator

PlanRepository
InventoryRepository
ExecutionRepository
B3Transaction
```

Responsibilities:

- Controllers: request/response boundary only;
- Services: all B3 business decisions;
- Repositories: SQL/data access only;
- transaction helper: SQLite authoritative transaction boundary;
- JavaScript: display/interactions only.

Avoid a god controller and avoid putting business SQL directly in JavaScript-facing controllers.

---

## 23. API Contract

Suggested authenticated session endpoints:

```text
POST /login
POST /logout
GET  /b3

GET  /api/b3/plans
GET  /api/b3/plans/{id}/worklist
GET  /api/b3/worklist
POST /api/b3/scan/resolve
POST /api/b3/execute/take-whole
POST /api/b3/execute/cut
```

All execution endpoints re-resolve/re-read authoritative state; IDs/context sent by the browser are never sufficient proof by themselves.

---

## 24. Scan Resolve Response

`POST /api/b3/scan/resolve` should return enough state to render the existing UI without embedding business rules in JavaScript.

Logical response fields include:

```text
source
matching plans / selected plan
item
available actions
eligible groups
selected group when unique
eligible details / detail states
operation token
```

When one plan/group is unique, the server may auto-select it.

When multiple plans/groups exist, the existing/new selector is populated from server-provided candidates.

---

## 25. JavaScript/UI Integration

Preserve the existing B3 UI layout and behaviors.

Refactor data access away from the prototype mock logic, for example:

```text
public/js/cat-day/cat-day-ui.js
public/js/cat-day/b3-api.js
public/js/cat-day/b3-state.js
```

Keep UI responsibilities such as:

- table rendering;
- bottom sheet;
- operation tabs;
- plan/group/detail selectors;
- first-cut inputs and preview;
- continuous scan UX;
- scanner opening/closing.

Remove prototype behavior including:

- fake login;
- mock plan arrays;
- mock worklist rows;
- mock QR scenarios;
- random/mock save simulation;
- demo QR success constants/buttons used only for mock execution.

Do not redesign labels or established interaction flow unless required by a real ambiguity already approved in this spec.

---

## 26. Post-Save Refresh

A successful execute response should return authoritative refreshed state, not only `success=true`.

At minimum refresh relevant:

```text
execution result
item progress
plan progress
remaining work rows
group/detail state
current TonCuonLe state when applicable
```

UI updates without reloading the whole page.

If an item just became complete while another item in the plan remains incomplete:

- remove its physical work rows;
- replace with one completed summary row.

If the last item of a plan becomes complete:

- remove the plan from the active worklist.

---

## 27. Continuous Scan

When continuous scan is enabled:

```text
save succeeds
-> refresh authoritative UI state
-> close current operation context
-> reopen scanner
```

If save fails, do not automatically advance to another scan.

---

## 28. Error Contract

Backend errors have:

```text
error_code
message
```

JavaScript branches on `error_code`, not Vietnamese message text.

Core codes include:

```text
AUTH_REQUIRED
USER_INACTIVE
PLAN_NOT_FOUND
PLAN_NOT_ACTIVE
QR_INVALID_FORMAT
PLAIN_QR_IS_FULL_REEL
QR_SOURCE_NOT_FOUND
QR_SOURCE_NOT_USABLE
QR_NOT_IN_PLAN
NO_MATCHING_PLAN
NO_AVAILABLE_ACTION
NO_ELIGIBLE_GROUP
DETAIL_ALREADY_DONE
INSUFFICIENT_LENGTH
INSUFFICIENT_FULL_STOCK
PLAN_REQUIREMENT_COMPLETED
STALE_DATA
DUPLICATE_REQUEST
DATABASE_BUSY
EXECUTION_FAILED
```

Technical exceptions/SQL/stack traces remain server-side and are not exposed to the operator.

---

## 29. Stale Data Behavior

Resolve/preview state is not a lock.

Every write re-reads current DB state inside the transaction.

If another device changes the relevant work/inventory between scan resolve and execute:

- reject stale execution;
- rollback/no partial write;
- invalidate the old operation context/token as appropriate;
- refresh worklist;
- require operator to scan/resolve again when physical confirmation is necessary.

---

## 30. HTTPS Deployment

B3 must support two access paths to the same backend/database.

### 30.1 LAN

Use browser-trusted HTTPS on the LAN, for example an internal hostname/certificate setup appropriate to deployment.

Do not rely on insecure `http://192.168.x.x` for production camera access.

### 30.2 Internet/customer testing

Use Cloudflare Tunnel:

```text
Internet client
 -> Cloudflare HTTPS
 -> cloudflared tunnel
 -> Laravel origin
 -> same FactoryFlow SQLite DB
```

Cloudflare Tunnel changes transport only. It does not create a separate B3 business environment, DB, or authorization path.

### 30.3 Proxy/URL handling

Laravel must be configured for trusted forwarded proxy headers so that HTTPS scheme/host are correctly recognized behind Cloudflare.

Do not hard-code LAN or public hostnames into B3 business or API logic.

Session cookies remain secure/HTTP-only and separate per hostname/domain as normal.

---

## 31. Security

- authenticated session required for all B3 execution APIs;
- active-user check enforced server-side;
- CSRF protection enabled for session-authenticated write requests;
- server derives actor username from authenticated session;
- login/session regeneration follows Laravel best practice;
- login should be rate-limited;
- browser-supplied inventory/progress/user values are not authoritative;
- Cloudflare access does not bypass Laravel authorization;
- SQLite file itself is never exposed by tunnel/web routes.

---

## 32. Logging

Server logs should include enough correlation context for technical investigation:

```text
request/correlation id
authenticated username
endpoint
KeHoach_ID
KeHoachHang_ID
group/detail ids when applicable
error_code
exception details server-side
timestamp
```

Do not log passwords.

Execution history remains the business audit source; application logs do not replace `LichSuLayCuon` or `LichSuCat`.

---

## 33. Query/Performance Principles

- avoid N+1 query loops for plan/worklist/progress;
- batch plan/item/group/detail/history data where practical and project into UI rows in PHP;
- use stored `ChieuDai1Cuon_KeHoach` snapshot rather than repeatedly resolving full standard length;
- do not add speculative indexes before measuring real query plans;
- run `EXPLAIN QUERY PLAN` on final worklist/inventory hot queries and add indexes only where justified.

---

## 34. Testing Strategy

### 34.1 Unit tests

Test pure business logic:

- structured/plain QR parsing;
- cut calculations;
- progress calculation;
- worklist row projection;
- action selection;
- group-selection candidate rules.

### 34.2 Repository/integration tests

Test against a controlled SQLite test DB using the real schema shape:

- actual full inventory queries;
- partial remaining length;
- reservations;
- FIFO source selection;
- group/detail/history lookups;
- idempotency marker lookup;
- transaction rollback.

### 34.3 Service/API tests

Required cases include:

- active/inactive login;
- unauthorized B3 endpoints;
- specific plan and all-active-worklist modes;
- structured full QR valid;
- structured QR already converted to partial;
- plain partial MaCuon valid;
- plain MaBin that is full -> reject;
- QR wrong product for selected plan -> reject;
- one QR matches multiple plans;
- one source has multiple eligible groups;
- one partial reel has multiple bound unfinished groups;
- whole take executes exactly one reel;
- whole requirement already completed -> reject;
- first full cut creates/binds/history atomically;
- subsequent partial cut updates state/history atomically;
- duplicate detail execution -> reject;
- insufficient partial length -> reject;
- stale group/detail/inventory after resolve -> reject;
- duplicate operation token -> no second physical execution;
- failure after first SQL write -> full rollback;
- item state transitions: Chưa thực hiện -> Đang thực hiện -> Hoàn thành;
- completed item summary behavior;
- last item completion removes plan from active worklist.

### 34.4 Concurrency tests

Test at minimum:

- two clients attempt same cut detail;
- two clients compete for last available full quantity;
- retry of already committed whole-take request;
- `SQLITE_BUSY` bounded retry/failure behavior;
- state changes between resolve and execute.

### 34.5 Manual UI/deployment tests

Test:

- real camera scan;
- image-file QR option absent in production UI;
- plan selector / “Tìm toàn bộ kế hoạch”;
- plan-scope selector on multi-plan match;
- group selector only when >1 group;
- detail selector and existing preview behavior;
- continuous scan after successful save;
- LAN HTTPS camera operation;
- Cloudflare Tunnel HTTPS customer-test path;
- login/session/CSRF behavior through both access paths.

---

## 35. Acceptance Invariants

The implementation is not ready if any of these can occur:

- wrong-plan QR executes work;
- plain full-reel MaBin is accepted as a full QR;
- structured QR already converted to partial is treated as full;
- one scan takes more than one whole reel;
- a cut detail receives more than one `LichSuCat`;
- a group switches physical reel after binding;
- full->partial leaves `TonCuonLe` without matching bind/history after failure;
- B3 incorrectly blocks execution of the current plan solely because generic available-after-reservation is zero;
- completed product work is accidentally executable again;
- fully completed plans remain in active worklist;
- JavaScript-supplied username becomes `NguoiThucHien`;
- a retry consumes an additional whole reel;
- HTTP/Tunnel path changes business behavior;
- mock data/random save behavior remains in the production test flow.

---

## 36. Implementation Boundary Summary

```text
Existing UI / reusable scanner
        |
        | raw QR + user selections
        v
Laravel Controllers
        |
        v
B3 Services
  - QR resolution
  - worklist/progress
  - plan/action/group/detail resolution
  - execution orchestration
        |
        v
Repositories / Query Builder
        |
        v
SQLite authoritative transaction
        |
        +--> LichSuLayCuon
        +--> LichSuCat
        +--> TonCuonLe
        +--> KeHoachCatNhom binding
```

The database state inside the write transaction is the final source of truth.

---

## 37. Final Design Decisions Carried Forward

The following are explicitly settled and must not be reopened during implementation without a newly discovered schema/requirement conflict:

- Laravel 12 + FactoryFlow SQLite;
- real login from existing `users` table;
- authenticated `username` is `NguoiThucHien`;
- B3 worklist is active work, not full history;
- incomplete plans show completed item summaries so operators know what was already done;
- full take rows: one remaining full reel = one row;
- partial rows: one physical LOT/MaCuon = one row;
- irrelevant table columns are blank;
- item state: Chưa thực hiện / Đang thực hiện / Hoàn thành;
- structured full QR format begins `cuontp;[MaBin];...`;
- structured raw QR becomes `TonCuonLe.MaCuon` when converted full->partial;
- exact `TonCuonLe.MaCuon` lookup precedes structured full resolution;
- plain `[MaBin]` is partial-only and must never fallback to full;
- whole take is quantity-managed and one scan = one reel;
- whole-take accounting uses FIFO across the product;
- first-cut source resolution stays within the scanned MaBin/source;
- group selection: 0 reject, 1 auto, >1 selector;
- detail selection can be any unfinished valid detail in the chosen group;
- group remains bound to the same physical reel after first successful cut;
- existing B3 operation UI/preview presentation is preserved;
- do not rename the existing first-cut preview label(s);
- production scanner is camera-only;
- persistent remember-me is out of scope;
- `KeHoach.TrangThai` remains lifecycle `ACTIVE/HUY`, not progress;
- progress is derived from execution history;
- LAN HTTPS and Cloudflare Tunnel HTTPS are both supported entry paths to the same backend/database;
- transaction re-read/atomicity and immutable histories are mandatory;
- mock data and mock execution are removed before real testing.

