# Implementation Plan: departure-transit-accessibility

## Overview

이 계획은 기존 "모두의 여행"(barrier-free-travel) 앱 위에 세 기능(지역별 고정 출발지, 출발지 기준 대중교통 경로, 장애인 화장실 커버리지)을 하위 호환을 지키며 얹는다. 구현은 백엔드 순수 로직 + 속성 테스트를 먼저 완성해 조기 검증하고, 이어서 엔드포인트, 프론트엔드 배선, 마지막으로 오프라인 데이터 보강 스크립트 순으로 진행한다.

- 백엔드: Python / FastAPI (`backend/app`), 속성 테스트는 **pytest + Hypothesis**
- 프론트엔드: React / Vite (`frontend/src`), 속성 테스트는 **vitest + fast-check**
- 속성 테스트는 최소 100회 반복하고, 각 테스트에 `Feature: departure-transit-accessibility, Property {번호}: {속성}` 태그 주석을 단다.
- `*` 표시 하위 태스크는 선택(테스트) 태스크로, MVP를 위해 건너뛸 수 있다.

## Tasks

- [ ] 1. 테스트 하네스 및 프로젝트 배선 준비
  - [ ]* 1.1 백엔드 테스트 도구 설정
    - `backend/requirements.txt`에 `pytest`, `hypothesis` 추가
    - `backend/tests/` 디렉터리와 `conftest.py`(app 패키지 임포트 경로 설정) 생성
    - 대표 ODsay/Tmap/TAGO 응답 픽스처 로더 헬퍼 작성(`backend/tests/fixtures.py`)
    - _Requirements: 3.2, 7.1_
  - [ ]* 1.2 프론트엔드 테스트 도구 설정
    - `frontend/package.json`에 `vitest`, `fast-check`, `jsdom`, `@testing-library/react` devDependency 추가 및 `test` 스크립트(`vitest --run`) 추가
    - `frontend/vite.config.js`에 vitest `test` 설정(environment: jsdom) 추가
    - _Requirements: 1.1, 2.1_

- [x] 2. 화장실 커버리지 순수 서비스 (백엔드)
  - [x] 2.1 restroom.py 최근접 화장실 로직 구현
    - `backend/app/services/restroom.py` 신규 작성: `COVERAGE_RADIUS_M = 500`, `_haversine_m`, `nearest_restroom(place, candidates)`, `coverage_for_course(course_places, all_places)`
    - toilet 배지 보유 장소는 자기 자신을 거리 0m·isSelf=True로 반환
    - 미보유 장소는 후보(toilet 배지) 중 500m 이내 최근접 선택, 거리 동률이면 이름 사전순 첫 번째
    - 거리는 10m 단위 반올림, 결과에 name/lat/lng 포함, 없으면 None
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.6_
  - [ ]* 2.2 toilet 자기 자신 커버리지 속성 테스트
    - **Property 18: toilet 배지 장소는 자기 자신이 화장실 출처**
    - **Validates: Requirements 7.2**
  - [ ]* 2.3 최근접 화장실 선택 속성 테스트
    - **Property 19: 최근접 화장실 선택 (500m 이내 최소 거리, 동률 이름 사전순, 없으면 notice)**
    - **Validates: Requirements 7.1, 7.3, 7.4, 7.5, 7.6**

- [x] 3. 배지 판정 보수성 확인 (백엔드)
  - [x] 3.1 badges.parse_badges toilet 판정 확인/보강
    - `backend/app/services/badges.py`의 `parse_badges` toilet 경로가 긍정 지표 ≥1 & 부정 지표 0일 때만 배지를 부여하는지 확인하고 누락 시 보수적으로 보강
    - _Requirements: 8.2, 9.4_
  - [ ]* 3.2 보수적 배지 판정 속성 테스트
    - **Property 21: 보수적 화장실 배지 판정 (긍정 지표 포함 & 부정 지표 미포함일 때만 부여)**
    - **Validates: Requirements 8.2, 9.4**

