# Implementation Plan

## Overview

Bug condition methodology. Tasks are ordered exploration-first: a bug-condition
property test that FAILS on the current unfixed code, preservation tests that
PASS on the unfixed code, then the minimal backward-compatible fix, then
fix-checking validation.

**Test runners are not yet present in the repo.** Backend needs `pytest` +
`hypothesis` (venv at `backend/.venv`); frontend needs `vitest` + `fast-check`
(`frontend/`). Optional test sub-tasks are marked with `*`. If a runner cannot
be installed in the environment, state that and verify the pure helpers manually.

## Tasks

- [ ] 1. Write bug condition exploration test (transit polyline straight-line bug)
  - **Property 1: Bug Condition** - 대중교통 구간이 정류장 직선으로만 그려지고 개략성 표시가 없다
  - **CRITICAL**: This test MUST FAIL on the current unfixed code once it encodes the *expected* behavior — the failure confirms the bug exists. **DO NOT fix the test or the code when it fails.**
  - **NOTE**: This test encodes the expected behavior from Correctness Property 1; it will validate the fix when it passes after implementation (re-run in task 5.1).
  - **GOAL**: Surface counterexamples proving the straight-line bug: for a transit subPath the produced `polyline` point-count == stop-count and there is no `approx` flag / `stationCoords` / approx notice.
  - Add `pytest` + `hypothesis` to `backend/.venv` (requirements + dev), create `backend/app/services/tests/` (or repo test dir) with a fixture ODsay path response containing transit subPaths (bus 2-stop, subway) plus `path.info.mapObj`.
  - Monkeypatch `_odsay` to return the fixture; call `_leg()` / `route()` and observe the transit segment(s).
  - **Scoped PBT approach**: for deterministic fixtures, scope hypothesis to the concrete failing cases (bus 2-stop with any stop coords, subway N-stop). Property assertion (expected behavior): for every transit segment either `len(polyline) >= number_of_stops AND approx == false`, OR `approx == true AND stationCoords non-empty AND approx notice present`.
  - Run on UNFIXED code.
  - **EXPECTED OUTCOME**: Test FAILS (polyline has exactly stop-count points, no `approx`/`stationCoords`, no notice — bug confirmed).
  - Document counterexamples (e.g., "bus 2-stop → polyline == 2 points straight line, approx field absent, no notice in guides/reasons").
  - Mark complete when the test is written, run, and the failure is documented.
  - _Requirements: 1.1, 1.2, 1.3_
  - _Correctness Property: Property 1 (Bug Condition)_

