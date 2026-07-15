# Implementation Plan: chat-departure-recognition

## Overview

Frontend-only implementation (React + Vite in `frontend/`). All changes are additive and backward-compatible. Work proceeds bottom-up: first the pure recognition/normalization functions and the expanded departure registry in `departures.js`/`App.jsx` (with property-based tests), then the `DepartureSelector` "더 보기/접기" toggle, then the `handleSend` wiring in `App.jsx`, and finally example/integration tests.

The design includes a Correctness Properties section (Properties 1–8), so property-based test sub-tasks are included using **fast-check** with the **Vitest** runner. Neither is installed yet, so test tooling setup is an optional first task.

## Tasks

- [ ] 1. Set up frontend test tooling (Vitest + fast-check)
  - [ ]* 1.1 Install and configure the test runner
    - Add `vitest`, `fast-check`, `@testing-library/react`, `@testing-library/jest-dom`, and `jsdom` as devDependencies in `frontend/package.json`
    - Add a `"test": "vitest --run"` script (single-run, not watch)
    - Configure `test` block in `frontend/vite.config.js` with `environment: 'jsdom'` and `globals: true`
    - Set fast-check `numRuns` to at least 100 for property tests
    - _Requirements: (testing infrastructure for all property/example/integration tasks)_

- [ ] 2. Add `normalizeDeparture` pure function to `departures.js`
  - [ ] 2.1 Implement `normalizeDeparture(text)` in `frontend/src/departures.js`
    - Trim surrounding whitespace and collapse internal runs of whitespace to a single space
    - Strip trailing particles / departure-intent expressions: `에서`, `에`, `서`, `부터`, `출발`, `시작`, `갈게`, `갈래`, `할게`, `요`
    - Apply suffix-equivalence by removing a trailing `역`, `터미널`, or `시청` suffix for the normalized key (so `시청` ≡ `시청역`); do not mutate original display names
    - Lowercase only latin characters; leave Hangul unchanged
    - Be defensive on empty/whitespace/`null`/non-string input (return `''`)
    - _Requirements: 3.4_

  - [ ]* 2.2 Write property test for `normalizeDeparture`
    - **Property 3: 정규화 접미사 동등성 및 멱등성**
    - **Validates: Requirements 3.4**
    - Assert `normalizeDeparture(s + suffix) === normalizeDeparture(s)` for `suffix ∈ {역, 터미널, 시청}` and `normalizeDeparture(normalizeDeparture(t)) === normalizeDeparture(t)` (idempotence), including whitespace-padded variants

- [ ] 3. Expand the Departure Registry in `App.jsx`
  - [ ] 3.1 Extend each Region's `departures` array in `frontend/src/App.jsx` REGIONS
    - Expand from 2 to N (≥2) real stations/terminals/landmarks per Region using the planned list in the design
    - Keep `departures[0]` as the representative hub so the existing `origin` getter is unchanged (Req 1.6)
    - Ensure every coordinate falls inside its Region bbox (Req 1.3); reuse the existing verified coordinates for the original 2 points
    - Ensure every subway-served Region (서울·부산·대구·인천·수원) includes ≥1 `type: '지하철역'` Departure_Point (Req 1.4)
    - Add optional `aliases: string[]` to departures where a chat alias is planned (e.g. `광화문`, `시청`/`서울시청`); leave `aliases` absent where none is needed (backward compatible)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6_

  - [ ]* 3.2 Write property test for registry validity and minimum-2 invariant
    - **Property 1: 출발지 레지스트리 유효성 및 최소 2개 불변식**
    - **Validates: Requirements 1.1, 1.2, 1.3**
    - Iterate real `REGIONS`; assert `validDepartures(region).length >= 2` and `validateDeparture(dep, region).valid === true` for every defined departure

  - [ ]* 3.3 Write property test for invalid-departure exclusion
    - **Property 2: 유효하지 않은 출발지는 선택 목록에서 제외**
    - **Validates: Requirements 1.5**
    - Generate Regions mixing valid and invalid departure definitions (empty name, out-of-range/non-numeric lat/lng, coords outside bbox); assert `validDepartures` returns exactly the valid subset

  - [ ]* 3.4 Write example test for subway-region coverage
    - Assert each subway-served Region contains at least one `type: '지하철역'` Departure_Point
    - _Requirements: 1.4_