- [x] 4. Restroom Coverage 스키마 및 엔드포인트 (백엔드, additive)
  - [x] 4.1 RestroomCoverage 스키마 추가
    - `backend/app/schemas.py`에 `RestroomCoveragePlace`, `RestroomCoverageRequest`, `RestroomInfo`, `RestroomCoverageItem`, `RestroomCoverageOut` 신규 모델만 추가(기존 모델 불변)
    - _Requirements: 7.4, 7.5, 7.6_
  - [x] 4.2 POST /api/restrooms/coverage 엔드포인트 추가
    - `backend/app/routers/places.py`에 신규 엔드포인트 추가: 요청 장소 목록을 받아 `restroom.coverage_for_course`로 커버리지 계산, `store`에서 toilet 후보 로드
    - 기존 엔드포인트 불변 유지
    - _Requirements: 7.1, 7.4, 7.5, 7.6_
  - [ ]* 4.3 커버리지 엔드포인트 통합 테스트
    - 배지 보유(자기 자신)/500m 내 존재/500m 내 없음 3케이스 예시 테스트
    - _Requirements: 7.2, 7.3, 7.5_

- [x] 5. Checkpoint - 화장실 서비스 검증
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. 대중교통 경로 순수 로직 확인 및 입력 검증 (백엔드)
  - [x] 6.1 transit.py segment 분해/700m 분기/합계/폴백 로직 확인
    - `backend/app/services/transit.py`의 `_leg`, `route`, `_pick_path`가 segment 유형 분해, 700m 임계 분기, 총시간/총도보 합계, 지하철 난이도 보정, ODsay 부재 시 도보 폴백을 충족하는지 확인하고 미흡분 보강
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.9, 4.1, 4.2_
  - [x] 6.2 route.py 대중교통 입력 검증 추가
    - `backend/app/routers/route.py`에서 `mode=transit`인데 출발지가 없거나 코스 장소가 0개(waypoints<2)이면 400 에러 반환하고 segment 목록 미반환
    - _Requirements: 3.8_
  - [ ]* 6.3 leg segment 분해 속성 테스트
    - **Property 6: 대중교통 leg는 유효한 segment로 분해된다 (walk/bus/subway 정확히 하나, walk stations 빈 리스트)**
    - **Validates: Requirements 3.2, 3.9**
  - [ ]* 6.4 700m 임계 분기 속성 테스트
    - **Property 7: 700m 임계로 도보 전용/대중교통 포함 결정**
    - **Validates: Requirements 3.3, 3.4**
  - [ ]* 6.5 경로 선택 정렬 속성 테스트
    - **Property 8: 경로 선택은 환승·도보·시간 순 최소 (사전식 튜플 최소)**
    - **Validates: Requirements 3.5**
  - [ ]* 6.6 지하철 난이도 최소 중간 속성 테스트
    - **Property 9: 지하철 포함 leg의 난이도는 최소 중간**
    - **Validates: Requirements 3.6**
  - [ ]* 6.7 ODsay 폴백 속성 테스트
    - **Property 10: ODsay 불가 시 도보 폴백 + 안내**
    - **Validates: Requirements 3.7**
  - [ ]* 6.8 대중교통 입력 검증 속성 테스트
    - **Property 11: 잘못된 대중교통 입력은 거부된다 (segment 미반환)**
    - **Validates: Requirements 3.8**

- [x] 7. 소요시간/도보 합계 및 저상버스 신뢰성 (백엔드)
  - [x] 7.1 총시간/총도보 합계 및 저상 enrich 예산 가드 확인/보강
    - `transit.route`의 totalDuration = segment duration 합, totalDistance = walk segment distance 합 확인
    - `_enrich_low_floor`에 10초 예산 가드 추가: 초과 시 남은 버스 구간 `lowFloor=None`, TAGO 실패 시 조용히 생략
    - _Requirements: 4.1, 4.2, 9.1, 9.2_
  - [ ]* 7.2 전체 소요시간 합계 속성 테스트
    - **Property 12: 전체 소요시간은 segment 소요시간의 합**
    - **Validates: Requirements 4.1**
  - [ ]* 7.3 전체 도보 거리 합계 속성 테스트
    - **Property 13: 전체 도보 거리는 walk segment 거리의 합**
    - **Validates: Requirements 4.2**
  - [ ]* 7.4 정거장 수 비음수 속성 테스트
    - **Property 15: 정거장 수는 비음수 정수**
    - **Validates: Requirements 4.4**
  - [ ]* 7.5 저상버스 실시간 실패 무영향 속성 테스트
    - **Property 23: 저상버스 실시간 실패는 경로를 막지 않는다 (lowFloor=None, 예외 없음)**
    - **Validates: Requirements 9.2**

