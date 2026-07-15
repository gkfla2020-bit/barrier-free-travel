# 무장애 여행 앱 — 상세 아키텍처 v2 (해커톤 실행판)

팀: BE-A(데이터+Places), BE-B(Route+Chat), FE(Flutter). 발표 T+24 기준.
설계 원칙: "제대로"보다 "돌아가게". 시연 중 외부 의존 최소화, 모든 외부 API에 폴백.

## 1. 시스템 전경

```
┌─ Flutter 앱 (실기기) ─────────────────────────────┐
│  MapScreen ── PlaceSheet ── TripBar ── ChatScreen │
│  flutter_naver_map (NCP Client ID만 앱에 포함)      │
└──────────────┬────────────────────────────────────┘
               │ HTTP (같은 와이파이, http://<노트북IP>:8000)
┌──────────────▼────────────────────────────────────┐
│  FastAPI (노트북, uvicorn --host 0.0.0.0)          │
│                                                   │
│  places 라우터 ←─ seoul_places.json (메모리 상주)   │
│  route  라우터 ←─ Tmap 클라이언트 + 구간 캐시        │
│                  + 표고/경사 산정 + 경사 회피 탐색    │
│  chat   라우터 ←─ 후보필터 → Claude 1회 → 검증      │
│  fixtures/     ←─ 데모 경로·채팅 응답 사전 저장       │
└───────┬──────────────────┬────────────────────────┘
        │ (T+0 덤프 시 1회만) │ (시연 중 실시간)
   TourAPI KorWithService2  Tmap 보행자 API · Claude API
                            · Open-Meteo Elevation (키 불필요)
```

핵심 성질: **시연 중 외부 의존은 Tmap·Claude·Open-Meteo 셋.** 장소 데이터는 덤프 시점 이후 완전 오프라인. 셋 다 폴백이 있어(8절) 발표장 네트워크가 죽어도 데모가 끝까지 간다 — Open-Meteo가 죽으면 경사만 빠지고 나머지 경로 기능은 그대로다.

## 2. 데이터 파이프라인 — `scripts/dump_places.py` (BE-A, T+0)

```
locationBasedList2(종로 중심, radius=3000, contentTypeId=12) ─┐
locationBasedList2(동일, contentTypeId=39) ───────────────────┤
  → contentId 목록 (예상 150~250건)                            │
각 contentId에 대해:                                          │
  detailCommon2  → overview, addr1, firstimage, tel          │
  detailWithTour2 → 접근성 원문 25필드                         │
배지 파서 적용 → seoul_places.json 저장 ◄─────────────────────┘
```

- **반드시 `2` 접미사 오퍼레이션** (`locationBasedList2` 등 — 구명칭은 404)
- 호출량 = 2 + N×2 ≈ 500회 안팎 → 일 1,000회 쿼터 내. **재실행 대비 원본 응답도 `raw/`에 저장** (파서 수정 시 재호출 불필요)
- 페이지네이션: `totalCount` 확인 후 `pageNo` 루프 (`numOfRows=100`)
- T+1 판정: 음식점(39)이 15건 미만이면 radius 5000으로 재덤프

### `seoul_places.json` 스키마 (BE-B·FE의 픽스처이기도 함)

```json
{
  "meta": { "generatedAt": "...", "center": [126.978, 37.576], "radius": 3000,
            "counts": { "12": 60, "39": 25 } },
  "places": [{
    "contentId": "1605981",
    "title": "덕수궁 대한문",
    "type": 12,
    "lat": 37.5651071556, "lng": 126.9765906796,
    "addr": "서울특별시 중구 세종대로 99",
    "image": "http://tong.visitkorea.or.kr/...jpg",
    "overview": "대한문은 덕수궁의 정문으로...",
    "tel": "",
    "badges": ["wheelchair", "toilet", "parking"],
    "accessibilityRaw": {
      "휠체어": "대여가능",
      "출입통로": "주출입구는 턱이 없어 휠체어 접근 가능함",
      "화장실": "장애인 화장실 있음",
      "주차": "장애인 주차장 있음(덕수궁,서울시청,시립미술관 주차장)"
    }
  }]
}
```

`accessibilityRaw`는 값이 있는 필드만, **국문 라벨 키**로 저장 (FE가 그대로 렌더).

## 3. 배지 파서 (BE-A) — 보수적 판정이 원칙

