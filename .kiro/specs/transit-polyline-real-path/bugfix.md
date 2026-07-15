# Bugfix Requirements Document

## Introduction

편해질지도(barrier-free-travel)에서 버스/지하철 대중교통 경로를 지도에 표시할 때, 노선이 실제 도로 형상을 따라 그려지지 않고 정류장(정류소) 좌표끼리 직선으로만 이어진다. 그 결과 노선이 건물을 가로지르고 도로를 무시한 채 직선으로 다니는 것처럼 보여, 이동약자 사용자가 실제 경로를 오해하게 된다.

근본 원인은 `backend/app/services/transit.py`의 `_leg()`가 대중교통 구간(subPath trafficType 1/2)의 폴리라인을 오직 `sp.passStopList.stations`의 정류장 좌표로만 구성하기 때문이다:

```python
pl = [[float(s["y"]), float(s["x"])]
      for s in (sp.get("passStopList", {}).get("stations") or [])
      if s.get("x") and s.get("y")]
```

연속된 정류장을 직선으로 잇기 때문에 노선이 도로를 따르지 않는다. ODsay는 loadLane API(`GET https://api.odsay.com/v1/api/loadLane?mapObject=0:0@{mapObj}`)를 통해 실제 도로/노선 형상 좌표를 `result.lane[].section[].graphPos`(`{x: lng, y: lat}` 점 목록)로 제공하며, 프로젝트 키로 동작이 확인되었다. 경로 응답의 `path.info.mapObj`(예: `"1050:1:55:63"`)로 loadLane을 호출해 전체 대중교통 구간의 실제 형상 좌표를 얻을 수 있다.

이 버그 수정은 (1) loadLane 형상 좌표가 있을 때 실제 도로 형상으로 노선을 그리고, (2) loadLane이 실패/미가용일 때는 직선으로 오해를 주지 않도록 정류장 마커를 표시하고 개략적 직선임을 사용자에게 명시적으로 알리는 폴백을 도입한다. 스키마 변경은 기존 필드를 건드리지 않는 additive/optional 방식만 사용한다.

## Bug Analysis

### 버그 조건 및 속성 정의 (Bug Condition Methodology)

**F**: 현재(수정 전) `transit.py`의 대중교통 구간 폴리라인 생성 로직
**F'**: 수정 후 로직 (loadLane 실제 형상 우선, 실패 시 명시적 폴백)

**Bug Condition Function** — 버그를 유발하는 입력을 식별:

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type OdsayPathResponse   // subPath에 대중교통 구간(trafficType in {1,2})이 하나 이상 존재
  OUTPUT: boolean

  // 대중교통 구간이 존재하면, 현재 코드는 무조건 정류장 좌표 직선으로만 그리고
  // 그것이 개략적 직선임을 알리는 어떤 표시도 하지 않는다.
  RETURN hasTransitSubPath(X)
END FUNCTION
```

**Property: Fix Checking** — 버그 입력에 대한 올바른 동작:

```pascal
FOR ALL X WHERE isBugCondition(X) DO
  result ← F'(X)
  FOR EACH transitSegment IN result.segments WHERE segment.mode IN {"bus","subway"} DO
    // (a) loadLane 형상이 가용하면 실제 도로 형상 좌표로 폴리라인을 구성한다
    IF loadLaneAvailable(transitSegment) THEN
      ASSERT transitSegment.polyline follows real road geometry (graphPos 기반)
        AND transitSegment.polyline.length >= number_of_stops
        AND transitSegment.approx = false (또는 approx 필드 없음)
    // (b) loadLane 형상이 없으면 정류장 마커 + 개략적 직선 명시
    ELSE
      ASSERT transitSegment.approx = true
        AND transitSegment.stationCoords is non-empty (정류장 마커 좌표)
        AND user is notified that the line is a straight-line approximation
    END IF
  END FOR
  ASSERT no_exception(result)   // loadLane 실패가 경로 응답을 깨뜨리지 않는다
END FOR
```

**Property: Preservation Checking** — 비버그 입력은 기존 동작 유지:

```pascal
FOR ALL X WHERE NOT isBugCondition(X) DO
  // 대중교통 구간이 없는 경로(도보 전용, 700m 이하 walk-only, ODsay 폴백 도보 등)
  ASSERT F(X) = F'(X)