- [x] 8. 지하철 노선색 매핑 (백엔드)
  - [x] 8.1 _subway_color 매핑 확인/보강
    - `transit.py`의 지하철 노선색 매핑 함수가 등록 접두어 일치 시 노선색, 미일치 시 기본색을 반환하는지 확인
    - _Requirements: 5.2_
  - [ ]* 8.2 지하철 노선색 매핑 속성 테스트
    - **Property 16: 지하철 노선색 매핑**
    - **Validates: Requirements 5.2**

- [x] 9. Checkpoint - 대중교통 백엔드 검증
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Departure Registry 및 검증 유틸 (프론트엔드)
  - [x] 10.1 REGIONS를 departures 배열로 확장
    - `frontend/src/App.jsx`의 각 REGION `origin`(단일)을 `departures`(정확히 2개, name/lat/lng/type) 배열로 확장(10개 지역 × 2 = 20개), 지하철 운행 지역은 ≥1 지하철역 배정
    - `origin` getter가 `departures[0]`을 가리키도록 하위 호환 유지
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_
  - [x] 10.2 validateDeparture 유틸 구현
    - `frontend/src/App.jsx`(또는 분리 모듈)에 `validateDeparture` 작성: 이름 1~60자, 위도/경도 숫자·범위, bbox 내부 검증. 불합격 지점은 목록 제외 + `console.warn` 사유 기록
    - _Requirements: 1.6_
  - [ ]* 10.3 출발지 레지스트리 유효성 속성 테스트
    - **Property 1: 출발지 레지스트리 유효성 (지역당 정확히 2개, 필드 범위, 유형 집합, bbox 내부)**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4**
  - [ ]* 10.4 잘못된 출발지 제외 속성 테스트
    - **Property 2: 잘못된 출발지는 선택 목록에서 제외된다**
    - **Validates: Requirements 1.6**

- [x] 11. DepartureSelector 및 상태 배선 (프론트엔드)
  - [x] 11.1 DepartureSelector 컴포넌트 구현
    - `frontend/src/DepartureSelector.jsx` 신규: `region`/`selected`/`myLoc`/`onSelect` props, departures 2개를 이름+유형 라벨로 표시, myLoc가 bbox 내부면 "내 위치" 추가(3개), 아니면 2개
    - 미선택 시 대중교통 계산 차단 안내 문구 표시
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 2.6_
  - [x] 11.2 옵션 개수 순수 로직 분리
    - "내 위치" 노출 판정(위치가 bbox 내부인지)을 순수 함수로 분리해 테스트 가능하게 함
    - _Requirements: 2.5, 2.6_
  - [x] 11.3 App.jsx selectedDeparture 상태 및 플로우 배선
    - `selectedDeparture` 상태 추가, getOrigin을 selectedDeparture 우선 로직으로 교체, region 변경 시 `setSelectedDeparture(null)`, selectedDeparture 변경 시 `useEffect`로 재계산(첫 waypoint 교체 후 loadRoute)
    - DepartureSelector를 사이드바에 렌더 연결
    - _Requirements: 2.2, 2.4, 2.7, 2.8, 3.1_
  - [ ]* 11.4 출발지가 경로 시작점 속성 테스트
    - **Property 3: 선택한 출발지가 경로의 시작점이 된다 (waypoints[0] 일치)**
    - **Validates: Requirements 2.2, 3.1**
  - [ ]* 11.5 지역 변경 시 초기화 속성 테스트
    - **Property 4: 지역 변경 시 선택 출발지 초기화**
    - **Validates: Requirements 2.7**
  - [ ]* 11.6 내 위치 옵션 노출 조건 속성 테스트
    - **Property 5: 내 위치 옵션 노출 조건 (bbox 내부면 3개, 아니면 2개)**
    - **Validates: Requirements 2.5, 2.6**
  - [ ]* 11.7 DepartureSelector 렌더 예시 테스트
    - 옵션 라벨(이름+유형) 표시, 미선택 시 안내 문구, 모드 토글 비활성화 예시 테스트
    - _Requirements: 2.1, 2.3, 2.4, 6.3_

