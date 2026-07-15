# transit-polyline-real-path Bugfix Design

## Overview

편해질지도(barrier-free-travel)에서 대중교통(버스/지하철) 경로를 지도에 그릴 때, 노선이 실제 도로 형상을 따르지 않고 정류장 좌표끼리 직선으로만 이어져 건물을 가로지르는 것처럼 보인다. 원인은 `backend/app/services/transit.py`의 `_leg()`가 대중교통 구간(subPath `trafficType` 1/2)의 `polyline`을 오직 `passStopList.stations` 좌표로만 구성하기 때문이다.

수정 전략은 두 단계다.

1. **실제 도로 형상 우선**: ODsay `searchPubTransPathT` 응답의 `path.info.mapObj`(예: `"1050:1:55:63"`)로 `loadLane` API를 호출해 노선의 실제 도로 형상 좌표(`result.lane[].section[].graphPos`)를 얻는다. 확보되면 각 대중교통 구간의 `polyline`을 이 형상 좌표(`[lat, lng]`)로 교체한다.
2. **명시적 폴백**: 키 없음 / 호출 실패 / 타임아웃 / `graphPos` 비어 있음이면 기존 정류장-정류장 직선 폴리라인을 그대로 유지하되, 스키마에 additive/optional 필드(`approx=true`, `stationCoords`)를 붙이고 사용자에게 "정류장 간 개략 직선"임을 안내한다.

스키마는 기존 필드를 절대 변경하지 않고 optional/additive 필드만 추가해 하위 호환을 유지한다. `loadLane` 실패는 예외 없이 흡수하고 전체 응답 ~10초 예산 안에서 동작해야 한다.

## Glossary

- **Bug_Condition (C)**: 경로 응답에 대중교통 구간(subPath `trafficType` ∈ {1,2})이 하나 이상 존재하는 입력. 현재 코드는 이 경우 무조건 정류장 좌표 직선으로만 그리고 개략 직선임을 알리는 표시를 하지 않는다.
- **Property (P)**: 버그 입력에 대한 올바른 동작 — 대중교통 구간의 `polyline`이 (a) `loadLane` 형상이 있으면 실제 도로 형상 좌표로 구성되고 `approx=false`, (b) 없으면 정류장 직선 + `approx=true` + `stationCoords` + 사용자 안내를 갖는다.
- **Preservation**: 대중교통 구간이 없는 입력(도보 전용, walk-only, 도보 폴백)에 대해 `F(X) = F'(X)` — 기존 도보 폴리라인·안내·거리·난이도 계산이 그대로 유지된다.
- **F / F'**: 각각 수정 전 / 수정 후 `transit.py` 대중교통 구간 폴리라인 생성 로직.
- **`_leg(start, end)`**: `transit.py`의 함수. ODsay 경로를 받아 도보/대중교통 segment 목록과 leg-level 폴리라인·난이도·안내를 구성한다.
- **`_load_lane(map_obj)`**: (신규) ODsay `loadLane` API를 호출해 노선 실제 형상 좌표를 반환하는 함수.
- **mapObj**: ODsay 경로 응답 `path.info.mapObj` 문자열(예: `"1050:1:55:63"`). 전체 대중교통 경로의 형상을 식별하는 토큰.
- **graphPos**: `loadLane` 응답의 `result.lane[].section[].graphPos` — `{x: lng, y: lat}` 점 목록. 도로를 따르는 실제 형상 좌표.
- **transit subPath**: subPath 중 `trafficType`가 1(지하철) 또는 2(버스)인 항목. 도보 subPath는 `trafficType` 3.

## Bug Details

### Bug Condition

버그는 경로 응답에 대중교통 구간(subPath `trafficType` ∈ {1,2})이 하나 이상 존재할 때 항상 발생한다. 현재 `_leg()`는 해당 구간의 `polyline`을 `passStopList.stations`의 정류장 좌표만으로 구성해 정류장끼리 직선으로 잇고, 그것이 도로가 아닌 개략 직선임을 알리는 어떤 플래그·마커·안내도 제공하지 않는다. `loadLane`으로 이미 조회 가능한 실제 도로 형상 좌표를 사용하지 않는다.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type OdsayPathResponse
  OUTPUT: boolean

  // 대중교통 구간이 하나라도 있으면 현재 코드는 정류장 직선으로만 그린다
  RETURN EXISTS sp IN input.subPath WHERE sp.trafficType IN {1, 2}