| 배지 | 소스 필드 | 판정 |
|---|---|---|
| `wheelchair` | wheelchair | 긍정 키워드 존재 && 부정 키워드 부재 |
| `elevator` | elevator | 〃 |
| `toilet` | restroom | 〃 |
| `parking` | parking | 〃 |

```python
POSITIVE = ["있음", "가능", "대여", "설치", "완비", "운영"]
NEGATIVE = ["없음", "불가", "어려움", "곤란", "미설치"]  # 부정이 하나라도 있으면 무조건 탈락
```

부정 우선, 빈 값 = 배지 없음(정보 없음 ≠ 불가). 잘못된 "접근 가능" 표시가 치명적인 도메인이므로 **애매하면 배지를 안 다는 쪽으로만 틀린다.** `exit`("턱이 없어") 같은 필드는 배지 소스로 쓰지 않고 원문 노출만 — 4종 계약 고정.

## 4. 백엔드 구조와 소유권

```
backend/
├── scripts/dump_places.py        # BE-A
├── app/
│   ├── main.py                   # 공용 (앱 조립 + CORS, 10줄 이내 유지)
│   ├── core/config.py            # .env 로드 (pydantic-settings)
│   ├── data/seoul_places.json    # BE-A 산출물 (T+1 커밋)
│   ├── fixtures/                 # demo_route.json, demo_chat.json (T+15 생성)
│   ├── routers/                  # places.py(BE-A) route.py chat.py(BE-B)
│   ├── services/
│   │   ├── store.py              # BE-A: JSON 로드, bbox/유형 필터, id 조회
│   │   ├── badges.py             # BE-A: 배지 파서 (덤프 스크립트와 공유)
│   │   ├── tmap.py               # BE-B: 보행자 경로 클라이언트 + 캐시
│   │   └── recommend.py          # BE-B: 후보필터 + Claude 단일 호출 + 검증
│   └── schemas.py                # 공용: API 계약 Pydantic 모델 (T+0 확정 후 동결)
└── .env                          # TOUR_API_KEY, TMAP_APP_KEY, ANTHROPIC_API_KEY (커밋 금지)
```

파일 단위로 담당을 나눠 **머지 충돌 자체가 안 나게** 한다. `schemas.py`와 `main.py`만 공용이고 T+0 이후 안 건드린다.

## 5. 엔드포인트 상세 (계약 고정분의 구현 명세)

### `GET /api/places` — 전부 메모리 연산, 외부 호출 0
bbox(minLat…maxLng) + `type` 필터 → 최대 100건 반환. 지도 이동 시 FE가 debounce 300ms로 호출.

### `GET /api/places/{contentId}` — 외부 호출 0
store에서 그대로 반환. 없으면 404.

### `POST /api/route` (BE-B)

```
waypoints[i] → waypoints[i+1] 쌍마다:
  1. 캐시 확인 (키: 좌표 소수 5자리 반올림 쌍)
  2. Tmap POST /tmap/routes/pedestrian?version=1
     headers: {appKey}, body: startX/Y, endX/Y, startName, endName,
     searchOption=30, reqCoordType=WGS84GEO, resCoordType=WGS84GEO
  3. 실패(HTTP 에러·경로 없음) → searchOption=0 재시도, stairsPossible=true
  4. 응답 파싱:
     - LineString coordinates 이어붙여 polyline [[lat,lng]...]  ※ Tmap은 [경도,위도] 순서 — 뒤집기!
     - Point feature의 description → guides[]
     - SP feature의 totalDistance/totalTime → 구간 거리·시간
     - turnType 127/129 발견 → stairsPossible=true + guides에 "⚠️ 계단 구간" 표기
       (128 경사로, 218 엘리베이터는 정보성 guide로)
```

타임아웃 5초, 재시도 1회. 전 구간 성공 못 하면 실패 구간만 직선 좌표 2점 + `fallback:true`.
폴백 구간은 난이도를 재산정하지 않는다 — 실제 보행로를 모르는데 두 점 사이 표고만 보고
'쉬움'을 매기면 탐색 실패가 '편한 길'로 둔갑한다. `어려움`/`경로 확인 불가` 유지.

#### 표고·경사 (`services/elevation.py`, Open-Meteo Elevation)

```
구간 polyline → 90m 간격 재표본 → Open-Meteo /v1/elevation (100좌표/요청, 키 불필요)
  → maxGrade(최대 기울기) · ascent · steepDist(≥8.33%) · moderateDist(5~8.33%)
  → 난이도에 반영 + 고도 그래프용 samples 반환
```