- [x] 12. Checkpoint - 출발지 선택 플로우 검증
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. RouteSteps 강화 및 ETA/포맷 로직 (프론트엔드)
  - [x] 13.1 ETA/거리 포맷 순수 유틸 확인/분리
    - `frontend/src/RouteSteps.jsx`의 `fmtT`(분 = max(1, round(초/60)))·거리 포맷을 순수 함수로 확인/분리
    - _Requirements: 4.7_
  - [x] 13.2 RouteSteps segment 단위 표시 강화
    - leg별 ETA(분)·도보 거리(m), transit segment별 노선명/승차역/하차역/정거장 수(비음수 정수), bus segment lowFloor true/false/null("정보 없음") 표시
    - 코스 장소별 화장실 커버리지("가장 가까운 접근 화장실: {이름} ({거리}m)" 또는 "주변 인증 화장실 없음") 표시
    - _Requirements: 4.3, 4.4, 4.5, 4.6, 7.4, 7.5_
  - [ ]* 13.3 ETA 분 표시 규칙 속성 테스트
    - **Property 14: ETA 분 표시 규칙 (max(1, round(초/60)))**
    - **Validates: Requirements 4.7**
  - [ ]* 13.4 RouteSteps 표시 예시 테스트
    - 저상버스 정보 성공/없음, 정거장 수, ETA·도보 표시 예시 테스트
    - _Requirements: 4.3, 4.4, 4.5, 4.6_

- [x] 14. MapView 렌더 강화 (프론트엔드)
  - [x] 14.1 출발지 마커 및 segment 폴리라인 스타일/스킵 로직
    - `frontend/src/MapView.jsx`: `origin` prop을 selectedDeparture로 연결하고 course 핀과 구분되는 출발지 마커 스타일 유지
    - subway=노선색, bus=segment 색, walk=점선(dash), 빈 좌표(2점 미만) segment 스킵 후 나머지 계속 렌더, 모드 전환 시 route 재렌더
    - 화장실 커버리지 좌표 마커 오버레이 그룹(`restrooms`) 추가
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 6.6, 7.6_
  - [x] 14.2 폴리라인 렌더 카운트 순수 계산 분리
    - "좌표 있는 segment 수 = 그려질 폴리라인 수" 계산을 순수 함수로 분리
    - _Requirements: 5.5_
  - [ ]* 14.3 빈 좌표 segment 스킵 속성 테스트
    - **Property 17: 빈 좌표 segment는 렌더에서 건너뛴다 (그려진 폴리라인 수 = 좌표 있는 segment 수)**
    - **Validates: Requirements 5.5**
  - [ ]* 14.4 MapView 렌더 예시 테스트
    - 출발지 마커 구분, walk 점선/노선색/bus색, 모드 전환 재렌더 예시(mock) 테스트
    - _Requirements: 5.1, 5.3, 5.4, 5.6, 5.7_

- [x] 15. 이동 방법 전환 배선 확인 (프론트엔드)
  - [x] 15.1 모드 토글 및 재계산 실패 처리 확인
    - `App.jsx`의 `switchMode`가 현재 출발지/코스로 재계산, 재계산 중 토글 비활성화, 실패 시 에러 메시지 + 이전 route 유지(`setRoute` 미변경) 동작하는지 확인/보강
    - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - [ ]* 15.2 모드 전환 예시 테스트
    - 재계산 진행 중 비활성화, 실패 시 이전 경로 유지 예시 테스트
    - _Requirements: 6.3, 6.4_

- [x] 16. API 클라이언트 배선 (프론트엔드)
  - [x] 16.1 api.js에 화장실 커버리지 호출 추가
    - `frontend/src/api.js`에 `POST /api/restrooms/coverage` 호출 함수 추가, App/RouteSteps에서 코스 생성 시 호출해 커버리지 결과를 상태로 보관
    - _Requirements: 7.1, 7.4, 7.5_