END FUNCTION
```

### Examples

- **버스 2정류장, 굽은 도로**: 두 정류장을 잇는 도로가 곡선인데 현재 `polyline`은 `[[stop1_lat, stop1_lng], [stop2_lat, stop2_lng]]` 2점 직선이 되어 건물/도로를 무시한다. → 기대: `loadLane` graphPos로 곡선 도로 형상 좌표(수십~수백 점) 사용, `approx=false`.
- **지하철 3호선 구간**: 역 좌표만 직선으로 이어 실제 선로 곡선을 무시한다. → 기대: graphPos로 선로 형상 좌표 사용.
- **loadLane 미가용(키 없음/실패)**: 정류장 직선을 유지하되 `approx=true`, `stationCoords=[정류장 좌표들]`, "정류장 간 개략 직선" 안내 제공. → 기대: 사용자가 이 선이 개략선임을 인지.
- **도보 전용 경로(edge/비버그)**: 대중교통 구간이 없으므로 `isBugCondition=false`. → 기존 도보 폴리라인·안내가 그대로 유지되어야 한다.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- 대중교통 구간이 없는 도보 전용 경로의 폴리라인·안내·거리·난이도(Req 3.1).
- 두 경유지 직선거리 700m 이하 walk-only 처리(Req 3.2).
- `ODSAY_API_KEY` 미설정 또는 경로 탐색 실패 시 도보 폴백 — 앱을 죽이지 않음(Req 3.3).
- 대중교통 구간의 `mode`/`name`/`distance`/`duration`/`stations`/`color` 및 버스 저상(`lowFloor`/`lowFloorNote`) 산출 값과 안내문(Req 3.4).
- 전체 소요시간(Σsegment duration), 전체 도보(Σwalk segment distance), 난이도(worst-element), reasons 불변식(Req 3.5).
- 전체 응답 ~10초 예산 및 저상버스 실시간 enrich 예산 가드(Req 3.6).

**Scope:**
`isBugCondition`이 false인 모든 입력(대중교통 구간이 없는 경로)은 이 수정의 영향을 전혀 받지 않아야 한다. 포함:
- 도보 전용 leg (`mode="walk"`)
- walk-only(700m 이하) 처리 leg
- ODsay 폴백 도보 leg

대중교통 구간이 있는 leg에서도, 대중교통 segment의 `polyline`/`approx`/`stationCoords`를 제외한 나머지 필드(mode/name/distance/duration/stations/color/lowFloor 등)와 도보 segment는 기존과 동일하게 유지되어야 한다.

**Note:** 버그 입력에 대한 기대 올바른 동작은 아래 Correctness Properties(Property 1)에 정의한다. 이 절은 변경되면 안 되는 것에 집중한다.

## Hypothesized Root Cause

버그 설명과 코드 분석에 근거한 원인:

1. **형상 소스 부재**: `_leg()`가 대중교통 구간 폴리라인을 `passStopList.stations` 좌표로만 만든다. 실제 도로 형상을 담은 `loadLane` 호출 경로 자체가 코드에 없다.
   - `pl = [[float(s["y"]), float(s["x"])] for s in stations ...]` — 정류장 개수만큼의 점만 생성.
2. **mapObj 미사용**: 경로 응답 `path.info.mapObj`를 읽지 않아, `loadLane`으로 실제 형상을 조회할 수 있는데도 사용하지 않는다.
3. **개략성 미표기**: 직선 폴리라인이 개략선임을 나타내는 플래그/마커/안내가 없어, 폴백 상황에서도 사용자가 실제 도로로 오해한다.
4. **section↔subPath 대응 로직 부재**: `loadLane`은 `lane[].section[]`(형상 조각) 배열을 돌려주는데, 이를 각 대중교통 subPath 구간에 어떤 순서/기준으로 매핑할지에 대한 로직이 없다.

## Correctness Properties

Property 1: Bug Condition - 대중교통 구간이 실제 도로 형상 또는 명시적 개략 폴백으로 그려진다

_For any_ 대중교통 구간(subPath `trafficType` ∈ {1,2})이 하나 이상 존재하는 경로 입력(isBugCondition = true)에 대해, 수정된 `_leg()`는 각 대중교통 segment(`mode` ∈ {"bus","subway"})에 대해 다음을 만족해야(SHALL) 한다. (a) `loadLane` 형상이 가용하면 해당 구간의 `polyline`을 graphPos 기반 `[lat, lng]` 좌표로 구성하고(점 수 ≥ 정류장 수), `approx`는 false다. (b) 형상이 가용하지 않으면 정류장 직선 폴리라인을 유지하되 `approx=true`이고 `stationCoords`가 비어 있지 않으며(정류장 마커 좌표), 사용자에게 개략 직선 안내가 제공된다. 어느 경우에도 예외 없이 응답이 반환된다.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4**

Property 2: Preservation - 대중교통이 없는 경로의 기존 동작 유지

_For any_ 대중교통 구간이 없는 입력(isBugCondition = false: 도보 전용, walk-only, 도보 폴백)에 대해, 수정된 코드는 원본 코드와 정확히 동일한 결과(`F(X) = F'(X)`)를 산출해야(SHALL) 하며, 도보 폴리라인·안내·거리·난이도·reasons를 모두 보존한다.