- **표본 간격 90m는 내리면 안 된다.** DEM(Copernicus GLO-90) 해상도가 90m라 그보다 촘촘히
  찍으면 같은 격자를 반복 조회한다. 실측(남산 오르막): 10m 간격 → 경사 0%(오르막이 평지로
  둔갑), 30m 간격 → 76%/-83% 가짜 절벽. Tmap 폴리라인 꼭짓점(10~20m)을 그대로 쓰면 이 함정에 빠진다.
- 경사 임계는 국내 기준: **5%**=보도 종단경사 권장 상한, **8.33%(1/12)**=장애인등편의법 경사로 최대.
  내리막도 제동 부담이라 절댓값으로 본다.
- 잡는 것은 **지형 경사(언덕·고갯길)**뿐. 연석 턱·짧은 진입 경사로는 90m 평균에 묻혀 안 보인다.
  그래서 turnType 128(경사로 구조물)을 **대체하지 않고 보완**한다 — 둘 다 본다.
- 표고 조회 실패 = `slope: null` → **난이도에서 제외**하고 "경사 정보 없음"을 표기.
  계단·육교(존재는 확인됐고 정도만 모름)는 위험한 쪽으로 판정하지만, 표고 실패는 아무 정보도
  없는 상태라 여기에 '어려움'을 매기면 Open-Meteo 장애 시 전 경로가 어려움이 되어 앱이 죽는다.

#### `avoidSlope: true` — 경사 회피 (더 돌더라도 완만하게)

```
구간별로:
  1. 기본 경로 표고 판정 → maxGrade < 5%면 즉시 종료 (외부 호출 0회)
  2. 직선의 수직 방향 ±120m/±300m에 경유점 후보 4개 생성
  3. 표고가 '출발·도착 중간값에 가까운' 순으로 정렬 → 상위 2개만 Tmap passList로 조회(병렬)
  4. 거리 상한(원경로 1.7배 이내 && +700m 이내) 통과분만 표고 조회 → 비용 비교
  5. 비용 = 거리 + 급경사m×6 + 완경사m×2 + 누적상승m×10
     → 최저 비용이 기본 경로보다 낮을 때만 교체, 아니면 원래 경로 유지
```

- **경유점은 '가장 낮은 곳'이 아니라 '중간 표고에 가까운 곳'을 고른다.** 최저점을 고르면 골짜기로
  내려갔다 다시 올라오는 경로가 나와 오히려 나빠진다(실측: 비용 5706 → 6400). 등고선을 따라가야 한다.
- 후보 생성은 휴리스틱이지만 **채택은 실제 응답 경로의 표고 프로파일로만** 판단한다.
  "돌아갔으니 완만하겠지"라고 가정하지 않는다.
- 응답의 `baseline`(회피 전 거리·난이도·최대경사)을 함께 돌려줘 FE가 **늘어난 거리까지 같이**
  보여준다. 우회가 손해인 경우(4km 초과로 난이도 상승 등)도 숨기지 않는 것이 이 옵션의 계약이다.

### `POST /api/chat` (BE-B) — 단일 호출, 루프 없음

```
1. 후보 필터(코드): store 전체에서 type·배지 조건 추출(요청 문구 키워드: "휠체어"→wheelchair 배지 필수,
   "화장실"→toilet, 지역어 무시—어차피 종로 덤프뿐) → 관광지 15 + 음식점 10,
   각 {contentId, title, type, badges, lat, lng}
2. Claude 1회 호출: model="claude-sonnet-5", max_tokens=1500, timeout 15s
   - 도구 강제(tool_choice)로 recommend_course 툴 1개를 정의해 JSON 스키마를 강제하면
     "JSON 파싱 실패" 리스크가 사라진다 (문자열 파싱보다 이 방법 권장, 구현량 동일)
   - 시스템 프롬프트 규칙: ① 반드시 후보 목록의 contentId만 사용 ② 3~5곳 ③ 인접한 곳끼리 순서 구성
     ④ 각 장소마다 접근성 근거(배지)를 이유에 인용 ⑤ reply는 2~3문장 한국어
3. 검증(코드): course의 contentId가 후보 밖이면 해당 항목 폐기 → 남은 게 2개 미만이면 픽스처 응답
4. 경로는 FE가 받은 course 좌표로 기존 /api/route 재호출 (chat은 경로를 모름 — 결합 차단)
```

## 6. Flutter 앱 구조 (FE)