- [ ] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - 대중교통 없는 경로의 기존 동작 유지 (F(X) == F'(X))
  - **IMPORTANT**: Follow observation-first methodology — record real outputs of the UNFIXED code, then assert them.
  - Observe on UNFIXED code and capture outputs for non-bug-condition inputs (isBugCondition = false):
    - 도보 전용 경로 (`mode="walk"`) — polyline / guides / distance / difficulty / reasons (Req 3.1)
    - 700m 이하 walk-only 처리 leg (Req 3.2)
    - `ODSAY_API_KEY` 미설정 / 경로 탐색 실패 → 도보 폴백 leg (Req 3.3)
  - Write property-based tests (hypothesis) generating walk-only / walk-fallback route inputs and asserting `F(X) == F'(X)` for polyline, guides, total duration, total walk distance, difficulty (worst-element), reasons.
  - Capture a snapshot/baseline of the original `_leg()` output for these inputs so it can be compared after the fix.
  - Run on UNFIXED code.
  - **EXPECTED OUTCOME**: Tests PASS (baseline behavior to preserve).
  - Mark complete when tests are written, run, and passing on unfixed code.
  - _Requirements: 3.1, 3.2, 3.3, 3.5_
  - _Correctness Property: Property 2 (Preservation)_

- [ ] 3. Implement the fix — real road geometry with explicit approximate fallback

  - [ ] 3.1 Add pure helper `_graphpos_to_polyline(graph_pos)` in `transit.py`
    - Map `[{x, y}, ...]` → `[[float(y), float(x)], ...]` (`{x:lng, y:lat}` → `[lat, lng]`).
    - Skip points where `x`/`y` is missing or non-numeric; preserve input order.
    - Return `[]` (fallback signal) when fewer than 2 valid points result.
    - Keep it a standalone pure function so it is a clean PBT target.
    - _Bug_Condition: isBugCondition(input) — transit subPath present_
    - _Expected_Behavior: expectedBehavior(result) — graphPos → [lat,lng], order-preserving, skip bad points, <2 → []_
    - _Requirements: 2.1, 2.5_
    - _Correctness Property: Property 3_

  - [ ]* 3.2 Property test for `_graphpos_to_polyline`
    - **Property 3: graphPos → polyline 변환 정확성**
    - hypothesis: random `{x,y}` lists (some with missing/non-numeric fields) → assert `[y,x]` mapping, bad-point skip, order preservation, <2 valid → `[]`.
    - _Requirements: 2.1, 2.5_
    - _Correctness Property: Property 3_

  - [ ] 3.3 Add `_load_lane(map_obj)` in `transit.py`
    - URL `https://api.odsay.com/v1/api/loadLane`; params `mapObject = f"0:0@{map_obj}"`, `apiKey = ODSAY_API_KEY`.
    - Send `Referer: ODSAY_REFERER` header when set (same as `_odsay()`).
    - `httpx` client with `timeout=6.0` (within the ~10s overall budget).
    - Parse `result.lane[].section[].graphPos` → for each section produce a `[[lat,lng],...]` list via `_graphpos_to_polyline`; drop sections with <2 valid points; return the **list of section point-lists**, or `None` if empty.
    - Wrap all logic in try/except and return `None` on any exception/timeout (never raise).
    - Module-level cache `_lane_cache: dict[str, list | None]` keyed by `map_obj`; no re-call on cache hit.
    - _Bug_Condition: isBugCondition(input) — transit subPath present_
    - _Expected_Behavior: expectedBehavior(result) — loadLane section geometry fetched, exception-safe, cached_
    - _Requirements: 2.1, 2.4, 3.6_
    - _Correctness Property: Property 1_

  - [ ]* 3.4 Unit tests for `_load_lane`
    - Assert `mapObject` assembled as `0:0@{mapObj}`, `Referer` header sent when configured.
    - Exception/timeout → returns `None`.
    - Cache hit → no re-call (monkeypatch httpx and assert call count == 1 for repeated `map_obj`).
    - _Requirements: 2.4, 3.6_

  - [ ] 3.5 Add section ↔ transit-subPath association logic in `transit.py`
    - Flatten `_load_lane` section point-lists in order; consume them 1:1 against transit subPaths (trafficType ∈ {1,2}) in traversal order (order-based association).
    - Reinforce with endpoint matching: compare each section's first/last point against subPath `startX/startY`·`endX/endY`; if close (tens of meters) confirm match, if far, fall back for that segment only.
    - If section count ≠ transit subPath count, unmatched segments fall back individually (`approx=true`).
    - _Bug_Condition: isBugCondition(input) — transit subPath present_
    - _Expected_Behavior: expectedBehavior(result) — order-based + endpoint-matching + per-segment fallback_
    - _Requirements: 2.1, 2.2_
    - _Correctness Property: Property 1_

  - [ ]* 3.6 Unit tests for section↔subPath association
    - Order-based mapping happy path; count mismatch → unmatched segment falls back; endpoint-proximity match/mismatch behavior.
    - _Requirements: 2.1, 2.2_

  - [ ] 3.7 Modify `_leg()` transit branch (`t in (1, 2)`) and add approx notice constant
    - Compute stop-coord polyline `pl` and `stations` as before.
    - Read `path.info.mapObj`; via `_load_lane` + association, look up this segment's section geometry `lane_pl`.
    - If `lane_pl` has ≥2 points: `seg["polyline"] = lane_pl`, `seg["approx"] = False`, `seg["stationCoords"] = []`; `polyline.extend(lane_pl)`.
    - Else (fallback): `seg["polyline"] = pl`, `seg["approx"] = True`, `seg["stationCoords"] = pl`; append approx guide to `seg`'s `guides`; `polyline.extend(pl)`.
    - Add `NOTE_APPROX = "그려진 선은 정류장 간 개략 직선이며 실제 도로 형상과 다를 수 있습니다"`; when a leg contains any approx segment add `NOTE_APPROX` to `reasons` once (dedupe).
    - Missing `mapObj` or `_load_lane is None` → all transit segments fall back.
    - Do NOT change mode/name/distance/duration/stations/color/lowFloor/lowFloorNote computation.
    - _Bug_Condition: isBugCondition(input) — transit subPath present_
    - _Expected_Behavior: expectedBehavior(result) — graphPos polyline + approx=false when available, else stop-to-stop + approx=true + stationCoords + notice_
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
    - _Correctness Property: Property 1_

  - [ ] 3.8 Add additive optional fields to `TransitSegment` in `schemas.py`
    - `approx: bool = False`
    - `stationCoords: list[list[float]] = []`
    - Do NOT modify any existing field (mode/name/polyline/distance/duration/stations/color/lowFloor/lowFloorNote).
    - _Bug_Condition: schema output for transit/walk segment_
    - _Expected_Behavior: expectedBehavior(result) — existing fields unchanged, additive defaults false/[]_
    - _Requirements: 2.5, 3.4_
    - _Correctness Property: Property 4_

  - [ ]* 3.9 Schema compatibility property test
    - **Property 4: additive 스키마 하위 호환**
    - hypothesis: random segment dicts → `TransitSegment` validation preserves existing fields/types; `approx` defaults False, `stationCoords` defaults `[]`.
    - _Requirements: 2.5, 3.4_
    - _Correctness Property: Property 4_

  - [ ] 3.10 MapView.jsx — distinct style for approx segments + stop markers
    - In the route polyline render loop, if a transit `seg.approx` is true, draw with a visually distinct style (dashed / lower opacity / thinner weight) instead of a solid line; non-approx keeps the existing line-color solid.
    - When `seg.approx` and `seg.stationCoords` present, draw a small stop marker at each coord; add markers to the `route` overlay group so existing clear logic cleans them up.
    - Keep `renderablePolylineCount` (mapdraw.js) semantics unchanged (markers are not polylines).
    - _Bug_Condition: transit segment rendered as straight line without indication_
    - _Expected_Behavior: expectedBehavior(result) — approx segments visually distinct + stop markers_
    - _Requirements: 2.2, 2.3_
    - _Correctness Property: Property 1_

  - [ ] 3.11 RouteSteps.jsx — approx notice for transit segments
    - In `TransitSegment`, when `seg.approx` is true, add a small notice: "정류장 간 개략 직선 — 실제 도로와 다를 수 있음".
    - Do NOT change existing display (노선명 / 승하차역 / 정거장 수 / 저상 라벨).
    - _Bug_Condition: no user indication that line is approximate_
    - _Expected_Behavior: expectedBehavior(result) — approx notice shown_
    - _Requirements: 2.3_
    - _Correctness Property: Property 1_

  - [ ]* 3.12 Frontend test setup + mapdraw property test
    - Add `vitest` + `fast-check` to `frontend/` devDependencies.
    - fast-check: random routes → assert `renderablePolylineCount` equals the count of polylines (≥2 points), independent of `approx`.
    - _Requirements: 2.2, 2.5_

- [ ] 4. Fix checking — validate expected behavior on bug-condition inputs
  - **Property 1: Expected Behavior** - 대중교통 구간이 실제 형상 또는 명시적 개략 폴백으로 그려진다
  - **IMPORTANT**: Re-run the SAME test from task 1 — do NOT write a new test here. The task 1 test encodes the expected behavior.
  - Add fix-checking property tests (hypothesis) generating transit subPath configs with loadLane geometry present/absent:
    - loadLane available → `len(polyline) >= number_of_stops` following graphPos geometry AND `approx == false`.
    - loadLane unavailable → `approx == true` AND `stationCoords` non-empty AND approx notice present in guides/reasons.
    - `no_exception(result)` in all cases.
  - Integration tests: monkeypatch `_odsay` + `_load_lane` for (a) geometry-available flow and (b) `_load_lane` returns `None` fallback flow; assert `route()` returns normally.
  - **EXPECTED OUTCOME**: Task 1 exploration test now PASSES; fix-checking tests PASS.
  - _Requirements: 2.1, 2.2, 2.3, 2.4_
  - _Correctness Property: Property 1, Property 3_

- [ ] 5. Verification checkpoint

  - [ ] 5.1 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - 대중교통 구간이 실제 형상 또는 개략 폴백으로 그려진다
    - **IMPORTANT**: Re-run the SAME test from task 1 — do NOT write a new test.
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed).
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
    - _Correctness Property: Property 1_

  - [ ] 5.2 Verify preservation tests still pass
    - **Property 2: Preservation** - 대중교통 없는 경로의 기존 동작 유지
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests.
    - **EXPECTED OUTCOME**: Tests PASS (no regressions in walk-only / walk-fallback behavior; `F(X) == F'(X)`).
    - _Requirements: 3.1, 3.2, 3.3, 3.5_
    - _Correctness Property: Property 2_

  - [ ] 5.3 Budget / performance check
    - `_load_lane` uses 6.0s timeout and leg-cache dedupes repeated `map_obj`; overall response within ~10s budget; low-floor bus enrich budget guard preserved.
    - _Requirements: 3.6_

  - [ ] 5.4 Ensure all tests pass
    - Run full backend (pytest) and frontend (vitest) suites; ask the user if questions arise.

