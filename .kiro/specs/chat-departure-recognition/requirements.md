# Requirements Document

## Introduction

이 기능은 무장애 여행 플래너 "편해질지도"(barrier-free-travel)의 출발지 기능을 두 방향으로 확장한다.

1. **출발지 다중화**: 현재 각 지역(Region)은 `App.jsx`의 REGIONS에 정확히 2개의 고정 출발지(`departures`)만 가진다. 이를 지역당 N개(2개 이상)의 잘 알려진 출발지(주요 역·터미널·랜드마크)를 등록할 수 있는 구조로 확장한다. 기존 `departures.js`의 `validateDeparture`/`validDepartures`/`departureOptions` 검증 파이프라인과 `DepartureSelector.jsx`의 버튼 선택 UX는 그대로 유지하되, N개 후보를 다룰 수 있게 한다.

2. **채팅 기반 출발지 인식**: 사용자가 채팅에 "광화문역에서 출발", "시청에서 시작할게", "서울역" 같은 문장을 입력하면, 활성 지역의 출발지 후보 중에서 이름/별칭/부분 일치로 해당 출발지를 인식해 경로 출발점(`selectedDeparture`)으로 설정한다. 인식된 출발지는 기존 버튼 기반 선택과 동일한 상태(`selectedDeparture`)를 공유하며, 코스가 있으면 기존 동작(App.jsx의 `selectedDeparture` useEffect)에 따라 경로를 재계산한다.

이 기능은 기존 아키텍처(FastAPI 백엔드 + React/Vite 프론트엔드)를 전제로 하고, 채팅 지역 인식(`detectRegion`)·출발지 검증(`departures.js`)·출발지 선택(`DepartureSelector.jsx`)·출발지 우선순위(`getOrigin`)와 하위 호환을 유지한다. 모든 변경은 기존 흐름에 **추가(additive)** 되는 방식이며, 채팅 인식과 버튼 선택은 공존하고 상태를 동기화한다.

## Glossary

- **System**: barrier-free-travel 애플리케이션 전체(백엔드 + 프론트엔드).
- **Region**: 지원되는 여행 지역(서울, 경주, 부산, 전주, 강릉, 여수, 제주, 수원, 인천, 대구의 10개). `App.jsx`의 REGIONS 항목.
- **Active_Region**: 현재 선택되어 코스·경로의 기준이 되는 Region(`App.jsx`의 `region` 상태).
- **Departure_Registry**: 각 Region의 출발지 목록을 정의하는 데이터 구조(`App.jsx`의 REGIONS 각 항목의 `departures` 배열).
- **Departure_Point**: 하나의 출발지. name, latitude, longitude, type을 가진다. type ∈ {지하철역, 버스터미널, 주차장}(`departures.js`의 DEPARTURE_TYPES).
- **Departure_Alias**: 하나의 Departure_Point를 채팅에서 지칭할 수 있는 대체 표기 문자열 목록(예: "시청" → "시청역", "광화문" → "광화문역").
- **Departure_Selector**: 사용자가 출발지를 버튼으로 선택하는 프론트엔드 UI 구성요소(`DepartureSelector.jsx`).
- **Departure_Recognizer**: 채팅 입력 문자열에서 활성 지역의 Departure_Point를 인식하는 프론트엔드 로직.
- **Selected_Departure**: 현재 선택된 출발지(`App.jsx`의 `selectedDeparture` 상태). 버튼 선택과 채팅 인식이 공유한다.
- **Chat_Message**: 사용자가 ChatPanel(`ChatPanel.jsx`)을 통해 입력한 텍스트, 또는 시스템이 반환하는 응답 텍스트.
- **Region_Detector**: 채팅 입력에서 Region을 keywords로 인식하는 기존 로직(`App.jsx`의 `detectRegion`).
- **Course**: 사용자가 방문할 장소들의 순서 있는 목록(`App.jsx`의 `course`).
- **Origin_Resolver**: 경로 계산에 사용할 출발지를 우선순위로 결정하는 기존 로직(`App.jsx`의 `getOrigin`).
- **Departure_Match**: Departure_Recognizer가 Chat_Message에서 찾아낸 Departure_Point 후보. 0개, 1개, 또는 다수일 수 있다.
- **Normalized_Text**: 매칭을 위해 공백·조사·역/터미널 접미사 편차를 정규화한 문자열.

