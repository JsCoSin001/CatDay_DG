# B3 Laravel 12 + SQLite — Verification Report

Date: 2026-10-07

## Scope

Implementation of B3 against the approved design/spec using Laravel 12, the existing FactoryFlow SQLite schema, real `users` authentication, QR-based execution, worklist/progress projection, whole-reel FIFO accounting, full→partial/partial cutting, atomic SQLite write transactions, LAN HTTPS and Cloudflare Tunnel deployment support.

No production schema migration was added. Existing Laravel scaffold migrations were left unchanged from the supplied prototype and are **not required** for B3.

## Fresh verification results

### PASS — PHP syntax

Command: `php -l` across PHP files in `app`, `bootstrap`, `config`, `database`, `routes`, and `tests`.

Result: 64 PHP files checked; no syntax errors.

### PASS — JavaScript syntax

Command: `node --check` across B3 and reusable QR JavaScript.

Result: PASS.

### PASS — B3 plan-scope guard

Node regression test: `tests/JavaScript/B3StateScopeTest.cjs`.

Result: `B3_STATE_SCOPE_PASS`.

Behavior pinned:
- no selected plan + “Tìm toàn bộ kế hoạch” off → QR scan blocked;
- selected plan → QR scan allowed;
- “Tìm toàn bộ kế hoạch” on → QR scan allowed.

### PASS — Pure domain smoke

Verified without Laravel runtime:
- first-cut math;
- partial-cut math;
- item progress states;
- one FULL_TAKE row per remaining whole reel;
- structured full QR resolution;
- structured QR physical suffix required;
- plain MaBin resolving to full reel rejected;
- exact `TonCuonLe.MaCuon` takes precedence over structured full interpretation;
- HET partial cannot fall back to full;
- partial source must be imported (`NhapKho=1`) and non-temp (`Temp=0`).

Result: `PURE_SMOKE_PASS` and `PARTIAL_IMPORT_GUARD_PASS`.

### PASS — Mock removal / camera-only / UI-label preservation

Source scan confirms B3 production code no longer contains the prototype mock scenario/save/login markers (`B3_MOCK_SCENARIOS`, `simulateB3Save`, demo QR success value, fake local/session-storage login).

B3 scanner is configured with `allowImage:false`.

The existing first-cut preview label text `SỐ ĐẦU SAU CẮT` is preserved exactly as requested; only server-side calculation semantics were implemented.

### PASS — Supplied production schema compatibility

Read-only inspection was run against `QLSX_v02(5).db`.

Confirmed tables/columns used by B3 exist:
- `users`
- `KeHoach`
- `KeHoachHang`
- `TonCuonLe`
- `KeHoachCatNhom`
- `KeHoachCatChiTiet`
- `LichSuLayCuon`
- `LichSuCat`
- `TTThanhPham`
- `TTNhapKhoTP`
- `TTCuonDay`
- `DanhSachMaSP`

Confirmed relied-on constraints:
- `KeHoach.TrangThai` supports `ACTIVE/HUY`;
- `TonCuonLe.MaCuon` is UNIQUE;
- `LichSuCat.KeHoachCatChiTiet_ID` is UNIQUE;
- `LichSuCat.LoaiNguon` supports `CUON_CHAN/CUON_LE`.

Result: `SCHEMA_COMPATIBILITY_PASS`.

### PASS — SQL transaction simulation on a fresh copy of supplied DB

An isolated copy of the supplied SQLite file was used. No supplied DB was modified.

Scenario results:

```text
initial=2/2
whole take -> actual/reserved = 1/1
full→partial first cut -> actual/reserved = 0/0, partial 0..60
partial continuation -> partial 0..40
duplicate detail -> rejected by UNIQUE constraint
forced error after partial creation + group bind -> full transaction rollback
```

Result: `SQL_SIMULATION_PASS`, `atomic_rollback=PASS`.

### PASS — Query-plan review

`EXPLAIN QUERY PLAN` was run for the active-plan, eligible-full-source, and partial-reservation query shapes.