## Task Dependency Graph

```json
{
  "waves": [
    {
      "wave": 1,
      "description": "Exploration and preservation baseline on UNFIXED code",
      "tasks": ["1", "2"]
    },
    {
      "wave": 2,
      "description": "Pure helper and schema (no upstream code deps)",
      "tasks": ["3.1", "3.8"]
    },
    {
      "wave": 3,
      "description": "loadLane fetch + optional pure/schema tests",
      "tasks": ["3.3", "3.2", "3.9"]
    },
    {
      "wave": 4,
      "description": "Section-subPath association + optional loadLane tests",
      "tasks": ["3.5", "3.4"]
    },
    {
      "wave": 5,
      "description": "_leg() transit branch modification + optional association tests",
      "tasks": ["3.7", "3.6"]
    },
    {
      "wave": 6,
      "description": "Frontend rendering + notice + optional frontend test setup",
      "tasks": ["3.10", "3.11", "3.12"]
    },
    {
      "wave": 7,
      "description": "Fix checking (re-run task 1 + property/integration)",
      "tasks": ["4"]
    },
    {
      "wave": 8,
      "description": "Verification checkpoint",
      "tasks": ["5.1", "5.2", "5.3", "5.4"]
    }
  ]
}
```

## Notes

- Tasks marked `*` are optional test sub-tasks.
- Backend property-based tests use `hypothesis`; frontend uses `fast-check`. Both
  runners must be added — they are not currently present in the repo.
- The fix is intentionally minimal and backward-compatible: `schemas.py` changes
  are additive/optional only, and behavior for non-transit routes (isBugCondition
  = false) must remain byte-for-byte identical (`F(X) == F'(X)`).
- `_load_lane` is exception-safe (returns `None`) and cached by `mapObj` so route
  responses never break and stay within the ~10s budget.
- Requirement references map to `bugfix.md`: 1.x current defect, 2.x expected
  behavior, 3.x regression prevention. Correctness Property references map to the
  four properties in `design.md`.