- [ ] 4. Add `recognizeDeparture` pure function to `departures.js`
  - [ ] 4.1 Implement `recognizeDeparture(text, region)` in `frontend/src/departures.js`
    - Operate over `validDepartures(region)`; treat missing/non-array `aliases` (or non-string items) as ignored
    - Compute matches via precedence: (1) exact normalized full-name, (2) exact normalized alias, (3) partial/substring; use the highest-precedence non-empty candidate set and de-duplicate by departure
    - Detect departure intent from tokens (`출발`, `에서`, `시작`, `부터`, etc.) into `intent: boolean`
    - Classify into `{ status, matches, intent }`: 1 candidate → `'single'`; ≥2 → `'multiple'`; 0 + intent → `'notfound'`; 0 + no intent → `'none'`
    - Return `{ status: 'none', matches: [], intent: false }` defensively when `text` is empty/whitespace/`null` or `region` is `null`
    - No side effects beyond the existing `validDepartures` `console.warn`
    - _Requirements: 3.1, 3.2, 3.3, 3.5, 4.1, 4.2, 4.3, 4.4_

  - [ ]* 4.2 Write property test for unambiguous single match
    - **Property 4: 모호하지 않은 이름/별칭은 단일 매칭**
    - **Validates: Requirements 3.2, 3.3, 3.5**
    - For a token uniquely mapping to departure `d` (precondition filter excluding aliases that collide within the Region), assert `status === 'single'` and `matches` equals `[d]`

  - [ ]* 4.3 Write property test for ambiguous multiple match
    - **Property 5: 모호한 입력은 다중 매칭으로 분류**
    - **Validates: Requirements 4.1**
    - For messages mapping to ≥2 distinct Departure_Points, assert `status === 'multiple'` with exactly those matched points and no single selection

  - [ ]* 4.4 Write property test for intent-based no-match classification
    - **Property 6: 출발 의도 유무에 따른 무매칭 분류**
    - **Validates: Requirements 4.2, 4.3, 4.4**
    - For tokens matching 0 departures: with an intent token → `status === 'notfound'`, `intent === true`, empty `matches`; without → `status === 'none'`, `intent === false`, empty `matches`

- [ ] 5. Extract testable origin-priority helper in `departures.js`
  - [ ] 5.1 Add a pure `resolveOrigin({ selectedDeparture, myLoc, region })` helper in `frontend/src/departures.js`
    - Implement the priority order: Selected_Departure → device location inside Region bbox → first `validDepartures(region)` → Region default `origin`
    - Keep `App.jsx` `getOrigin` behavior and the `origin` getter unchanged; have `getOrigin` delegate to (or stay equivalent to) this helper without altering its output
    - _Requirements: 1.6, 6.4, 6.5_

  - [ ]* 5.2 Write property test for departure-options composition
    - **Property 7: 출발지 옵션 구성**
    - **Validates: Requirements 2.1, 2.5**
    - For random `myLoc` (inside and outside bbox), assert `departureOptions(region, myLoc)` contains every `validDepartures(region)` point plus exactly one `'내 위치'` option iff `isInsideBbox(myLoc, region)`

  - [ ]* 5.3 Write property test for Origin_Resolver priority
    - **Property 8: Origin_Resolver 우선순위**
    - **Validates: Requirements 1.6, 6.4, 6.5**
    - For random combinations of `selectedDeparture`/`myLoc`/`validDepartures`, assert the resolved origin follows the documented priority order

