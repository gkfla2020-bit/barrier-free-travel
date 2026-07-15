# Requirements Document

## Introduction

이 기능은 무장애 여행 플래너 "모두의 여행"(barrier-free-travel)을 데모 수준에서 실제 사용 가능한 수준으로 끌어올린다. 세 가지 축으로 구성된다.

1. **지역 기반 고정 출발지 선택**: 현재 각 지역은 하드코딩된 단일 출발지(예: 광화문역)만 가진다. 이를 지역당 2개씩(10개 지역 × 2 = 20개) 확장하고, 코스 생성 전에 사용자가 출발지를 명시적으로 선택하는 UX를 추가한다.

2. **출발지 기준 실제 대중교통 경로 안내**: "대중교통 포함" 모드가 실제 버스/지하철 경로, 예상 소요시간, 도보 구간을 지도 폴리라인과 단계별 안내로 신뢰성 있게 표시하도록 완성한다. 선택한 출발지가 경로의 시작점이 된다.

3. **장애인 화장실 커버리지 보강**: 일부 지역은 화장실 정보가 표시되지 않는다. 추천 코스에 포함된 각 장소 주변에 접근 가능한 화장실 정보가 반드시 안내되도록 하고, 화장실 데이터가 부족한 지역의 공백을 메운다.

이 문서는 기존 아키텍처(FastAPI 백엔드 + React/Vite 프론트엔드, TourAPI/Tmap/ODsay/TAGO 연동)를 전제로 하며, 확정된 API 계약(schemas.py)과의 하위 호환을 유지하는 방향으로 요구사항을 정의한다.

## Glossary