```
lib/
├── main.dart              # NaverMapSdk.initialize(clientId), API_BASE는 --dart-define
├── api/client.dart        # dio, baseUrl = String.fromEnvironment('API_BASE')
├── models/                # Place, RouteLeg, CourseItem (schemas.py와 1:1)
├── state/                 # Provider+ChangeNotifier 3개: PlacesState / TripState / ChatState
│                          #   (해커톤에서 riverpod/bloc 도입 금지 — 익숙한 최소치로)
└── ui/
    ├── map_screen.dart    # NaverMap + 마커(유형별 아이콘) + 필터 칩 + 카메라 idle시 places 재조회
    ├── place_sheet.dart   # DraggableScrollableSheet: 사진·배지 4종·accessibilityRaw 원문·[담기]
    ├── trip_bar.dart      # 담은 장소 n개 + [경로 보기] → route 호출 → NPolylineOverlay
    │                      #   stairsPossible 구간은 색 구분 + 경고 배너
    ├── chat_screen.dart   # 말풍선 + course 카드 → [지도에 표시] [이 코스 담기]
    └── list_screen.dart   # 지도 대체 리스트 뷰 (접근성 요건, 같은 PlacesState 재사용)
```

- **접근성 최소선**: 모든 탭 타깃 48dp+, 배지는 `Semantics(label: "휠체어 이용 가능")`, 리스트 뷰가 지도와 동일 기능 제공
- **네이버지도 셋업 체크리스트(T+0 최우선, T+2 데드라인)**: NCP 콘솔 Mobile Dynamic Map에 앱 패키지명 등록 → Android `AndroidManifest.xml` meta-data + iOS `Info.plist`에 Client ID → 에뮬레이터 말고 **실기기로 먼저** 확인. 실패 시 `kakao_map_plugin`(웹뷰) 전환은 map_screen만 교체하면 되도록 지도 위젯을 한 파일에 격리

## 7. 로컬 실행 토폴로지

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000     # 노트북
ipconfig getifaddr en0                                # 노트북 IP 확인 → 핫스팟/공유기 IP 고정
flutter run --dart-define=API_BASE=http://192.168.x.x:8000
```

CORS 전체 허용(모바일 앱이라 사실상 무관하나 웹 디버깅 대비), 외부 시연 필요 시 `ngrok http 8000` 후 dart-define만 교체. **발표장에서는 폰 핫스팟에 노트북을 물리는 게 와이파이보다 안정적.**

## 8. 강등(장애) 매트릭스 — "API가 죽어도 앱은 안 죽는다"

| 의존 | 장애 시 동작 | 데모 영향 |
|---|---|---|
| TourAPI | 덤프 이후 아예 안 씀 | 없음 |
| Tmap | 재시도 1회 → **fixtures/demo_route.json**(데모 경로 사전 저장) → 그래도 없으면 직선 폴리라인+안내문 | 데모 시나리오는 무손실 |
| Open-Meteo | `slope: null` → 경사를 난이도에서 빼고 "경사 정보 없음" 표기. 경사 회피 옵션은 우회 없이 원경로 유지 | 경로·계단 회피·난이도(경사 외)는 전부 정상 |
| Claude | 15s 타임아웃 → **fixtures/demo_chat.json**(데모 질문의 실제 응답 저장본) | 데모 질문은 무손실 |
| 백엔드 다운 | FE는 마지막 상태 유지 + 스낵바, 크래시 금지 (모든 api 호출 try-catch) | 재시작 10초 |

**T+15에 데모 시나리오를 실제로 돌려 그 응답을 fixtures로 저장**하는 것까지가 태스크다. 이게 시연 영상보다 강력한 백업이다 — 라이브인 척이 아니라 실제 앱이 뜬다.

## 9. 시크릿 경계

- 백엔드 `.env`: TourAPI·Tmap·Anthropic 키 3종. **레포에 커밋 금지**(.gitignore 등록됨), 팀원 공유는 메신저 1회
- 앱에 들어가는 유일한 키: 네이버 Client ID (NCP 콘솔에서 패키지명 제한 걸려 있어 노출 리스크 낮음)
- 발표자료·깃허브 README에 키 스크린샷 금지

## 10. T+0 팀 결정 사항 (두 개)

1. **덤프 중심좌표**: 경복궁 vs 종로 한복판 — 데모 시나리오("휠체어로 경복궁 근처 반나절 코스")가 경복궁이므로 경복궁 인근 권장
2. **chat의 tool 강제 방식 채택 여부** (권장)