## Requirements

### Requirement 1: 지역별 다중 출발지 정의

**User Story:** 여행자로서, 나는 한 지역에서 2개보다 많은 잘 알려진 출발지 중에서 고르고 싶다. 그래야 내 실제 출발 지점에 더 가까운 곳에서 여행을 시작할 수 있다.

#### Acceptance Criteria

1. THE Departure_Registry SHALL support a variable number of Departure_Points per Region, with a minimum of 2 Departure_Points for each of the 10 supported Regions.
2. THE Departure_Registry SHALL store, for each Departure_Point, a name of 1 to 60 characters, a latitude in the range -90 to 90, a longitude in the range -180 to 180, and a departure type from the set {지하철역, 버스터미널, 주차장}.
3. THE System SHALL ensure that each Departure_Point latitude falls within the minimum and maximum latitude of its associated Region bounding box, and each Departure_Point longitude falls within the minimum and maximum longitude of its associated Region bounding box.
4. WHERE a Region is served by at least 1 subway line, THE Departure_Registry SHALL include at least 1 Departure_Point of type 지하철역 for that Region.
5. IF a Departure_Point definition is missing a name, has a non-numeric or out-of-range latitude or longitude, or has coordinates outside its Region bounding box, THEN THE System SHALL exclude that Departure_Point from the selectable list and SHALL log an exclusion indication identifying the offending Departure_Point.
6. THE System SHALL resolve the default origin for a Region as the first valid Departure_Point of that Region, preserving the existing origin getter behavior for backward compatibility.

### Requirement 2: 다중 출발지 선택 UI

**User Story:** 여행자로서, 나는 지역의 여러 출발지 후보를 UI에서 보고 그중 하나를 버튼으로 선택하고 싶다. 그래야 지도를 보지 않고도 출발지를 빠르게 고를 수 있다.

#### Acceptance Criteria

1. WHEN a Region is selected, THE Departure_Selector SHALL present the valid Departure_Points defined for that Region as selectable options.
2. THE Departure_Selector SHALL display the name and the departure type of each Departure_Point option.
3. WHERE a Region defines more than a display threshold of Departure_Points, THE Departure_Selector SHALL display the first threshold count of options and SHALL provide a control to reveal the remaining Departure_Points.
4. WHEN a user selects a Departure_Point option, THE System SHALL set that Departure_Point as the Selected_Departure.
5. WHERE the device location falls within the Active_Region bounding box, THE Departure_Selector SHALL offer the device location as an additional origin option alongside the fixed Departure_Points.
6. WHEN a user changes the Active_Region, THE System SHALL clear the previously Selected_Departure.

### Requirement 3: 채팅 기반 출발지 인식

**User Story:** 여행자로서, 나는 채팅에 "광화문역에서 출발", "시청에서 시작할게", "서울역"처럼 출발지를 말하면 시스템이 알아듣길 원한다. 그래야 버튼을 누르지 않고도 대화만으로 출발지를 정할 수 있다.

#### Acceptance Criteria

1. WHEN a user submits a Chat_Message, THE Departure_Recognizer SHALL evaluate the Chat_Message against the Departure_Points of the Active_Region for a Departure_Match.
2. WHEN a Chat_Message contains the full name of exactly 1 Departure_Point of the Active_Region, THE Departure_Recognizer SHALL produce that Departure_Point as the single Departure_Match.
3. WHEN a Chat_Message contains a Departure_Alias or a partial name that maps to exactly 1 Departure_Point of the Active_Region, THE Departure_Recognizer SHALL produce that Departure_Point as the single Departure_Match.
4. THE Departure_Recognizer SHALL derive the Normalized_Text of the Chat_Message and each Departure_Point name by removing surrounding whitespace and by treating a name with a trailing 역, 터미널, or 시청 suffix as equivalent to the same name without that suffix, so that "시청" matches "시청역".
5. WHEN a Departure_Match resolves to exactly 1 Departure_Point, THE System SHALL set that Departure_Point as the Selected_Departure.
6. WHEN the System sets the Selected_Departure from a Departure_Match, THE System SHALL append an assistant Chat_Message confirming the recognized departure name, in the form "출발지를 '<name>'(으)로 설정했어요".
7. WHERE a Chat_Message both matches a Region via the Region_Detector and names a Departure_Point of that detected Region, THE System SHALL switch to the detected Region and THEN evaluate the Departure_Match against that detected Region.