**Validates: Requirements 3.1, 3.2, 3.3, 3.5**

Property 3: 형상 좌표 변환의 정확성 (graphPos → polyline)

_For any_ graphPos 점 목록(`{x, y}` 딕셔너리 리스트)에 대해, 변환 함수는 각 점을 `[y, x]`(= `[lat, lng]`) 순서의 좌표로 매핑하고, `x`/`y`가 없거나 숫자가 아닌 점은 건너뛰며, 입력 순서를 보존해야(SHALL) 한다. 유효 점이 2개 미만이면 폴백 신호(빈 결과)를 반환한다.

**Validates: Requirements 2.1, 2.5**

Property 4: additive 스키마 하위 호환

_For any_ 대중교통 또는 도보 segment 출력에 대해, `approx`와 `stationCoords`를 제외한 기존 필드(mode/name/polyline/distance/duration/stations/color/lowFloor/lowFloorNote)의 존재와 타입은 원본과 동일해야(SHALL) 하며, `approx`의 기본값은 false, `stationCoords`의 기본값은 빈 리스트다.

**Validates: Requirements 2.5, 3.4**

## Fix Implementation

### Changes Required

근본 원인 분석이 맞다는 가정 하에, 다음을 구현한다.

**File**: `backend/app/services/transit.py`

1. **신규 상수/함수 `_load_lane(map_obj)`**:
   - URL: `https://api.odsay.com/v1/api/loadLane`
   - 파라미터: `mapObject = f"0:0@{map_obj}"`, `apiKey = ODSAY_API_KEY`.
   - 헤더: `_odsay()`와 동일하게 `ODSAY_REFERER`를 `Referer`로 전송(설정 시).
   - 자체 타임아웃 `timeout=6.0`(전체 10초 예산 안에서 여유). 예외는 모두 흡수하고 `None` 반환.
   - 응답 파싱: `result.lane[].section[].graphPos` → 각 section을 `[[lat, lng], ...]`(= `[y, x]`) 점 목록으로 변환한 **section-point-list의 리스트**를 반환. 유효 점 < 2인 section은 제외. 결과가 비면 `None`.
   - **캐시**: `map_obj`를 키로 하는 모듈 캐시(`_lane_cache: dict[str, list | None]`). 동일 경로 재요청 시 재호출하지 않는다.