- [ ] 6. Checkpoint - core pure logic and registry
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Add "더 보기/접기" toggle to `DepartureSelector.jsx`
  - [ ] 7.1 Implement the display-threshold toggle in `frontend/src/DepartureSelector.jsx`
    - Introduce `DISPLAY_THRESHOLD = 3`
    - When `departureOptions(region, myLoc)` returns more than the threshold, render the first `DISPLAY_THRESHOLD` options and a "더 보기(N)" control that expands the rest; show "접기" when expanded
    - Manage expand state with `useState(false)` and reset to collapsed on Region change via `useEffect([region.id])`
    - Display each option's name and departure type; keep props (`region`, `selected`, `myLoc`, `onSelect`) unchanged
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [ ]* 7.2 Write component tests for `DepartureSelector`
    - Assert name + type render, threshold-exceeding toggle expand/collapse, collapse reset on region change, and `onSelect` fired on click
    - _Requirements: 2.2, 2.3, 2.4, 2.6_

- [ ] 8. Wire departure recognition into `App.jsx` `handleSend`
  - [ ] 8.1 Insert the recognition branch in `handleSend` after region detect + switch
    - After `detectRegion`/`switchRegion` (preserving Req 3.7 order: switch first, then recognize against the resulting `active` region), call `recognizeDeparture(text, active)`
    - `single` → `setSelectedDeparture(matches[0])`, append confirm message `출발지를 '<name>'(으)로 설정했어요`, and `return`
    - `multiple` → append clarify message listing matched names requesting one choice, and `return`
    - `notfound` → append message listing available `validDepartures(active)` names (fallback text when empty), and `return`
    - `none` → fall through to existing chat/course handling without changing `selectedDeparture`
    - Do not add new recalculation logic; reuse the existing `useEffect([selectedDeparture])` for route recalc (Req 5.3–5.6)
    - Keep the existing button-selection flow and `getOrigin` priority intact (Req 6.1–6.5)
    - _Requirements: 3.1, 3.5, 3.6, 3.7, 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 6.1, 6.2, 6.3_

- [ ] 9. Verify state synchronization and route-recalc integration
  - [ ]* 9.1 Write example tests for recognition messaging and region-switch order
    - Confirm message matches the exact template `출발지를 '<name>'(으)로 설정했어요` (Req 3.6)
    - Region + that region's departure in one message → switch then recognize in the detected region (Req 3.7)
    - Other-region-only departure named → active-region-unavailable guidance message (Req 4.4)
    - _Requirements: 3.6, 3.7, 4.4_

  - [ ]* 9.2 Write integration tests for selection convergence and route recalculation
    - Chat path and button path converge on the same `selectedDeparture` with last-write-wins (Req 5.1, 5.2, 6.1–6.3)
    - With `postRoute` mocked, verify course-present success (recalc + summary message), failure (failure message + previous route retained), and course-absent (no recalc, departure retained)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.3_

- [ ] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional (test tooling setup and all test sub-tasks) and can be skipped for a faster MVP.
- Each task references specific requirement sub-clauses (1.x–6.x) for traceability.
- Property test sub-tasks each reference exactly one design property (Property 1–8) and the requirements it validates.
- All registry and function changes are additive and backward-compatible: `aliases` is optional, `validateDeparture` ignores it, and `getOrigin`/`origin` behavior is unchanged.
- Route recalculation reuses the existing `useEffect([selectedDeparture])`; no new recalc code is written.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "3.1", "5.1", "7.1"] },
    { "id": 2, "tasks": ["2.2", "3.2", "3.3", "3.4", "5.2", "5.3", "7.2"] },
    { "id": 3, "tasks": ["4.1"] },
    { "id": 4, "tasks": ["4.2", "4.3", "4.4"] },
    { "id": 5, "tasks": ["8.1"] },
    { "id": 6, "tasks": ["9.1", "9.2"] }
  ]
}
```