- **System**: barrier-free-travel 애플리케이션 전체(백엔드 + 프론트엔드).
- **Departure_Registry**: 각 지역이 가진 고정 출발지 목록을 정의하는 데이터 구조. 지역당 정확히 2개의 출발지를 가진다.
- **Departure_Point**: 하나의 고정 출발지. 이름, 위도, 경도, 지역 식별자, 출발지 유형(예: 지하철역, 버스터미널, 주차장)을 가진다.
- **Region**: 지원되는 여행 지역(서울, 경주, 부산, 전주, 강릉, 여수, 제주, 수원, 인천, 대구의 10개).
- **Departure_Selector**: 사용자가 출발지를 선택하는 프론트엔드 UI 구성요소.
- **Route_Service**: 경유지 목록을 받아 경로(도보 또는 대중교통)를 계산하는 백엔드 서비스(tmap.py, transit.py).
- **Transit_Route**: 버스/지하철 탑승 구간과 도보 구간으로 구성된 대중교통 경로.
- **Route_Segment**: 경로를 구성하는 단일 구간. 유형은 walk(도보), bus(버스), subway(지하철) 중 하나.
- **ETA**: 예상 소요시간(초 단위). 탑승 시간과 도보 시간을 포함한 전체 이동 시간.
- **Map_View**: 지도와 마커, 코스 핀, 경로 폴리라인을 렌더링하는 프론트엔드 구성요소(MapView.jsx).
- **Route_Steps**: 경로를 단계별 텍스트로 안내하는 프론트엔드 구성요소(RouteSteps.jsx).
- **Course**: 사용자가 방문할 장소들의 순서 있는 목록.
- **Course_Place**: 코스에 포함된 개별 장소.
- **Accessible_Restroom**: 이동약자가 이용 가능한 것으로 판정된 화장실. 배지 체계에서 "toilet" 배지로 표현된다.
- **Restroom_Coverage_Service**: 코스 장소별로 접근 가능한 화장실 정보를 확보/보강하는 백엔드 서비스.
- **Badge_Service**: TourAPI detailWithTour2 서술형 필드를 배지 4종(wheelchair/elevator/toilet/parking)으로 판정하는 서비스(badges.py).
- **Place_Store**: data/*_places.json을 메모리에 상주시키는 장소 저장소(store.py).
- **Coverage_Radius**: 코스 장소로부터 화장실을 탐색하는 반경(미터).
- **Fallback_Route**: 대중교통 경로 계산이 실패했을 때 대신 제공되는 도보 경로.

## Requirements

### Requirement 1: 지역별 고정 출발지 정의

**User Story:** 여행자로서, 나는 각 지역에서 미리 검증된 출발지 중 하나를 고르고 싶다. 그래야 접근성이 확인된 지점에서 여행을 시작할 수 있다.

#### Acceptance Criteria

1. THE Departure_Registry SHALL define exactly 2 Departure_Points for each of the 10 supported Regions (서울, 경주, 부산, 전주, 강릉, 여수, 제주, 수원, 인천, 대구).
2. THE Departure_Registry SHALL provide a total of 20 Departure_Points across all Regions.
3. THE Departure_Registry SHALL store, for each Departure_Point, a name of 1 to 60 characters, a latitude in the range -90 to 90, a longitude in the range -180 to 180, a Region identifier, and a departure type from the set {지하철역, 버스터미널, 주차장}.
4. THE System SHALL ensure that each Departure_Point latitude falls within the minimum and maximum latitude of its associated Region bounding box, and each Departure_Point longitude falls within the minimum and maximum longitude of its associated Region bounding box.
5. WHERE a Region is served by at least 1 subway line, THE Departure_Registry SHALL include at least 1 Departure_Point of type 지하철역 for that Region.
6. IF a Departure_Point definition is missing a name, has a non-numeric or out-of-range latitude or longitude, or has coordinates outside its Region bounding box, THEN THE System SHALL exclude that Departure_Point from the selectable list and SHALL log an exclusion indication identifying the offending Departure_Point.

### Requirement 2: 출발지 선택 UX

**User Story:** 여행자로서, 나는 코스를 만들기 전에 어느 출발지에서 출발할지 명시적으로 선택하고 싶다. 그래야 경로가 내 실제 출발 위치를 반영한다.

#### Acceptance Criteria

1. WHEN a Region is selected, THE Departure_Selector SHALL present the 2 Departure_Points defined for that Region as selectable options.
2. WHEN a user selects a Departure_Point, THE System SHALL set the selected Departure_Point as the origin for subsequent route calculation.
3. THE Departure_Selector SHALL display the name and the departure type of each Departure_Point option.
4. WHILE no Departure_Point has been selected for the active Region, THE System SHALL block Transit_Route calculation and SHALL display a prompt requesting a Departure_Point selection.
5. WHERE the user grants device location access and the device location falls within the active Region bounding box, THE Departure_Selector SHALL offer the device location as an additional origin option alongside the 2 fixed Departure_Points.
6. IF the user denies device location access or the device location falls outside the active Region bounding box, THEN THE Departure_Selector SHALL present only the 2 fixed Departure_Points as origin options.
7. WHEN a user changes the active Region, THE System SHALL clear the previously selected Departure_Point and request a new selection for the newly active Region.
8. WHEN a user changes the selected Departure_Point after a Course exists, THE System SHALL recalculate the route from the newly selected Departure_Point.

### Requirement 3: 출발지 기준 대중교통 경로 계산

**User Story:** 여행자로서, 나는 선택한 출발지에서 시작하는 실제 대중교통 경로를 받고 싶다. 그래야 버스와 지하철을 이용해 코스를 이동할 수 있다.

#### Acceptance Criteria

1. WHEN a user requests a Transit_Route with a selected Departure_Point and a Course of at least 1 Course_Place, THE Route_Service SHALL calculate a route whose first waypoint is the selected Departure_Point.
2. WHEN the Route_Service calculates a Transit_Route, THE Route_Service SHALL decompose each leg into ordered Route_Segments, and each Route_Segment SHALL have exactly one type from the set {walk, bus, subway}.
3. WHEN two consecutive waypoints are separated by a straight-line distance of 700 meters or less, THE Route_Service SHALL provide a walk-only leg between those waypoints.
4. WHEN two consecutive waypoints are separated by a straight-line distance greater than 700 meters, THE Route_Service SHALL provide a leg that includes at least one bus or subway Route_Segment between those waypoints.
5. WHEN a Transit_Route includes multiple candidate paths, THE Route_Service SHALL select the path with the fewest transfers, SHALL break ties by selecting the path with the least total walking distance in meters, and SHALL break any remaining tie by selecting the path with the smallest total ETA in seconds.
6. WHEN a Transit_Route includes a subway Route_Segment, THE Route_Service SHALL set the leg difficulty to one of the ordered values whose rank is equal to or greater than "중간".
7. IF the ODsay transit API key is absent or the ODsay transit request fails, THEN THE Route_Service SHALL return a Fallback_Route computed as a walking route and SHALL include a notice indicating that a walking route is provided instead of a transit route.
8. IF a Transit_Route is requested without a selected Departure_Point or with a Course of 0 Course_Places, THEN THE Route_Service SHALL reject the request, SHALL return an error indication describing the missing input, and SHALL NOT return a Route_Segment list.
9. WHEN the Route_Service returns a Transit_Route, THE Route_Service SHALL include, for each Route_Segment, its name, its distance in meters, its duration in seconds, and its passing station list, where the passing station list is an empty list for a walk Route_Segment.

### Requirement 4: 대중교통 경로의 소요시간 및 도보 구간 표시

**User Story:** 여행자로서, 나는 각 구간의 예상 소요시간과 도보 거리를 보고 싶다. 그래야 이동에 걸리는 시간과 걷는 정도를 미리 파악할 수 있다.

#### Acceptance Criteria

1. WHEN the Route_Service returns a Transit_Route, THE Route_Service SHALL include a total ETA in seconds equal to the sum of all Route_Segment durations in seconds.
2. WHEN the Route_Service returns a Transit_Route, THE Route_Service SHALL include a total walking distance in meters equal to the sum of all walk Route_Segment distances in meters.
3. WHEN a Transit_Route is displayed, THE Route_Steps SHALL display, for each leg, its ETA in minutes and its walking distance in meters.
4. WHEN a Transit_Route is displayed, THE Route_Steps SHALL display, for each transit Route_Segment, the line name, the boarding station, the alighting station, and the number of stops as a non-negative integer.
5. WHERE a bus Route_Segment has real-time low-floor bus information available, THE Route_Steps SHALL display whether the next bus is a low-floor bus.
6. IF a bus Route_Segment has no real-time low-floor bus information available, THEN THE Route_Steps SHALL display an indication that low-floor bus information is unavailable for that Route_Segment.
7. WHEN the Route_Steps displays an ETA, THE Route_Steps SHALL display it in minutes rounded to the nearest whole minute, with a minimum displayed value of 1 minute.

### Requirement 5: 대중교통 경로의 지도 표시

**User Story:** 여행자로서, 나는 대중교통 경로가 지도 위에 실제 버스/지하철 노선과 도보 구간으로 그려지길 원한다. 그래야 이동 경로를 시각적으로 이해할 수 있다.

#### Acceptance Criteria

1. WHEN a Transit_Route is available, THE Map_View SHALL render one polyline for each Route_Segment using the coordinate list returned by the Route_Service.
2. WHEN the Map_View renders a subway Route_Segment, THE Map_View SHALL draw the polyline using the subway line color provided by the Route_Service.
3. WHEN the Map_View renders a bus Route_Segment, THE Map_View SHALL draw the polyline using the bus segment color provided by the Route_Service.
4. WHEN the Map_View renders a walk Route_Segment, THE Map_View SHALL draw the polyline using a dashed line style, distinct from the solid line style used for bus and subway Route_Segments.
5. IF a Route_Segment has an empty coordinate list, THEN THE Map_View SHALL skip rendering a polyline for that Route_Segment and SHALL continue rendering the remaining Route_Segments.
6. WHEN a Transit_Route is available, THE Map_View SHALL render a single marker at the selected Departure_Point coordinates, using a marker style distinct from Course_Place markers.
7. WHEN a user switches between walk mode and transit mode, THE Map_View SHALL remove the currently rendered route and SHALL render the route for the newly selected mode.

### Requirement 6: 이동 방법 전환

**User Story:** 여행자로서, 나는 도보 전용 경로와 대중교통 포함 경로를 전환하며 비교하고 싶다. 그래야 상황에 맞는 이동 방법을 고를 수 있다.

#### Acceptance Criteria

1. WHILE a Course of at least 2 waypoints including the Departure_Point exists, THE System SHALL present a control to switch between walk mode and transit mode.
2. WHEN a user switches the travel mode, THE System SHALL recalculate the route for the selected mode from the current Departure_Point and Course.
3. WHILE a route recalculation is in progress, THE System SHALL disable the travel mode switch control.
4. IF a route recalculation fails, THEN THE System SHALL display an error message and SHALL retain the previously displayed route.

### Requirement 7: 코스 장소 주변 접근 가능 화장실 보장

**User Story:** 이동약자 여행자로서, 나는 추천된 코스의 각 장소 주변에 접근 가능한 화장실 정보가 반드시 표시되길 원한다. 그래야 이동 중 화장실 이용을 계획할 수 있다.

#### Acceptance Criteria

1. WHEN a Course is generated, THE Restroom_Coverage_Service SHALL determine, for each Course_Place, the nearest Accessible_Restroom within a Coverage_Radius of 500 meters.
2. WHERE a Course_Place has the toilet badge, THE Restroom_Coverage_Service SHALL report the Course_Place itself as its Accessible_Restroom source with a distance of 0 meters.
3. WHERE a Course_Place does not have the toilet badge, THE Restroom_Coverage_Service SHALL search for a separate Accessible_Restroom within a Coverage_Radius of 500 meters of that Course_Place, and SHALL select the Accessible_Restroom with the shortest straight-line distance, breaking ties by the alphabetically first name.
4. WHEN an Accessible_Restroom is identified for a Course_Place, THE System SHALL display the Accessible_Restroom name and its distance from the Course_Place in meters rounded to the nearest 10 meters.
5. IF no Accessible_Restroom is found within the Coverage_Radius of 500 meters of a Course_Place, THEN THE System SHALL display a notice that no verified accessible restroom was found near that Course_Place.
6. WHEN the Restroom_Coverage_Service reports an Accessible_Restroom, THE Restroom_Coverage_Service SHALL include the restroom latitude and longitude so that the Map_View can render its location.

### Requirement 8: 화장실 데이터 공백 지역 보강

**User Story:** 여행자로서, 나는 어느 지역을 선택하든 접근 가능한 화장실 정보를 볼 수 있길 원한다. 그래야 지역에 관계없이 일관된 화장실 안내를 받을 수 있다.

#### Acceptance Criteria

1. THE System SHALL ensure that each supported Region has at least 1 place with the toilet badge in the Place_Store.
2. WHEN the Badge_Service evaluates a place restroom field, THE Badge_Service SHALL assign the toilet badge only when the field contains at least 1 positive restroom indicator and contains 0 negative restroom indicators.
3. WHERE a Region has fewer than 3 Accessible_Restroom records in the Place_Store, THE System SHALL supplement that Region with additional Accessible_Restroom records from an external accessible-restroom data source until the Region has at least 3 Accessible_Restroom records or the external data source has no more records for that Region.
4. WHEN supplemental Accessible_Restroom records are added to a Region, THE System SHALL store the name, latitude, longitude, and Region identifier for each supplemental record.
5. IF a supplemental Accessible_Restroom record is missing a name, a latitude, or a longitude, THEN THE System SHALL exclude that record from the Place_Store and SHALL log an exclusion indication identifying the offending record.
6. IF the external accessible-restroom data source is unavailable, THEN THE System SHALL retain the existing Accessible_Restroom records for that Region and SHALL NOT block Place_Store loading.

### Requirement 9: 신뢰성과 실패 처리

**User Story:** 여행자로서, 나는 외부 서비스에 문제가 있어도 앱이 멈추지 않고 안내를 계속 제공하길 원한다. 그래야 실제 여행 중에도 의존할 수 있다.

#### Acceptance Criteria

1. IF an external routing service request fails, THEN THE System SHALL return a response within a 10 second timeout and SHALL provide a Fallback_Route or an error notice.
2. IF the real-time low-floor bus information request fails, THEN THE Route_Service SHALL return the Transit_Route without low-floor information and SHALL NOT block the route response.
3. WHEN a route calculation cannot produce any path between two waypoints, THE System SHALL display a message that identifies which segment could not be routed.
4. THE System SHALL treat a positive accessibility judgment conservatively, and THE Badge_Service SHALL omit an accessibility badge when the source field contains any negative indicator.