- [x] 17. Checkpoint - 프론트엔드 통합 검증
  - Ensure all tests pass, ask the user if questions arise.

- [x] 18. 화장실 데이터 보강 스크립트 (오프라인)
  - [x] 18.1 dump_restrooms.py 구현
    - `backend/scripts/dump_restrooms.py` 신규: 외부 장애인 화장실 공공데이터에서 지역별 레코드 조회, toilet 배지 장소가 3개 미만인 지역을 min(3, n+m)까지 보강
    - 보강 레코드를 `type: 99`, `badges: ["toilet"]`, name/lat/lng/region 포함으로 `data/{region}_places.json`에 병합 저장
    - name/lat/lng 중 하나라도 누락된 후보는 제외 + 로그, 소스 불가 시 기존 레코드 유지(런타임 로드 무영향)
    - 각 지역 toilet 배지 장소 ≥1 보장
    - _Requirements: 8.1, 8.3, 8.4, 8.5, 8.6_
  - [x] 18.2 store.py 보강 화장실 로드 규약 확인
    - `backend/app/services/store.py`가 `type: 99` 화장실 레코드를 PLACES에 병합 로드하고 관광지/음식점 쿼리(type_ 필터)와 섞이지 않는지 확인/보강
    - _Requirements: 8.1_
  - [ ]* 18.3 지역별 화장실 최소 보장 속성 테스트
    - **Property 20: 지역별 화장실 최소 보장 (toilet 배지 장소 ≥1)**
    - **Validates: Requirements 8.1**
  - [ ]* 18.4 화장실 데이터 보강 규칙 속성 테스트
    - **Property 22: 화장실 데이터 보강 규칙 (레코드 수 비감소, min(3, n+m) 도달, 필드 누락 제외, 저장 필드 보장)**
    - **Validates: Requirements 8.3, 8.4, 8.5**

- [x] 19. 신뢰성 통합 및 최종 배선
  - [x] 19.1 10초 타임아웃/폴백/실패 구간 메시지 통합 확인
    - 전체 경로 응답 10초 이내 반환(개별 호출 타임아웃 + enrich 예산 가드), 두 경유지 완전 실패 시 실패 구간 식별 메시지, ODsay 부재 시 도보 폴백 안내가 프론트까지 전달되는지 배선 확인
    - _Requirements: 9.1, 9.3_
  - [ ]* 19.2 신뢰성 통합 예시 테스트
    - 타임아웃 폴백, 저상 실시간 성공/실패/미신청 3케이스, 실패 구간 메시지 예시(mock) 테스트
    - _Requirements: 9.1, 9.2, 9.3_

- [x] 20. 최종 Checkpoint - 전체 테스트 통과 확인
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- `*` 표시 하위 태스크는 선택(테스트)으로 MVP를 위해 건너뛸 수 있다. 최상위 태스크는 선택 표시하지 않는다.
- 각 태스크는 특정 요구사항 조항을 참조해 추적성을 확보한다.
- 속성 테스트는 설계의 Correctness Properties(총 23개)를 1:1로 구현하며, Hypothesis(백엔드)·fast-check(프론트) 사용, 최소 100회 반복, 대응 속성 번호 태그 주석을 단다.
- UI/지도 렌더·타임아웃/폴백은 속성 대신 예시/통합(mock) 테스트로 다룬다.
- 하위 호환: `schemas.py` 기존 모델 불변, 신규 필드/모델만 additive로 추가.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "3.1", "6.1", "8.1", "10.1", "18.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "3.2", "4.1", "6.2", "6.3", "6.4", "6.5", "6.6", "6.7", "6.8", "7.1", "8.2", "10.2", "18.2"] },
    { "id": 3, "tasks": ["4.2", "7.2", "7.3", "7.4", "7.5", "10.3", "10.4", "11.1", "11.2", "18.3", "18.4"] },
    { "id": 4, "tasks": ["4.3", "11.3", "11.7", "13.1", "14.1", "14.2", "15.1", "16.1"] },
    { "id": 5, "tasks": ["11.4", "11.5", "11.6", "13.2", "14.3", "14.4", "15.2", "19.1"] },
    { "id": 6, "tasks": ["13.3", "13.4", "19.2"] }
  ]
}
```