2. **graphPos 변환 순수 헬퍼 `_graphpos_to_polyline(graph_pos)`**:
   - 입력 `[{x, y}, ...]` → 출력 `[[float(y), float(x)], ...]`. `x`/`y` 결측/비수치 점은 건너뛴다. 순수 함수로 분리해 PBT 대상으로 삼는다(Property 3).

3. **section ↔ transit subPath 대응 로직**:
   - `loadLane`의 `lane[].section[]`은 mapObj 전체 경로의 형상 조각들이다. 이를 순서대로 평탄화(flatten)한 뒤, `_leg()`가 subPath를 순회하며 만나는 **대중교통 subPath 순서와 1:1로 소비**한다.
   - 기본 전략: 대중교통 subPath n번째 → 평탄화된 section 목록의 n번째 형상을 사용(순서 기반 association).
   - 보강(가능 시): 각 section 형상의 시작/끝 점과 subPath의 `startX/startY`·`endX/endY`를 비교해 근접(수십 m 이내)하면 매칭 확정, 크게 어긋나면 해당 구간만 폴백 처리(endpoint matching). 순서 기반이 어긋나는 드문 케이스를 방어한다.
   - section 수와 대중교통 subPath 수가 불일치하면, 매칭되지 않은 구간은 개별적으로 폴백(`approx=true`).

4. **`_leg()` 대중교통 분기 수정** (`t in (1, 2)` 블록):
   - 기존처럼 정류장 좌표 `pl`과 `stations`를 먼저 계산한다.
   - `path.info.mapObj`로 얻은 `_load_lane` 결과에서 이 구간에 대응하는 section 형상(`lane_pl`)을 조회한다.
   - `lane_pl`이 2점 이상이면: `seg["polyline"] = lane_pl`, `seg["approx"] = False`, `seg["stationCoords"] = []` (또는 필드 생략 — 기본값 false/[]).
   - 아니면(폴백): `seg["polyline"] = pl`(정류장 직선 유지), `seg["approx"] = True`, `seg["stationCoords"] = pl`(정류장 마커 좌표), 그리고 `guides`에 개략 직선 안내문을 추가.
   - `polyline.extend(...)`에는 최종 채택된 좌표(실제 형상 또는 직선)를 사용한다.
   - `mapObj` 미존재 또는 `_load_lane`이 `None`이면 모든 대중교통 구간을 폴백 처리한다.

5. **개략 직선 안내문**:
   - 상수 예: `NOTE_APPROX = "그려진 선은 정류장 간 개략 직선이며 실제 도로 형상과 다를 수 있습니다"`.
   - leg가 개략 구간을 하나라도 포함하면 `reasons`에 1회 추가(중복 방지). segment별로는 `guides`에 해당 구간 안내 뒤에 삽입.

6. **예외/예산 안전성**:
   - `_load_lane`은 자체 try/except로 모든 예외를 흡수하고 `None` 반환 → 경로 응답을 깨뜨리지 않는다(Req 2.4, 3.3).
   - `_load_lane`은 `_leg()` 캐시 대상 leg 결과와 함께 캐시되므로, leg 캐시 히트 시 재호출 없음. 전체 응답 예산(~10초) 안에서 동작(Req 3.6).

**File**: `backend/app/schemas.py`

7. **`TransitSegment` additive 필드 추가** (기존 필드 불변, Req 2.5):
   ```python
   approx: bool = False               # 정류장 간 개략 직선 여부 (True면 실제 도로 형상 아님)
   stationCoords: list[list[float]] = []  # 개략 직선일 때 정류장 마커 좌표 [[lat, lng], ...]
   ```

**File**: `frontend/src/MapView.jsx`

8. **개략 구간 시각 구분 + 정류장 마커**:
   - route 폴리라인 렌더 루프에서 대중교통 segment가 `seg.approx`이면 실선 대신 시각적으로 구분되는 스타일(예: `dash` 또는 낮은 opacity/가는 weight)로 그려 개략선임을 신호한다. 비개략(`approx` false)은 기존처럼 노선색 실선.
   - `seg.approx`이고 `seg.stationCoords`가 있으면 각 좌표에 작은 정류장 마커(작은 원/사각형 아이콘)를 그린다. `route` overlay 그룹에 함께 넣어 clear 로직으로 정리되게 한다.
   - `renderablePolylineCount`(mapdraw.js) 불일치 경고 로직은 폴리라인 수 기준이므로 그대로 유지된다(정류장 마커는 폴리라인이 아니라 카운트에 영향 없음).