### Requirement 4: 모호성 및 인식 실패 처리

**User Story:** 여행자로서, 나는 내가 말한 출발지가 애매하거나 등록되지 않은 곳일 때 무엇을 골라야 하는지 안내받고 싶다. 그래야 대화가 막히지 않고 계속 진행된다.

#### Acceptance Criteria

1. IF a Chat_Message matches more than 1 Departure_Point of the Active_Region, THEN THE System SHALL NOT set a Selected_Departure and SHALL append an assistant Chat_Message that lists the matched Departure_Point names and requests the user to choose 1.
2. IF a Chat_Message expresses a departure intent but names a place that matches 0 Departure_Points of the Active_Region, THEN THE System SHALL NOT set a Selected_Departure and SHALL append an assistant Chat_Message that lists the available Departure_Point names of the Active_Region.
3. WHEN a Chat_Message contains 0 departure references, THE Departure_Recognizer SHALL produce 0 Departure_Matches and THE System SHALL continue the existing chat handling without changing the Selected_Departure.
4. IF a Chat_Message names a Departure_Point that belongs to a Region other than the Active_Region and does not name the Active_Region, THEN THE System SHALL NOT set a Selected_Departure and SHALL append an assistant Chat_Message indicating that the named departure is not available in the Active_Region.

### Requirement 5: 인식된 출발지와 선택 상태 동기화 및 경로 재계산

**User Story:** 여행자로서, 나는 채팅으로 고른 출발지가 화면의 출발지 선택 상태에도 반영되고, 이미 코스가 있으면 경로가 새 출발지로 다시 계산되길 원한다. 그래야 대화와 화면이 항상 일치한다.

#### Acceptance Criteria

1. WHEN the System sets the Selected_Departure from a Departure_Match, THE Departure_Selector SHALL reflect that Departure_Point as its selected option.
2. WHEN the System sets the Selected_Departure from a Departure_Match, THE Departure_Selector SHALL reflect the same Selected_Departure regardless of whether the selection originated from a Chat_Message or a Departure_Selector button.
3. WHEN the Selected_Departure changes and a Course of at least 1 Course_Place exists, THE System SHALL recalculate the route from the newly Selected_Departure using the current travel mode.
4. WHEN the System recalculates the route after a chat-driven Selected_Departure change, THE System SHALL append an assistant Chat_Message summarizing the recalculated route.
5. IF a route recalculation triggered by a chat-driven Selected_Departure change fails, THEN THE System SHALL append an assistant Chat_Message indicating the failure and SHALL retain the previously displayed route.
6. WHEN the Selected_Departure changes and no Course exists, THE System SHALL retain the Selected_Departure for use as the origin of the next Course without triggering a route calculation.

### Requirement 6: 버튼 선택과의 공존 및 하위 호환

**User Story:** 여행자로서, 나는 채팅 인식과 버튼 선택 중 어느 방식으로 출발지를 고르든 동일하게 동작하길 원한다. 그래야 기존 방식과 새 방식을 자유롭게 섞어 쓸 수 있다.

#### Acceptance Criteria

1. THE System SHALL support both Departure_Point selection via the Departure_Selector buttons and Departure_Point selection via Chat_Message recognition, and both SHALL update the same Selected_Departure state.
2. WHEN a Departure_Point is selected via a Departure_Selector button after being set via a Chat_Message, THE System SHALL replace the Selected_Departure with the button-selected Departure_Point.
3. WHEN a Departure_Point is set via a Chat_Message after being selected via a Departure_Selector button, THE System SHALL replace the Selected_Departure with the chat-recognized Departure_Point.
4. THE Origin_Resolver SHALL continue to resolve the origin using the existing priority order of Selected_Departure, then device location within the Active_Region bounding box, then the first valid Departure_Point, then the Region default origin.
5. WHERE no Departure_Point has been recognized from a Chat_Message and no Departure_Point has been selected via a button, THE System SHALL preserve the existing default origin behavior for route calculation.