Observed:
- `KeHoachHang`, `LichSuLayCuon`, `KeHoachCatNhom`, `KeHoachCatChiTiet`, and `LichSuCat` paths use existing indexes/unique indexes;
- `TTCuonDay` eligible-source lookup currently scans `TTCuonDay` and sorts FIFO with a temporary B-tree.

No index/schema change was made because the approved rule is to avoid schema changes until real workload evidence justifies them.

## NOT TESTED in this container

### Laravel/PHPUnit runtime — NOT TESTED

`php artisan test` was attempted and exited before Laravel bootstrap because the supplied ZIP has no `vendor/` directory:

```text
Failed opening required '/mnt/data/b3_impl/vendor/autoload.php'
```

The container PHP runtime also has no `pdo_sqlite` / `sqlite3` extension.

Therefore the Laravel feature/unit suite is included in the package but must be run on the target machine after `composer install` and enabling SQLite PDO support.

### Browser/device scenarios — NOT TESTED

Not executable inside this container:
- real phone/browser camera permission and scan;
- trusted LAN HTTPS certificate on customer devices;
- live Cloudflare Tunnel path;
- real multi-device concurrent browser writes;
- real customer `users.password_hash` authentication against production records.

These are not reported as PASS.

## Final self-review findings addressed

The implementation was self-reviewed because this environment has no independent subagent/code-review worker. The following important findings were fixed before packaging:

1. QR scanning was possible without explicitly selecting one plan or enabling “Tìm toàn bộ kế hoạch”. Added a scope guard and RED→GREEN Node regression test.
2. ACTIVE `TonCuonLe` could be resolved even if its `TTThanhPham` was not imported or still temporary. Added imported/non-temp eligibility guard and RED→GREEN regression smoke.
3. Structured QR that already identifies a HET partial reel is rejected and never falls back to full-reel interpretation.
4. First-cut stale requests cannot silently reinterpret a reel that became partial after scan.
5. Multiple plans/actions/groups auto-select only when exactly one option exists; otherwise the user must choose.
6. Direct worklist/scan of a `HUY` plan returns `PLAN_NOT_ACTIVE`.
7. When the last item completes, the completed plan is removed from the active selection/worklist.
8. Cloudflare Tunnel deployment docs now include `originServerName` guidance for an HTTPS origin whose certificate hostname differs from localhost/127.0.0.1.

## Deferred minor / deployment note

The supplied UI prototype already loads Bootstrap CSS from jsDelivr CDN, and this implementation preserves that existing dependency. The QR scanner libraries themselves remain local. A LAN that has no Internet access may therefore lose Bootstrap styling even though B3 backend/QR assets are local. Localizing Bootstrap was not part of the approved final B3 spec and was not changed here.

## Target-machine verification checklist

Before customer testing:

1. Install PHP SQLite support (`pdo_sqlite` / `sqlite3`) for the PHP runtime used by Laravel.
2. Run `composer install`.
3. Configure `.env` from `.env.example`; point `DB_DATABASE` to the existing FactoryFlow `QLSX_v02.db`.
4. Do **not** run Laravel scaffold migrations against the production FactoryFlow DB for B3.
5. Run `php artisan key:generate` if the target `.env` has no `APP_KEY`.
6. Run `php artisan test` and require a green suite before production use.
7. Serve LAN access through browser-trusted HTTPS.
8. For Cloudflare Tunnel, route the public HTTPS hostname to the same Laravel origin; keep origin TLS verification enabled and set `originServerName` / `caPool` when needed.
9. Test: specific-plan scan, all-plan scan, whole take, multiple-group selection, full→partial, partial continuation, continuous scan, stale/double-submit, logout/login, and plan completion removal.

## Package safety

The delivered packages intentionally exclude:
- `.env`;
- supplied/production SQLite DB files;
- credentials;
- `vendor/`;
- `node_modules/`;
- generated logs/cache/compiled views;
- font files.