**File**: `frontend/src/RouteSteps.jsx`

9. **개략 구간 안내 표기**:
   - `TransitSegment` 컴포넌트에서 `seg.approx`이면 작은 notice 텍스트를 추가: "정류장 간 개략 직선 — 실제 도로와 다를 수 있음". 기존 표시(노선명/승하차역/정거장 수/저상 라벨)는 변경하지 않는다.

## Testing Strategy

### Validation Approach

두 단계 접근: 먼저 수정 전 코드에서 버그를 드러내는 반례를 확보하고, 그다음 수정이 올바르게 동작하며 기존 동작을 보존함을 검증한다. 백엔드 순수 로직(graphPos 변환, section↔subPath 대응, approx 판정, 폴백)은 property-based testing으로, 통합 흐름은 fixture 기반 테스트로 검증한다.

> 참고: 현재 저장소에 테스트 러너가 없다. 백엔드는 `pytest` + `hypothesis`, 프런트는 `vitest` + `fast-check`를 devDependency로 추가해 실행한다. 러너 설치가 불가한 환경이면 그 사실을 명시하고 순수 함수 단위로라도 수동 검증한다.

### Exploratory Bug Condition Checking

**Goal**: 수정 전(F) 코드에서 버그를 재현하는 반례를 확보하고 근본 원인 가설을 확인/반증한다.

**Test Plan**: 대중교통 구간을 포함하는 ODsay 경로 응답 fixture(버스 2정류장, 지하철 구간)를 `_odsay`가 반환하도록 몽키패치하고, `_leg()`가 만든 대중교통 segment의 `polyline`을 관찰한다. 수정 전 코드에서 polyline 점 수 == 정류장 수(직선)이고 `approx` 필드가 없음을 확인한다.

**Test Cases**:
1. **버스 구간 직선 확인**: 정류장 2개 버스 subPath → polyline 2점 직선 (수정 전 관찰, 수정 후엔 실패해야 함) (will fail on fixed behavior expectation)
2. **지하철 구간 직선 확인**: 역 좌표만 이은 직선 polyline (will fail on unfixed code에서 개략성 미표기)
3. **개략성 미표기 확인**: 수정 전에는 `approx`/`stationCoords`/안내가 전혀 없음 (will fail on unfixed code)
4. **Edge - mapObj 존재하나 loadLane 미사용**: 응답에 `mapObj`가 있어도 loadLane 호출 흔적이 없음 (will fail on unfixed code)

**Expected Counterexamples**:
- 대중교통 segment의 polyline이 정류장 수만큼의 점으로만 구성 → 도로/건물 무시.
- 가능한 원인: 형상 소스 부재, mapObj 미사용, section↔subPath 대응 로직 부재.

### Fix Checking

**Goal**: 버그 조건이 성립하는 모든 입력에서 수정된 함수가 기대 동작을 산출함을 검증(Property 1, 3).

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := _leg_fixed(input)
  FOR EACH seg IN result.segments WHERE seg.mode IN {"bus","subway"} DO
    IF loadLaneAvailable(seg) THEN
      ASSERT seg.polyline follows graphPos geometry
        AND len(seg.polyline) >= number_of_stops(seg)
        AND seg.approx == false
    ELSE
      ASSERT seg.approx == true
        AND seg.stationCoords is non-empty
        AND approx notice present in guides/reasons
    END IF
  END FOR
  ASSERT no_exception(result)
END FOR
```

### Preservation Checking

**Goal**: 버그 조건이 성립하지 않는 모든 입력에서 수정된 함수가 원본과 동일한 결과를 산출함을 검증(Property 2).

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT _leg_original(input) == _leg_fixed(input)
END FOR
```