END FOR
```

**Counterexample**: 정류장이 2개뿐인 버스 구간에서 두 정류장이 굽은 도로로 연결될 때, 현재 폴리라인은 `[[stop1], [stop2]]` 2점 직선이 되어 도로/건물을 무시하고, 사용자에게 이것이 개략적 직선이라는 안내가 전혀 없다.

### Current Behavior (Defect)

현재 대중교통 구간이 포함된 경로가 지도에 그려지면 노선이 정류장 좌표 직선으로만 표시된다.

1.1 WHEN 경로에 버스/지하철 구간(subPath trafficType 1 또는 2)이 포함될 때 THEN the system 해당 구간의 polyline을 `passStopList.stations` 정류장 좌표만으로 구성해 정류장끼리 직선으로 잇는다
1.2 WHEN 대중교통 구간이 직선 폴리라인으로 그려질 때 THEN the system 노선이 도로가 아닌 직선(건물 가로지름)임을 사용자에게 알리는 어떠한 표시(마커/안내)도 제공하지 않는다
1.3 WHEN ODsay 경로 응답에 실제 도로 형상을 조회할 수 있는 `path.info.mapObj`가 존재할 때 THEN the system loadLane API를 호출하지 않아 이미 이용 가능한 실제 도로 형상 좌표를 사용하지 않는다

### Expected Behavior (Correct)

1.1의 조건에서 실제 도로 형상을 우선 사용하고, 불가할 때는 명시적으로 알린다.

2.1 WHEN 경로에 대중교통 구간이 포함되고 해당 구간의 loadLane 형상 좌표(`result.lane[].section[].graphPos`)가 가용할 때 THEN the system SHALL 해당 graphPos 좌표로 구간 polyline을 구성해 실제 도로 형상으로 노선을 그린다
2.2 WHEN loadLane 형상이 가용하지 않을 때(키 없음 / API 실패 / graphPos 비어 있음) THEN the system SHALL 정류장 to 정류장 직선 폴리라인으로 폴백하되, 해당 구간이 개략적 직선임을 나타내는 플래그(예: `approx = true`)와 정류장 마커 좌표(예: `stationCoords`)를 제공한다
2.3 WHEN 대중교통 구간이 개략적 직선으로 폴백될 때 THEN the system SHALL 사용자에게 "그려진 선은 정류장 간 개략적 직선이며 실제 도로 형상이 아니다"라는 취지의 안내(guide/notice)를 제공한다
2.4 WHEN loadLane 호출이 실패하거나 타임아웃될 때 THEN the system SHALL 예외 없이 정상적으로 경로 응답을 반환하며 2.2의 폴백을 적용한다
2.5 WHEN loadLane 실제 형상으로 노선을 그릴 때 THEN the system SHALL 스키마에 기존 필드를 변경하지 않고 optional/additive 필드(예: `approx`, `stationCoords`)만 추가하여 하위 호환을 유지한다

### Unchanged Behavior (Regression Prevention)

버그와 무관한 입력·동작은 기존과 동일해야 한다.

3.1 WHEN 경로에 대중교통 구간이 없을 때(도보 전용 경로) THEN the system SHALL CONTINUE TO 기존 도보 폴리라인과 안내를 동일하게 반환한다
3.2 WHEN 두 경유지 직선거리가 700m 이하라 walk-only로 처리될 때 THEN the system SHALL CONTINUE TO 대중교통 없이 도보 구간으로 안내한다
3.3 WHEN ODSAY_API_KEY 미설정 또는 경로 탐색 실패로 도보 폴백이 발생할 때 THEN the system SHALL CONTINUE TO 도보 경로로 폴백하고 앱을 죽이지 않는다
3.4 WHEN 대중교통 구간의 mode/name/distance/duration/stations/color 및 버스 저상(lowFloor/lowFloorNote) 정보가 산출될 때 THEN the system SHALL CONTINUE TO 기존과 동일한 값과 안내문을 반환한다
3.5 WHEN 전체 소요시간(Σsegment duration)과 전체 도보 거리(Σwalk segment distance), 난이도(worst-element) 및 reasons가 계산될 때 THEN the system SHALL CONTINUE TO 기존 불변식대로 산출한다
3.6 WHEN 전체 경로 응답이 반환될 때 THEN the system SHALL CONTINUE TO 약 10초 예산 내에서 응답하며 저상버스 실시간 enrich 예산 가드를 유지한다
