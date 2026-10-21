# B3 Continuous Cutting Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline. The user explicitly requires direct implementation without another approval gate. Preserve the existing shared checkout and prior edits.

**Goal:** Scan and confirm one reel once, then save separate cuts without leaving the page, re-confirming or reopening the camera.

**Architecture:** Keep the existing QR resolver, calculator, history tables and SQLite BEGIN IMMEDIATE transaction. Add a focused CutSessionService for trusted continuation state, source fingerprints and read-only transaction recovery. Frontend retains one group-bound session and blocks further writes whenever the previous operation or refreshed state is uncertain.

**Tech Stack:** Laravel/PHP, SQLite, plain JavaScript/CSS, PHPUnit and Chromium tests.

**Spec:** C:/Users/NK-Group/.codex/attachments/963bb3e9-4ba2-4d6d-a76d-c1a7624bae91/Pasted text.txt

## Global Constraints

- No schema migration, new physical QR, automatic plan/group switch or changes to whole-reel take behavior.
- Each cut uses a distinct operation_token; an uncertain operation retains its original token and exact payload.
- Database markers, stock and history are authoritative. Validate an opaque source_version before cutting inside the transaction.
- New frontend sends source_version; old cut clients remain compatible when it is omitted.
- Reuse partialCut/firstCut; preview label becomes SỐ CUỐI SAU CẮT because the computed marker is SoCuoiSau.
- Production database must not be changed by verification; tests use :memory: or a dedicated temporary test database.

## Review Focus

1. A response is lost after commit: recover by the existing token without inserting another history.
2. Recovery observes NOT_FOUND while the original request is still pending: retry only the original token and payload.
3. Another device edits markers or cuts after the scan: reject the stale fingerprint before any mutation.
4. Group complete with stock left: close the session and preserve ACTIVE physical remainder; never choose another group.
5. Session refresh or authorization fails: block further cuts and never reapply the last successful operation.

## Task 1 — Backend continuation, concurrency and recovery

Files: new CutSessionService, CutSessionRequest and ContinuousCutSessionTest; modify ScanContextService, QrResolver, ExecutionService, ExecutionRepository, ExecutionController, CutReelRequest and routes/web.php.

- [x] Write failing real-database API tests for forward/reverse sequences, full-to-partial conversion, stale snapshots, duplicate tokens, recovery, fixed group, exhausted reels and ownership.
- [x] Implement source_version, additive cut_session response and GET /api/b3/cut-session with exact history ownership/context checks.
- [x] Run new tests and existing relevant PHP suites; compare all PHP failures with the recorded 26-test baseline.

## Task 2 — Frontend retained session and safe recovery

Files: b3-state.js, b3-api.js, cat-day-ui.js, welcome.blade.php and cat-day-ui.css; JavaScript and Chromium tests.

- [x] Write failing browser tests proving one scan/confirmation, three saves, no camera, current markers and distinct tokens.
- [x] Retain one cutSession across saves; apply trusted cut_session response, lock the group and update current/preview markers.
- [x] Provide LƯU LẦN CẮT TIẾP, KẾT THÚC CUỘN and a read-only recovery control; disable unrelated controls while saving/uncertain.
- [x] Recovery SAVED advances once; NOT_FOUND retries the original operation, never a new token. Confirmed rejection can refresh safely.
- [x] Preserve whole-reel save/continuous scanning and reset all cut state on end/logout.

## Task 3 — Verification and handoff

- [x] Run targeted PHP, all JavaScript/Chromium tests, syntax checks and git diff --check.
- [x] Run the complete PHP suite and report every remaining baseline failure by name.
- [x] Exercise a real frontend/backend HTTP flow on a dedicated temporary SQLite database for 500..1000, cuts 100/150/50.
- [x] Save verification report with file list, API fields, recovery/concurrency behavior and deployment notes. No production DB writes or schema changes.

## Execution record

- Root cause verified: saveAction always closes the page; closeResultPage clears scan/context/confirmation. Existing backend returns worklist/plan state but no continuation state and has no source revision check or operation recovery read.
- Ruling: use an HMAC fingerprint of current source state and latest cut history as optimistic concurrency control, with SQLite BEGIN IMMEDIATE serialization; no schema needed.
- Ruling: keep legacy cut API calls compatible, enforce fingerprints on the new frontend workflow, and keep whole take unchanged.

- Completed: backend14 new tests; related87 PHP/680 assertions; all100 JS including real HTTP lost-response recovery; full PHP146 passed/26 exact baseline failures. Reviewer P1 context-switch escape fixed RED→GREEN and confirmed resolved. No production DB writes or schema changes.