**Testing Approach**: preservation 검증에는 property-based testing이 권장된다. 입력 도메인(도보 전용, walk-only, 도보 폴백 경로) 전반에서 자동으로 다수 케이스를 생성하고, 수동 단위 테스트가 놓칠 엣지를 잡으며, 비버그 입력의 동작 불변을 강하게 보장한다.

**Test Plan**: 수정 전 코드에서 도보 전용/walk-only/폴백 경로의 출력(폴리라인·안내·거리·난이도)을 먼저 관찰하고, 그 동작을 캡처하는 property-based 테스트를 작성한다.

**Test Cases**:
1. **도보 전용 보존**: 대중교통 없는 경로가 수정 전/후 동일한 leg를 산출하는지 (Req 3.1)
2. **walk-only 보존**: 700m 이하 구간이 수정 전/후 동일하게 도보 처리되는지 (Req 3.2)
3. **도보 폴백 보존**: `ODSAY_API_KEY` 미설정/경로 실패 시 수정 전/후 동일한 도보 폴백 (Req 3.3)
4. **대중교통 segment의 비형상 필드 보존**: mode/name/distance/duration/stations/color/lowFloor가 수정 전과 동일 (Req 3.4)

### Unit Tests

- `_graphpos_to_polyline`: `{x,y}` → `[y,x]` 매핑, 결측/비수치 점 스킵, 순서 보존, 2점 미만 시 폴백.
- `_load_lane`: mapObject 포맷 `0:0@{mapObj}` 조립, Referer 헤더 사용, 예외/타임아웃 시 `None`, 캐시 히트 시 재호출 없음(몽키패치로 호출 카운트 검증).
- section↔subPath 대응: 순서 기반 매핑, 개수 불일치 시 미매칭 구간 폴백, endpoint 근접 매칭.
- `_leg()` 대중교통 분기: loadLane 가용 시 형상 polyline+`approx=false`, 미가용 시 직선+`approx=true`+`stationCoords`+안내.
- 스키마: `TransitSegment` 기본값(`approx=False`, `stationCoords=[]`)과 기존 필드 불변.

### Property-Based Tests

- **Property 3 (graphPos 변환)**: 무작위 `{x,y}` 리스트(일부 결측 필드 포함)에 대해 매핑·스킵·순서 불변식 검증.
- **Property 1 (fix)**: 무작위 대중교통 subPath 구성 + loadLane 형상 유/무를 생성해, 가용 시 형상 polyline+`approx=false`, 미가용 시 직선+`approx=true`+`stationCoords` 비어있지 않음을 검증.
- **Property 2 (preservation)**: 무작위 도보 전용/walk-only 경로에서 `F(X) == F'(X)` 검증.
- **Property 4 (스키마 호환)**: 무작위 segment dict를 `TransitSegment`로 검증 시 기존 필드 보존 및 additive 기본값 확인.
- **프런트 mapdraw**: 무작위 route에서 `renderablePolylineCount`가 approx 여부와 무관하게 폴리라인(≥2점) 수와 일치.

### Integration Tests

- **전체 경로 흐름 (형상 가용)**: `_odsay`/`_load_lane`을 fixture로 몽키패치 → `route()`가 대중교통 leg에 실제 형상 polyline을 담고 응답이 정상 반환되는지.
- **전체 경로 흐름 (폴백)**: `_load_lane`이 `None`을 반환하도록 → 대중교통 leg segment가 `approx=true`+`stationCoords`+안내를 갖고 예외 없이 반환되는지(Req 2.4).
- **예산/성능**: `_load_lane`가 6초 타임아웃을 갖고 leg 캐시로 중복 호출이 없어 전체 응답이 ~10초 예산 안에서 동작하는지, 저상버스 enrich 예산 가드가 유지되는지(Req 3.6).
- **프런트 렌더**: approx segment에 대해 MapView가 구분 스타일 폴리라인 + `stationCoords` 마커를 그리고, RouteSteps가 개략 직선 notice를 표기하는지.
