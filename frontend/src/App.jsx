import { useEffect, useMemo, useRef, useState } from 'react'
import MapView from './MapView'
import ChatPanel from './ChatPanel'
import RouteSteps from './RouteSteps'
import { PersonaSurvey, CardDeck } from './PersonaDeck'
import Landing from './Landing'
import { Logo, BadgeIcon } from './Icons'
import { fetchAllPlaces, fetchPlaceDetail, postChat, postRoute, postRestroomCoverage, postOnboard, resolvePlace, BADGE_LABELS } from './api'
import { validDepartures, recognizeDeparture } from './departures'
import './App.css'

// 지역 레지스트리 — ready 지역은 실데이터(덤프) 서빙, 나머지는 답정너 안내 후 전환 유도.
// 채팅에서 keywords가 감지되면 해당 지역으로 자동 연결된다.
// 각 지역은 정확히 2개의 고정 출발지(departures)를 가진다 (10개 지역 × 2 = 20개).
// type ∈ {지하철역, 버스터미널, 주차장}. 지하철 운행 지역(서울·부산·대구·인천·수원)은 ≥1 지하철역.
// 지하철 미운행 지역(경주·전주·강릉·여수·제주)은 버스터미널/주차장만 사용
// (강릉역·여수엑스포역은 KTX 철도 터미널이지만 도시철도가 아니므로 고정 enum상 '버스터미널'로 표기).
// 모든 좌표는 해당 지역 bbox 내부에 위치한다.
// origin getter는 departures[0]을 가리켜 기존 호출부(getOrigin, r.origin)와 하위 호환을 유지한다.
const REGIONS = [
  { id: 'seoul', name: '서울 · 경복궁 일대', ready: true,
    center: { lat: 37.5788, lng: 126.977 }, bbox: [37.4, 37.7, 126.8, 127.2],
    departures: [
      { name: '광화문역', lat: 37.5717, lng: 126.9769, type: '지하철역', aliases: ['광화문'] },
      { name: '서울역', lat: 37.5547, lng: 126.9706, type: '지하철역', aliases: ['서울역'] },
      { name: '시청역', lat: 37.5657, lng: 126.9769, type: '지하철역', aliases: ['시청', '서울시청'] },
      { name: '종로3가역', lat: 37.5714, lng: 126.9917, type: '지하철역', aliases: ['종로', '종로3가'] },
    ],
    get origin() { return this.departures[0] },
    keywords: ['서울', '경복궁', '광화문', '종로', '북촌', '덕수궁', '인사동'] },
  { id: 'gyeongju', name: '경주 · 대릉원', ready: true,
    center: { lat: 35.837, lng: 129.216 }, bbox: [35.65, 36.05, 129.0, 129.45],
    departures: [
      { name: '경주시외버스터미널', lat: 35.8419, lng: 129.2089, type: '버스터미널', aliases: ['경주터미널', '시외버스터미널'] },
      { name: '대릉원 공영주차장', lat: 35.8365, lng: 129.2095, type: '주차장', aliases: ['대릉원'] },
      { name: '경주고속버스터미널', lat: 35.8442, lng: 129.2095, type: '버스터미널', aliases: ['고속버스터미널'] },
    ],
    get origin() { return this.departures[0] },
    keywords: ['경주', '대릉원', '첨성대', '불국사', '황리단길', '동궁'] },
  { id: 'busan', name: '부산 · 해운대', ready: true,
    center: { lat: 35.1587, lng: 129.1604 }, bbox: [35.05, 35.28, 129.05, 129.30],
    departures: [
      { name: '해운대역', lat: 35.1637, lng: 129.1586, type: '지하철역', aliases: ['해운대'] },
      { name: '센텀시티역', lat: 35.1691, lng: 129.1305, type: '지하철역', aliases: ['센텀', '센텀시티'] },
      { name: '벡스코역', lat: 35.1690, lng: 129.1349, type: '지하철역', aliases: ['벡스코'] },
    ],
    get origin() { return this.departures[0] },
    keywords: ['부산', '해운대', '광안리'],
    canned: '부산은 해운대 무장애 해변 산책로와 영화의전당 일대가 휠체어 접근성이 좋기로 알려져 있어요.' },
  { id: 'jeonju', name: '전주 · 한옥마을', ready: true,
    center: { lat: 35.8143, lng: 127.1524 }, bbox: [35.70, 35.92, 127.05, 127.28],
    departures: [
      { name: '한옥마을 공영주차장', lat: 35.8172, lng: 127.1479, type: '주차장', aliases: ['한옥마을'] },
      { name: '전주고속버스터미널', lat: 35.8253, lng: 127.1447, type: '버스터미널', aliases: ['전주터미널', '고속버스터미널'] },
      { name: '전주시외버스터미널', lat: 35.8245, lng: 127.1440, type: '버스터미널', aliases: ['시외버스터미널'] },
    ],
    get origin() { return this.departures[0] },
    keywords: ['전주', '한옥마을'],
    canned: '전주 한옥마을은 경기전 앞 큰길과 태조로 구간이 비교적 평탄해 이동약자 여행 수요가 많은 곳이에요.' },
  { id: 'gangneung', name: '강릉 · 경포', ready: true,
    center: { lat: 37.7956, lng: 128.8961 }, bbox: [37.68, 37.92, 128.78, 129.02],
    departures: [
      { name: '강릉역', lat: 37.7638, lng: 128.8994, type: '버스터미널', aliases: ['강릉역'] },
      { name: '강릉시외버스터미널', lat: 37.7639, lng: 128.8967, type: '버스터미널', aliases: ['시외버스터미널', '강릉터미널'] },
      { name: '경포해변 주차장', lat: 37.7956, lng: 128.8961, type: '주차장', aliases: ['경포', '경포해변'] },
    ],
    get origin() { return this.departures[0] },
    keywords: ['강릉', '경포', '안목'] },
  { id: 'yeosu', name: '여수 · 오동도', ready: true,
    center: { lat: 34.7406, lng: 127.7669 }, bbox: [34.63, 34.87, 127.63, 127.87],
    departures: [
      { name: '여수엑스포역', lat: 34.7526, lng: 127.748, type: '버스터미널', aliases: ['엑스포', '여수엑스포'] },
      { name: '여수종합버스터미널', lat: 34.7607, lng: 127.6622, type: '버스터미널', aliases: ['여수터미널', '종합버스터미널'] },
      { name: '이순신광장 공영주차장', lat: 34.7377, lng: 127.7419, type: '주차장', aliases: ['이순신광장'] },
    ],
    get origin() { return this.departures[0] },
    keywords: ['여수', '오동도', '낭만포차'] },
  { id: 'jeju', name: '제주 · 제주시', ready: true,
    center: { lat: 33.5138, lng: 126.5219 }, bbox: [33.4, 33.62, 126.38, 126.67],
    departures: [
      { name: '제주버스터미널', lat: 33.4996, lng: 126.5145, type: '버스터미널', aliases: ['제주터미널', '버스터미널'] },
      { name: '제주국제공항 주차장', lat: 33.5104, lng: 126.4914, type: '주차장', aliases: ['제주공항', '공항'] },
      { name: '동문시장 공영주차장', lat: 33.5127, lng: 126.5270, type: '주차장', aliases: ['동문시장'] },
    ],
    get origin() { return this.departures[0] },
    keywords: ['제주', '용두암', '동문시장'] },
  { id: 'suwon', name: '수원 · 화성', ready: true,
    center: { lat: 37.2818, lng: 127.0137 }, bbox: [37.2, 37.36, 126.93, 127.1],
    departures: [
      { name: '팔달문', lat: 37.278, lng: 127.0163, type: '주차장', aliases: ['팔달문', '행궁', '화성행궁'] },
      { name: '수원역', lat: 37.2656, lng: 127.0006, type: '지하철역', aliases: ['수원역'] },
      { name: '화서역', lat: 37.2857, lng: 126.9967, type: '지하철역', aliases: ['화서'] },
    ],
    get origin() { return this.departures[0] },
    keywords: ['수원', '화성행궁', '행궁'] },
  { id: 'incheon', name: '인천 · 개항장', ready: true,
    center: { lat: 37.4736, lng: 126.6216 }, bbox: [37.4, 37.55, 126.55, 126.72],
    departures: [
      { name: '인천역', lat: 37.4766, lng: 126.6169, type: '지하철역', aliases: ['인천역', '차이나타운'] },
      { name: '동인천역', lat: 37.4735, lng: 126.6323, type: '지하철역', aliases: ['동인천'] },
      { name: '월미도 주차장', lat: 37.4757, lng: 126.5977, type: '주차장', aliases: ['월미도'] },
    ],
    get origin() { return this.departures[0] },
    keywords: ['인천', '개항장', '월미도', '차이나타운'] },
  { id: 'daegu', name: '대구 · 근대골목', ready: true,
    center: { lat: 35.866, lng: 128.595 }, bbox: [35.8, 35.94, 128.52, 128.68],
    departures: [
      { name: '반월당역', lat: 35.8659, lng: 128.5934, type: '지하철역', aliases: ['반월당'] },
      { name: '동대구역', lat: 35.8797, lng: 128.6285, type: '지하철역', aliases: ['동대구'] },
      { name: '중앙로역', lat: 35.8703, lng: 128.5952, type: '지하철역', aliases: ['중앙로', '동성로'] },
    ],
    get origin() { return this.departures[0] },
    keywords: ['대구', '근대골목', '김광석', '동성로'] },
]

const detectRegion = (text) =>
  REGIONS.find((r) => r.keywords?.some((k) => text.includes(k)))
const readyNames = () => REGIONS.filter((r) => r.ready).map((r) => r.name.split(' ·')[0]).join('·')
const distKm = (a, b) => Math.hypot((a.lat - b.lat) * 111, (a.lng - b.lng) * 88)

// 담은 장소들을 가까운 순서로 자동 정렬 (최근접 이웃)
function optimizeOrder(items, center) {
  if (items.length <= 2) return items
  const start = items.reduce((s, p) => (distKm(p.place, center) < distKm(s.place, center) ? p : s))
  const order = [start]
  const rest = new Set(items.filter((i) => i !== start))
  while (rest.size) {
    const cur = order[order.length - 1]
    let best = null
    for (const p of rest) if (!best || distKm(p.place, cur.place) < distKm(best.place, cur.place)) best = p
    order.push(best)
    rest.delete(best)
  }
  return order
}

const fmt = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${m}m`)

// 경로 설명은 LLM이 아니라 Tmap·표고 실데이터에서 생성 — 계단 수·거리·경사가 100% 사실
function routeSummary(r, course) {
  // 픽스처(데모 경로)면 요청한 코스와 무관하다. 구간별 수치를 읊으면 전부 거짓말이 된다.
  if (r.fallback) {
    return '⚠️ 경로 서버에 연결하지 못해 실제 경로를 확인하지 못했어요.\n' +
      '왼쪽에 표시된 건 미리 저장해둔 데모 경로(수원 화성)이며, 담으신 코스의 실제 ' +
      '거리·계단·경사가 아닙니다. 잠시 후 다시 시도해주세요.'
  }
  const mark = { 쉬움: '[쉬움]', 중간: '[중간]', 어려움: '[어려움]' }
  const min = (s) => `${Math.max(1, Math.round(s / 60))}분`
  const legs = r.legs.map((l, i) => {
    const why = l.reasons?.length ? ` — ${l.reasons.join(', ')}` : ''
    return `${i + 1}. ${course[i].place.title} → ${course[i + 1].place.title}: ` +
      `${fmt(l.distance)}·${min(l.duration)} ${mark[l.difficulty]}${why}`
  })
  const head =
    `이동 경로를 확인했어요. 총 도보 ${fmt(r.totalDistance)} · ${min(r.totalDuration)}\n` +
    `이동 난이도: ${r.difficulty}` +
    (r.reasons?.length ? ` (${r.reasons.join(' · ')})` : '')
  // 경사를 모르는 이유가 둘이다. 경로 탐색 실패를 표고 탓으로 돌리면 진짜 원인을 가린다.
  const slope = r.slope
    ? `\n지형 경사: 최대 ${r.slope.maxGrade}% · 누적 오르막 ${r.slope.ascent}m` +
      (r.slope.maxGrade >= 5 ? ' → 경사 회피를 켜면 더 완만한 길을 찾아볼게요.' : '')
    : r.legs.some((l) => l.fallback)
      ? '\n⚠️ 경로를 찾지 못해 직선으로 표시했어요 — 실제 보행로가 아니라 경사도 확인할 수 없습니다.'
      : '\n지형 표고를 가져오지 못해 경사는 확인하지 못했어요.'
  const stairs = r.legs.some((l) => l.stairsPossible)
    ? '\n⚠️ 일부 구간에 계단이 있을 수 있어요. 왼쪽 경로 안내에서 우회 지점을 확인하세요.'
    : '\n✅ 전 구간 계단 회피 경로입니다.'
  return `${head}\n${legs.join('\n')}${slope}${stairs}`
}

// 경사 회피 결과 보고 — 나빠진 것(늘어난 거리·난이도)도 숨기지 않는다.
function slopeSummary(r, on) {
  if (!on) return '경사 회피를 껐어요. 최단 경로로 되돌립니다.'
  if (!r.slope) {
    return r.legs.some((l) => l.fallback)
      ? '경사 회피를 켰지만 경로 탐색이 안 돼 우회로를 찾지 못했어요. (표고가 아니라 경로 문제예요)'
      : '경사 회피를 켰지만 지형 표고를 가져오지 못해 경사를 확인할 수 없었어요.'
  }
  if (!r.baseline) {
    return r.slope.maxGrade < 5
      ? `이미 완만한 경로예요 (최대 경사 ${r.slope.maxGrade}%). 우회 없이 그대로 갑니다.`
      : '우회로를 찾아봤지만 거리만 늘고 경사는 나아지지 않아 원래 경로를 유지했어요.'
  }
  const b = r.baseline
  return `경사 회피를 적용했어요 — ${b.detourLegs}개 구간을 우회합니다.\n` +
    `최대 경사 ${b.maxGrade}% → ${r.slope.maxGrade}% · 급경사 ${fmt(b.steepDist)} → ${fmt(r.slope.steepDist)}\n` +
    `대신 도보가 ${fmt(b.totalDistance)} → ${fmt(r.totalDistance)}로 늘어요. ` +
    `난이도: ${b.difficulty} → ${r.difficulty}`
}

const GREETING = {
  role: 'assistant',
  content:
    '안녕하세요! 이동약자를 위한 무장애 여행 플래너 "편해질지도"입니다.\n' +
    '어디로, 어떤 조건으로 여행하고 싶으신가요? 전국 10개 지역(서울·경주·부산·전주·강릉·여수·제주·수원·인천·대구)을 지원해요.\n' +
    '예: "휠체어로 반나절 코스", "유모차 가족 코스"처럼 말씀해주세요.',
}

export default function App() {
  const [places, setPlaces] = useState([])
  const [messages, setMessages] = useState([GREETING])
  const [course, setCourse] = useState([])
  const [route, setRoute] = useState(null)
  const [loading, setLoading] = useState(false)
  const [survey, setSurvey] = useState(true) // 랜딩(stage) 통과 후 첫 화면 = 설문
  const [travelMode, setTravelMode] = useState('walk') // walk | transit
  const [deck, setDeck] = useState(null) // [{place, detail}] — 카드 스와이프 후보
  const [persona, setPersona] = useState(null) // {type, badges[], tastes[]}
  const [mapFilter, setMapFilter] = useState(null) // 지도 시설 필터 (badge 키)
  const [region, setRegion] = useState(REGIONS[0]) // 현재 지역 (ready 지역만 진입)
  const [myLoc, setMyLoc] = useState(null) // 사용자가 허용한 실제 위치
  const [routeCourse, setRouteCourse] = useState([]) // 출발지 포함 경로용 코스
  const [awaitRegion, setAwaitRegion] = useState(false) // (폴백) 채팅으로 지역 받기
  const [awaitOnboard, setAwaitOnboard] = useState(false) // 설문 직후: 출발지 한 번에 받기 (Haiku 매칭)
  const [awaitDeparture, setAwaitDeparture] = useState(false) // 지역 선택 후: 채팅으로 출발지 받기
  // 사용자가 지역을 실제로 정한 적이 있나. false인데 검색어에서도 지역을 못 찾으면
  // 조용히 기본값(서울)으로 떨어뜨리지 않고 되묻는다.
  const [regionChosen, setRegionChosen] = useState(false)
  const [selectedDeparture, setSelectedDeparture] = useState(null) // 사용자가 고른 출발지 (Req 2.2)
  const [restrooms, setRestrooms] = useState([]) // 코스 장소별 화장실 커버리지 결과 (Req 7.1, 7.4, 7.5)
  const [avoidSlope, setAvoidSlope] = useState(false) // 경사 회피 옵션
  const [slopeBusy, setSlopeBusy] = useState(false) // 우회 재탐색 중
  const [lineMode, setLineMode] = useState('difficulty') // 지도 경로선 색 기준: 난이도 | 경사
  const [stage, setStage] = useState('title') // title | app — 타이틀 페이지에서 시작하기로 진입
  const [sheetOpen, setSheetOpen] = useState(true) // 모바일 바텀시트 펼침 상태
  const [routeBusy, setRouteBusy] = useState(null) // 경로 탐색 중 오버레이 문구 (null = 없음)
  // 이 코스에 대중교통 경로가 없음이 확인됨 — 도보와 똑같은 경로가 점선으로만 바뀌는
  // 혼란을 막기 위해 버튼을 비활성화한다. 코스가 바뀌면 다시 알 수 없으므로 리셋.
  const [transitUnavailable, setTransitUnavailable] = useState(false)
  // 온보딩 핸들러가 출발지 설정+경로 생성을 직접 처리하는 동안 selectedDeparture 이펙트를
  // 건너뛰기 위한 플래그 (상태는 같은 배치에서 커밋돼 구분 불가 — ref여야 함)
  const onboardRouting = useRef(false)
  // 경로 요청 토큰 — 늦게 도착한 이전 요청의 응답이 최신 경로를 덮어쓰지 않게 한다
  const routeReq = useRef(0)

  // 출발지 우선순위 (Req 2.2): 선택 출발지 > 내 위치(지역 안) > 유효 departures[0] > r.origin
  // 유효성 검증(validDepartures)을 통과한 출발지만 사용한다 (Req 1.6).
  // 선택 출발지도 해당 지역 bbox 안일 때만 인정 — 지역 전환 직후 stale 클로저로
  // 이전 지역 출발지(예: 서울 광화문)가 부산 코스의 출발점이 되는 사고를 막는다.
  const inBbox = (p, r) => p && p.lat >= r.bbox[0] && p.lat <= r.bbox[1] &&
    p.lng >= r.bbox[2] && p.lng <= r.bbox[3]
  const getOrigin = (r) => {
    if (inBbox(selectedDeparture, r)) return selectedDeparture
    if (inBbox(myLoc, r)) return myLoc
    const valid = validDepartures(r)
    return valid[0] || r.origin
  }

  const locateMe = () => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { name: '내 위치', lat: pos.coords.latitude, lng: pos.coords.longitude }
        setMyLoc(loc)
        const inside = loc.lat >= region.bbox[0] && loc.lat <= region.bbox[1] &&
                       loc.lng >= region.bbox[2] && loc.lng <= region.bbox[3]
        setMessages((m) => [...m, {
          role: 'assistant',
          content: inside
            ? '출발지를 내 위치로 설정했어요. 이제 코스가 현재 위치에서 시작합니다.'
            : `현재 위치가 ${region.name.split(' ·')[0]} 밖이라, 이 지역에서는 ${region.origin.name} 출발 기준으로 안내해요. (내 위치가 포함된 지역에서는 자동으로 내 위치 출발)`,
        }])
      },
      () => setMessages((m) => [...m, { role: 'assistant', content: '위치 권한을 확인할 수 없어 지역 거점 출발로 안내해요.' }]),
    )
  }

  // 경사 회피 토글 → 같은 코스를 다시 탐색. 실패하면 토글을 되돌린다 —
  // 화면은 "회피 ON"인데 경로는 회피 전인 상태가 이 앱에서 가장 위험한 거짓말이다.
  // 현재 이동 모드(도보/대중교통)를 유지한 채 재탐색한다.
  const handleAvoidSlope = async (next) => {
    const rc = routeCourse.length ? routeCourse : course
    if (rc.length < 2) { setAvoidSlope(next); return }
    setAvoidSlope(next)
    setSlopeBusy(true)
    try {
      const r = await loadRoute(rc, travelMode, next)
      setMessages((m) => [...m, { role: 'assistant', content: slopeSummary(r, next) }])
    } catch {
      setAvoidSlope(!next)
      setMessages((m) => [...m, { role: 'assistant', content: '⚠️ 경로를 다시 찾지 못했어요. 이전 경로를 유지합니다.' }])
    } finally {
      setSlopeBusy(false)
    }
  }

  const placeById = useMemo(
    () => Object.fromEntries(places.map((p) => [p.contentId, p])),
    [places],
  )

  // 시설 필터 칩에 표시할 배지별 개수 — "적게 나오는 게 버그"라는 오해를 없앤다
  const badgeCounts = useMemo(() => {
    const c = {}
    for (const p of places) for (const b of p.badges || []) c[b] = (c[b] || 0) + 1
    return c
  }, [places])

  // 새 경로가 도착하면 모바일 시트를 접어 지도를 크게 보여준다.
  // 요약·핵심 토글(도보/대중교통·경사회피)은 접힌 시트의 퀵바에 항상 노출된다.
  useEffect(() => { if (route) setSheetOpen(false) }, [route])

  // 코스가 바뀌면 대중교통 가용 여부는 다시 알 수 없다
  useEffect(() => { setTransitUnavailable(false) }, [course])

  const loadRoute = async (resolved, mode = travelMode, avoid = avoidSlope) => {
    const token = ++routeReq.current
    setRouteBusy(
      mode === 'transit' ? '대중교통 경로를 검색하는 중입니다…'
        : avoid ? '경사가 완만한 경로를 찾는 중입니다…'
          : '도보 경로를 검색하는 중입니다…',
    )
    try {
      const r = await postRoute(
        resolved.map((c) => ({ lat: c.place.lat, lng: c.place.lng, name: c.place.title })),
        mode, avoid,
      )
      // 더 최신 요청이 이미 나갔다면 이 응답은 버린다 (늦은 응답이 최신 경로를 덮어쓰는 레이스 방지)
      if (token === routeReq.current) setRoute(r)
      return r
    } finally {
      if (token === routeReq.current) setRouteBusy(null)
    }
  }

  // 코스 장소별 화장실 커버리지 조회 (Req 7.1, 7.4, 7.5)
  // 실패해도 코스 생성을 막지 않는다 — 조용히 비우고 넘어간다.
  const loadRestrooms = async (resolved) => {
    try {
      const places = resolved
        .filter((c) => c.place && c.place.contentId !== '__origin')
        .map((c) => ({
          contentId: c.place.contentId,
          lat: c.place.lat,
          lng: c.place.lng,
          badges: c.place.badges || [],
        }))
      if (!places.length) { setRestrooms([]); return }
      const res = await postRestroomCoverage(places)
      setRestrooms(res.items || [])
    } catch {
      setRestrooms([])
    }
  }

  // 도보만 ↔ 대중교통 포함 전환 (Req 6.1~6.4)
  // - 현재 출발지/코스로 재계산 (Req 6.2): 출발지 포함 코스(routeCourse) 우선
  // - 재계산 중 토글 비활성화: 버튼이 disabled={loading}로 이미 처리 (Req 6.3)
  // - 실패 시 에러 메시지 + 이전 경로 유지 (Req 6.4): 성공했을 때만 setTravelMode를 호출하고
  //   loadRoute는 await(postRoute) 성공 이후에만 setRoute하므로, 실패하면 이전 경로와
  //   이전 모드가 그대로 유지된다(잘못된 값으로 덮어쓰지 않음).
  const switchMode = async (mode) => {
    if (mode === travelMode) return
    const target = routeCourse.length ? routeCourse : course
    if (target.length < 2) {
      // 재계산할 경로가 없으면(표시된 route 없음) 모드 표시만 전환한다.
      setTravelMode(mode)
      return
    }
    setLoading(true)
    try {
      const r = await loadRoute(target, mode)
      // 대중교통을 요청했는데 실제 탑승 구간이 하나도 없으면(전 구간 도보 권장 거리
      // 또는 노선 없음) 도보 모드를 유지하고 버튼을 비활성화한다 — 도보와 똑같은
      // 경로가 '대중교통'으로 표시되는 혼란 방지.
      if (mode === 'transit' && r.legs.every((l) => l.mode !== 'transit')) {
        setTransitUnavailable(true)
        setMessages((m) => [...m, { role: 'assistant', content:
          '이 코스에는 이용할 만한 대중교통이 없어요. 구간이 짧아 도보가 더 빠르거나 ' +
          '탑승 가능한 노선을 찾지 못했습니다 — 도보 경로로 계속 안내할게요.' }])
        return
      }
      // 재계산이 성공한 뒤에만 모드를 전환해 UI 모드가 실제 표시 경로와 일치하도록 한다.
      setTravelMode(mode)
      setMessages((m) => [...m, { role: 'assistant', content: routeSummary(r, target) }])
    } catch {
      // 이전 travelMode와 이전 route를 그대로 유지한다 (setTravelMode/setRoute 미호출).
      setMessages((m) => [...m, { role: 'assistant', content: '⚠️ 경로 조회에 실패했어요. 이전 경로를 유지할게요. 잠시 후 다시 시도해주세요.' }])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAllPlaces(region.bbox).then(setPlaces).catch(() => {
      setMessages((m) => [...m, { role: 'assistant', content: '⚠️ 백엔드 서버에 연결할 수 없습니다. uvicorn이 켜져 있는지 확인해주세요.' }])
    })
  }, [region])

  // 출발지 변경 시 재계산 (Req 2.8, 3.1): 코스가 이미 있으면 첫 waypoint(__origin)를
  // 새 출발지로 교체하고 현재 travelMode로 경로를 다시 계산한다.
  // selectedDeparture에만 의존하므로 내부에서 상태를 바꿔도 무한 루프가 생기지 않는다.
  useEffect(() => {
    if (!selectedDeparture) return
    // 온보딩 핸들러가 이 출발지로 경로 생성까지 직접 처리 중이면 건너뛴다 (이중 계산 방지)
    if (onboardRouting.current) { onboardRouting.current = false; return }
    // 출발지를 제외한 코스 장소 목록 확보 (routeCourse[0]은 __origin)
    const coursePlaces = routeCourse.length >= 2 ? routeCourse.slice(1) : course
    if (coursePlaces.length < 1) return // 코스가 없으면 재계산하지 않음

    const eff = selectedDeparture
    // 이미 같은 출발지로 경로가 구성돼 있으면 재계산하지 않는다
    // (온보딩에서 출발지 설정과 경로 생성을 한 번에 처리한 경우의 중복 방지)
    const cur = routeCourse[0]?.place
    if (cur && cur.contentId === '__origin' && cur.lat === eff.lat && cur.lng === eff.lng) return

    const rc = [
      { place: { contentId: '__origin', title: eff.name, lat: eff.lat, lng: eff.lng, type: 0, badges: [] } },
      ...coursePlaces,
    ]
    setRouteCourse(rc)
    setLoading(true)
    loadRoute(rc, travelMode)
      .then((r) => {
        setMessages((m) => [...m, {
          role: 'assistant',
          content: `출발지를 '${eff.name}'(으)로 바꿔 경로를 다시 계산했어요.\n${routeSummary(r, rc)}`,
        }])
      })
      .catch(() => {
        setMessages((m) => [...m, { role: 'assistant', content: '⚠️ 새 출발지로 경로를 계산하지 못했어요. 잠시 후 다시 시도해주세요.' }])
      })
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDeparture])

  // 지역 전환: 코스·경로·선택 출발지 초기화 + 지도는 MapView가 center prop으로 이동 (Req 2.7)
  const switchRegion = (r) => {
    setRegion(r)
    setRegionChosen(true) // ready 지역으로의 전환은 곧 사용자가 지역을 정한 것
    setCourse([])
    setRoute(null)
    setRouteCourse([])
    setSelectedDeparture(null)
    setRestrooms([])
  }

  const handleSend = async (text) => {
    setMessages((m) => [...m, { role: 'user', content: text }])

    // 온보딩 0단계: 출발지를 한 번에 받는다 — 백엔드 Haiku가 오타·유사어까지 매칭해
    // (예: "재주"→제주) 출발지 기반 프리셋 코스를 바로 만들어준다.
    if (awaitOnboard) {
      setLoading(true)
      // catch 범위는 온보딩 매칭(postOnboard) 실패만 — 매칭 성공 후의 장소/경로 조회
      // 실패는 '온보딩 실패'가 아니므로 확정된 지역·출발지 상태를 되돌리지 않는다.
      let res
      try {
        res = await postOnboard(text)
      } catch {
        // 온보딩 백엔드 실패 → 기존 지역 질문 흐름으로 폴백 (앱은 계속 동작)
        setLoading(false)
        setAwaitOnboard(false)
        setAwaitRegion(true)
        setMessages((m) => [...m, { role: 'assistant', content:
          `일시적인 문제로 기본 방식으로 진행할게요. 어느 지역으로 가시나요? (${readyNames()})` }])
        return
      }
      try {
        if (res.matched && res.departure) {
          setAwaitOnboard(false)
          const rgn = REGIONS.find((r) => r.id === res.departure.region && r.ready) || region
          if (rgn.id !== region.id) switchRegion(rgn)
          setRegionChosen(true)
          const dep = { name: res.departure.name, lat: res.departure.lat, lng: res.departure.lng }
          onboardRouting.current = true // 아래에서 경로 생성까지 직접 하므로 이펙트 중복 계산 방지
          setSelectedDeparture(dep)
          setMessages((m) => [...m, { role: 'assistant', content: res.reply }])

          // 프리셋 코스가 오면 바로 지도에 렌더 + 경로까지 — 실패해도 온보딩 상태는 유지
          try {
            const preset = (res.course || []).sort((a, b) => a.order - b.order)
            if (preset.length >= 2) {
              const pool = Object.fromEntries((await fetchAllPlaces(rgn.bbox)).map((p) => [p.contentId, p]))
              const resolved = preset.map((c) => ({ ...c, place: pool[c.contentId] })).filter((c) => c.place)
              if (resolved.length >= 2) {
                setCourse(resolved)
                loadRestrooms(resolved)
                const rc = [{ place: { contentId: '__origin', title: dep.name, lat: dep.lat, lng: dep.lng, type: 0, badges: [] } }, ...resolved]
                setRouteCourse(rc)
                const r = await loadRoute(rc)
                setMessages((m) => [...m, { role: 'assistant', content: routeSummary(r, rc), course: resolved }])
                return
              }
            }
            // 프리셋이 부족하면 기존 카드덱 흐름으로
            setMessages((m) => [...m, { role: 'assistant', content: '조건에 맞는 후보를 직접 골라볼게요!' }])
            buildDeck(persona, rgn)
          } catch {
            setMessages((m) => [...m, { role: 'assistant', content:
              '⚠️ 경로를 계산하지 못했어요. 잠시 후 다시 시도하거나 원하는 장소를 말씀해주세요.' }])
          }
          return
        }
        if (res.region) {
          // 지역만 인식 → 그 지역 출발지를 물어본다
          const rgn = REGIONS.find((r) => r.id === res.region && r.ready)
          if (rgn) {
            setAwaitOnboard(false)
            setRegionChosen(true)
            if (rgn.id !== region.id) switchRegion(rgn)
            setAwaitDeparture(true)
            const names = validDepartures(rgn).map((d) => d.name).join(', ')
            setMessages((m) => [...m, { role: 'assistant', content:
              `${rgn.name}(으)로 떠나볼게요! 어디서 출발하실래요? 예: ${names}` }])
            return
          }
        }
        setMessages((m) => [...m, { role: 'assistant', content:
          res.reply || '출발지를 못 알아들었어요. 예) 광화문, 해운대역, 팔달문처럼 말씀해주세요.' }])
        return
      } finally {
        setLoading(false)
      }
    }

    // 온보딩 1단계(폴백): 지역명을 채팅으로 받는다. 인식되면 출발지 질문 단계로 넘어간다.
    if (awaitRegion) {
      const r = detectRegion(text)
      if (r?.ready) {
        setAwaitRegion(false)
        setRegionChosen(true)
        if (r.id !== region.id) switchRegion(r)
        setAwaitDeparture(true)
        const names = validDepartures(r).map((d) => d.name).join(', ')
        setMessages((m) => [...m, { role: 'assistant', content:
          `${r.name}(으)로 떠나볼게요! 어디서 출발하실래요?\n출발지를 채팅으로 말씀해주세요. 예: ${names}` }])
        return
      }
      if (r && !r.ready) {
        setMessages((m) => [...m, { role: 'assistant', content: `${r.canned || ''}\n지금 바로 코스를 만들 수 있는 곳: ${readyNames()}. 이 중에서 골라주세요!` }])
        return
      }
      setMessages((m) => [...m, { role: 'assistant', content: `지역 이름을 못 알아들었어요. ${readyNames()} 중에서 말씀해주세요!` }])
      return
    }

    // 온보딩 2단계: 출발지를 채팅으로 받는다. 인식되면 설정 후 후보 카드로 진행한다.
    if (awaitDeparture) {
      // 사용자가 여기서 지역을 다시 말하면 지역 전환 후 다시 출발지를 묻는다.
      const rgn = detectRegion(text)
      if (rgn?.ready && rgn.id !== region.id) {
        switchRegion(rgn)
        const names = validDepartures(rgn).map((d) => d.name).join(', ')
        setMessages((m) => [...m, { role: 'assistant', content:
          `${rgn.name}(으)로 바꿨어요. 어디서 출발하실래요? 예: ${names}` }])
        return
      }
      const rec = recognizeDeparture(text, region)
      if (rec.status === 'single') {
        setAwaitDeparture(false)
        setRegionChosen(true) // 같은 지역에서 출발지만 정한 경우에도 지역 확정으로 취급
        setSelectedDeparture(rec.matches[0])
        setMessages((m) => [...m, { role: 'assistant', content:
          `출발지를 '${rec.matches[0].name}'(으)로 정했어요! 조건에 맞는 후보를 고르고 있어요…` }])
        buildDeck(persona, region)
        return
      }
      if (rec.status === 'multiple') {
        const names = rec.matches.map((d) => d.name).join(', ')
        setMessages((m) => [...m, { role: 'assistant', content: `여러 곳이 매칭돼요: ${names}. 하나만 말씀해주세요.` }])
        return
      }
      // notfound / none — 출발지 목록을 다시 안내
      const names = validDepartures(region).map((d) => d.name).join(', ')
      setMessages((m) => [...m, { role: 'assistant', content:
        `출발지를 못 알아들었어요. 이 중에서 말씀해주세요: ${names}\n(또는 "건너뛰기"라고 하시면 대표 출발지로 진행할게요.)` }])
      // 건너뛰기 지원
      if (/건너|스킵|skip|아무|모르/i.test(text)) {
        setAwaitDeparture(false)
        setRegionChosen(true)
        setMessages((m) => [...m, { role: 'assistant', content: `${region.origin.name} 출발 기준으로 진행할게요!` }])
        buildDeck(persona, region)
      }
      return
    }

    // 사용자가 지역을 먼저 말하면 여기서 연결 (미지원 지역은 답정너 안내)
    const detected = detectRegion(text)
    if (detected && !detected.ready) {
      setMessages((m) => [...m, {
        role: 'assistant',
        content: `${detected.canned}\n지도 기반 맞춤 코스는 지금 ${readyNames()} 지역에서 바로 만들어드릴 수 있어요. 어디부터 가볼까요?`,
        regions: REGIONS.filter((r) => r.ready),
      }])
      return
    }

    // 키워드 목록(REGIONS.keywords)은 지역당 3~7개뿐이라 "남산"·"동백섬"처럼
    // 목록에 없는 장소명은 못 잡는다. 그때는 백엔드가 전 지역 장소명으로 찾아본다.
    let active = detected || region
    if (!detected) {
      const hit = await resolvePlace(text, region.id).catch(() => null)
      const byAnchor = hit?.anchor && REGIONS.find((r) => r.id === hit.region && r.ready)
      if (byAnchor) {
        active = byAnchor
      } else if (!regionChosen) {
        // 지역을 정한 적도 없고 검색어에서도 못 찾았다 → 서울로 떨어뜨리면 뭘 물어도
        // 광화문 코스가 나온다. 모르면 모른다고 하고 되묻는다.
        setMessages((m) => [...m, {
          role: 'assistant',
          content: '어느 지역인지 알 수 없어 아직 코스를 만들지 못했어요. 지역을 알려주시면 바로 찾아드릴게요!',
          regions: REGIONS.filter((r) => r.ready),
        }])
        return
      }
    }
    if (active.id !== region.id) {
      switchRegion(active)
      setMessages((m) => [...m, { role: 'assistant', content: `${active.name}(으)로 안내할게요!` }])
    }
    setRegionChosen(true)

    // 채팅 기반 출발지 인식 (Req 3, 4) — 지역 전환 후 활성 지역 기준으로 인식한다.
    const rec = recognizeDeparture(text, active)
    if (rec.status === 'single') {
      setSelectedDeparture(rec.matches[0])
      setMessages((m) => [...m, { role: 'assistant', content: `출발지를 '${rec.matches[0].name}'(으)로 설정했어요.` }])
      return
    }
    if (rec.status === 'multiple') {
      const names = rec.matches.map((d) => d.name).join(', ')
      setMessages((m) => [...m, { role: 'assistant', content: `여러 출발지가 매칭돼요: ${names}. 이 중에서 하나만 말씀해주세요.` }])
      return
    }
    if (rec.status === 'notfound') {
      const names = validDepartures(active).map((d) => d.name).join(', ')
      const head = active.name.split(' ·')[0]
      setMessages((m) => [...m, { role: 'assistant', content: names
        ? `'${head}'에서 고를 수 있는 출발지: ${names}. 이 중에서 말씀해주세요.`
        : `'${head}'에는 등록된 출발지가 없어요.` }])
      return
    }

    setLoading(true)
    setRoute(null)
    try {
      // 페르소나가 있으면 요청에 자동 반영 — 백엔드 후보 필터와 LLM이 함께 활용
      const apiMsg = persona
        ? `${text}\n(여행자 정보: ${persona.type} / 필수 시설: ${persona.badges.map((b) => BADGE_LABELS[b]).join(', ') || '없음'}${persona.tastes.length ? ` / 취향: ${persona.tastes.join(', ')}` : ''})`
        : text
      const res = await postChat(apiMsg, active.id)
      // 백엔드가 실제로 쓴 지역을 따른다 (LLM 실패 시 데모 픽스처는 서울 코스라 서울로 온다)
      const used = REGIONS.find((r) => r.id === res.region) || active
      if (used.id !== active.id) {
        switchRegion(used)
        active = used
      }
      const pool = active.id === region.id && places.length
        ? placeById
        : Object.fromEntries((await fetchAllPlaces(active.bbox)).map((p) => [p.contentId, p]))
      const resolved = (res.course || [])
        .sort((a, b) => a.order - b.order)
        .map((c) => ({ ...c, place: pool[c.contentId] }))
        .filter((c) => c.place)
      setCourse(resolved)
      if (resolved.length) loadRestrooms(resolved)
      else setRestrooms([])
      // 폴백이면 폴백이라고 밝힌다 — 이걸 안 밝혀서 "뭘 검색해도 광화문"으로 보였다
      if (res.fallback) {
        setMessages((m) => [...m, {
          role: 'assistant',
          content: '⚠️ AI 추천이 응답하지 않아 미리 저장해둔 데모 코스(서울 광화문)를 보여드려요. 검색하신 내용이 반영된 결과가 아닙니다.',
        }])
      } else if (res.anchor) {
        // 느슨하게 매칭하므로 기준을 밝혀 오인식을 사용자가 잡을 수 있게 한다
        setMessages((m) => [...m, {
          role: 'assistant',
          content: `'${res.anchor.title}' 주변을 기준으로 후보를 골랐어요. 다른 곳을 찾으시면 장소 이름을 더 정확히 알려주세요.`,
        }])
      }
      setMessages((m) => [...m, { role: 'assistant', content: res.reply, course: resolved.length ? resolved : undefined }])

      if (resolved.length >= 2) {
        const eff = getOrigin(active)
        const rc = [{ place: { contentId: '__origin', title: eff.name, lat: eff.lat, lng: eff.lng, type: 0, badges: [] } }, ...resolved]
        setRouteCourse(rc)
        const r = await loadRoute(rc)
        setMessages((m) => [...m, { role: 'assistant', content: routeSummary(r, rc) }])
      }
    } catch {
      setMessages((m) => [...m, { role: 'assistant', content: '⚠️ 요청 처리 중 오류가 발생했어요. 잠시 후 다시 시도해주세요.' }])
    } finally {
      setLoading(false)
    }
  }

  // 설문(스펙 1단계) 완료 → 첫 질문은 '출발지' 하나로 통일.
  // 출발지만 말하면 Haiku 매칭 → 지역 전환 + 프리셋 코스까지 한 번에 이어진다.
  const handleSurvey = (p) => {
    setSurvey(false)
    setPersona(p)
    setAwaitOnboard(true)
    setMessages((m) => [...m, {
      role: 'assistant',
      content: `${p.type} 조건 확인했어요. 어디서 출발하세요?\n` +
        `출발지 이름만 말씀하시면 코스까지 바로 준비해드릴게요.\n` +
        `예) 광화문 · 해운대역 · 팔달문 · 제주버스터미널 (지역 이름만 말씀하셔도 돼요)`,
    }])
  }

  const handleRegion = (r) => {
    setMessages((m) => [...m, { role: 'user', content: r.name }])
    if (!r.ready) {
      setMessages((m) => [...m, { role: 'assistant', content: `${r.canned || ''}\n지도 코스는 ${readyNames()} 지역에서 바로 만들 수 있어요.` }])
      return
    }
    if (r.id !== region.id) switchRegion(r)
    setRegionChosen(true) // 같은 지역 칩을 다시 눌러도 '지역 확정'으로 취급
    // 지역 선택 후 출발지를 채팅으로 묻는다 (온보딩 흐름 통일)
    setAwaitRegion(false)
    setAwaitDeparture(true)
    const names = validDepartures(r).map((d) => d.name).join(', ')
    setMessages((m) => [...m, { role: 'assistant', content:
      `${r.name}(으)로 떠나볼게요! 어디서 출발하실래요? 예: ${names}` }])
  }

  // 안전지대 필터(2단계): 조건 100% 만족 장소만.
  // '여유롭게'면 앵커(중심에서 가장 가까운 관광지) 반경 700m 클러스터로 묶어
  // 구간을 짧게 만든다 — 쉬움/중간 코스가 실제로 나오는 핵심.
  const buildDeck = async (p, r = region) => {
    const list = await fetchAllPlaces(r.bbox).catch(() => places)
    const center = r.center
    const required = [...new Set([
      ...p.badges,
      ...(p.type.includes('휠체어') ? ['wheelchair'] : []),
    ])]
    const near = (arr) => [...arr].sort((a, b) => distKm(a, center) - distKm(b, center))
    const match = (pl) => required.every((b) => pl.badges.includes(b))
    let tours = near(list.filter((pl) => pl.type === 12 && match(pl)))
    let foods = near(list.filter((pl) => pl.type === 39 && match(pl)))
    if (tours.length + foods.length < 4) { // 조건이 너무 빡빡하면 완화하되 사실대로 알림
      tours = near(list.filter((pl) => pl.type === 12))
      foods = near(list.filter((pl) => pl.type === 39))
      setMessages((m) => [...m, { role: 'assistant', content: '⚠️ 모든 조건을 만족하는 곳이 부족해 일부 조건을 완화한 후보를 보여드려요. 카드의 배지를 꼭 확인해주세요.' }])
    }
    const cafes = near(list.filter((pl) => pl.category === 'cafe' && match(pl)))
    let selT = tours.slice(0, 5), selF = foods.slice(0, 3), selC = cafes.slice(0, 3)
    if (p.pace !== 'full' && tours.length) {
      // 가장 밀집한 클러스터의 앵커 선정 — 700m 안에 조건 만족 장소가 가장 많은
      // 관광지. (중심 최근접 앵커는 주변이 헐거우면 반경이 넓어져 코스가 길어짐)
      let anchor = tours[0], bestCount = -1
      for (const a of tours) {
        const cnt = tours.filter((t) => distKm(t, a) <= 0.7).length +
                    foods.filter((f) => distKm(f, a) <= 0.7).length
        if (cnt > bestCount) { bestCount = cnt; anchor = a }
      }
      for (const km of [0.7, 1.0, 1.4]) {
        const byAnchor = (a, b) => distKm(a, anchor) - distKm(b, anchor)
        selT = tours.filter((pl) => distKm(pl, anchor) <= km).sort(byAnchor).slice(0, 5)
        selF = foods.filter((pl) => distKm(pl, anchor) <= km).sort(byAnchor).slice(0, 3)
        selC = cafes.filter((pl) => distKm(pl, anchor) <= km).sort(byAnchor).slice(0, 3)
        if (selT.length >= 3 && selF.length >= 1) break
      }
    }
    const cand = [...selT, ...selF, ...selC]
    const details = await Promise.all(cand.map((pl) => fetchPlaceDetail(pl.contentId).catch(() => null)))
    const byId = Object.fromEntries(cand.map((pl, i) => [pl.contentId, { place: pl, detail: details[i] }]))
    const groups = [
      { label: '여행지', items: selT.map((pl) => byId[pl.contentId]) },
      { label: '식당', items: selF.map((pl) => byId[pl.contentId]) },
      { label: '카페', items: selC.map((pl) => byId[pl.contentId]) },
    ].filter((g) => g.items.length)
    setDeck(groups)
    setMessages((m) => [...m, {
      role: 'assistant',
      content: `${p.type} 기준, 조건(${required.map((b) => BADGE_LABELS[b] || b).join(', ') || '무장애 인증'})을 만족하는 후보를 여행지 ${selT.length} · 식당 ${selF.length} · 카페 ${selC.length}곳으로 나눠 준비했어요.${p.pace !== 'full' ? ' 짧은 동선이 되도록 서로 가까운 곳만 모았어요.' : ''} 카테고리별로 마음에 드는 곳을 담아보세요!`,
    }])
  }

  // 카드 담기 완료(3단계) → 최근접 순 정렬 + 계단회피 경로(4단계)
  const handleDeckDone = async (picked) => {
    setDeck(null)
    if (picked.length < 2) {
      setMessages((m) => [...m, { role: 'assistant', content: '코스를 만들려면 2곳 이상 담아주세요. 설문부터 다시 시작할 수 있어요.' }])
      return
    }
    const eff = getOrigin(region)
    const ordered = optimizeOrder(picked, eff)
    const resolved = ordered.map((c, i) => ({
      contentId: c.place.contentId, order: i + 1,
      reason: c.place.badges.map((b) => BADGE_LABELS[b]).join(' · ') || '무장애 인증 장소',
      place: c.place,
    }))
    setCourse(resolved)
    loadRestrooms(resolved)
    setMessages((m) => [...m, {
      role: 'assistant',
      content: `담은 ${picked.length}곳을 가까운 순서로 자동 정렬해 코스를 만들었어요. 계단 회피 경로를 확인할게요…`,
      course: resolved,
    }])
    try {
      const rc = [{ place: { contentId: '__origin', title: eff.name, lat: eff.lat, lng: eff.lng, type: 0, badges: [] } }, ...resolved]
      setRouteCourse(rc)
      const r = await loadRoute(rc)
      setMessages((m) => [...m, { role: 'assistant', content: routeSummary(r, rc) }])
    } catch {
      setMessages((m) => [...m, { role: 'assistant', content: '⚠️ 경로 조회에 실패했어요. 잠시 후 다시 시도해주세요.' }])
    }
  }

  // 랜딩(타이틀) — 시연 영상 오프닝. 시작하기를 누르면 설문(온보딩)으로 진입한다.
  // 팀에서 만든 Landing 컴포넌트를 채택 (기존 TitlePage는 제거).
  if (stage === 'title') {
    return <Landing onStart={() => setStage('app')} />
  }

  // 모바일 레이아웃 단계: 온보딩(설문·출발지/지역 입력·카드덱) 동안은 지도가 필요 없다 —
  // 입력 흐름을 풀스크린으로. 코스가 만들어지면 지도가 주인공이 되고 패널은 바텀시트로.
  const onboarding = survey || deck || awaitOnboard || awaitRegion || awaitDeparture
  const sheetSummary = route
    ? `도보 ${fmt(route.totalDistance)} · ${Math.max(1, Math.round(route.totalDuration / 60))}분 · ${route.difficulty}`
    : course.length ? '코스 준비 중…' : '채팅'

  return (
    <div className={`layout ${onboarding ? 'phase-onboard' : 'phase-map'} ${sheetOpen ? 'sheet-open' : 'sheet-closed'}`}>
      {routeBusy && (
        <div className="route-loading" role="status" aria-live="polite">
          <div className="rl-card">
            <span className="rl-spinner" aria-hidden="true" />
            <span>{routeBusy}</span>
          </div>
        </div>
      )}
      <header className="topbar">
        <h1><Logo /> 편해질지도</h1>
        <span className="sub">무장애 관광지 {places.length}곳 · 계단 회피 경로 · AI 코스 추천</span>
        {persona && (
          <button className="persona-pill" onClick={() => setSurvey(true)}
                  title="설문 다시 하기">
            {persona.type} · 필수 {persona.badges.length}개 · 수정
          </button>
        )}
        {/* 경로선 색은 모드마다 뜻이 다르다 — 범례가 같이 안 바뀌면 같은 색이 거짓말을 한다 */}
        <span className="legend">
          <i className="dot tour" /> 관광지 <i className="dot food" /> 음식점 <i className="dot cafe" /> 카페
          {lineMode === 'slope' ? (
            <>
              <i className="line easy" /> 경사 5%↓ <i className="line mid" /> 5~8.3%
              <i className="line hard" /> 8.3%↑ <i className="line unknown" /> 모름
            </>
          ) : (
            <>
              <i className="line easy" /> 쉬움 <i className="line mid" /> 중간 <i className="line hard" /> 어려움
            </>
          )}
        </span>
      </header>
      <aside className="side">
        {/* 모바일 바텀시트 핸들 — 코스가 생긴 뒤(지도 단계)에만 CSS로 노출 */}
        <button className="sheet-handle" type="button"
                aria-expanded={sheetOpen}
                aria-label={sheetOpen ? '패널 접기' : '패널 펼치기'}
                onClick={() => setSheetOpen((o) => !o)}>
          <span className="sheet-grabber" aria-hidden="true" />
          <span className="sheet-summary">{sheetSummary}</span>
          <span className="sheet-arrow" aria-hidden="true">{sheetOpen ? '▾' : '▴'}</span>
        </button>
        {/* 모바일 퀵바 — 시트가 접혀 있어도 핵심 경로 옵션은 바로 조작 가능 */}
        {route && (routeCourse.length || course.length) >= 2 && (
          <div className="route-quickbar" role="group" aria-label="경로 옵션">
            <button className={travelMode === 'walk' ? 'on' : ''} disabled={loading}
                    onClick={() => switchMode('walk')}>도보</button>
            <button className={travelMode === 'transit' ? 'on' : ''}
                    disabled={loading || transitUnavailable}
                    title={transitUnavailable ? '이 코스에는 이용 가능한 대중교통이 없어요' : undefined}
                    onClick={() => switchMode('transit')}>
              {transitUnavailable ? '대중교통 없음' : '대중교통'}
            </button>
            <button className={`qb-slope ${avoidSlope ? 'on' : ''}`} disabled={slopeBusy}
                    aria-pressed={avoidSlope}
                    onClick={() => handleAvoidSlope(!avoidSlope)}>
              {slopeBusy ? '경사회피 적용 중…' : `경사회피 ${avoidSlope ? 'ON' : 'OFF'}`}
            </button>
          </div>
        )}
        {survey && <PersonaSurvey onSubmit={handleSurvey} onClose={() => setSurvey(false)} />}
        {deck && <CardDeck groups={deck} onDone={handleDeckDone} onClose={() => setDeck(null)} />}
        {!survey && !deck && (
          <>
            <button className="persona-cta" onClick={() => setSurvey(true)}>
              설문으로 맞춤 코스 시작하기 <span>이동 조건 → 후보 카드 → 자동 코스</span>
            </button>
            <ChatPanel messages={messages} loading={loading} onSend={handleSend} course={course} onRegion={handleRegion} />
            {(routeCourse.length || course.length) >= 2 && (
              <div className="mode-toggle" role="group" aria-label="이동 방법 선택">
                <button className={travelMode === 'walk' ? 'on' : ''}
                        onClick={() => switchMode('walk')} disabled={loading}>도보만</button>
                <button className={travelMode === 'transit' ? 'on' : ''}
                        onClick={() => switchMode('transit')}
                        disabled={loading || transitUnavailable}
                        title={transitUnavailable ? '이 코스에는 이용 가능한 대중교통이 없어요' : undefined}>
                  {transitUnavailable ? '대중교통 없음' : '대중교통 포함'}
                </button>
              </div>
            )}
            <RouteSteps route={route} course={routeCourse.length ? routeCourse : course} restrooms={restrooms}
                        avoidSlope={avoidSlope} onAvoidSlope={handleAvoidSlope} slopeBusy={slopeBusy} />
          </>
        )}
      </aside>
      <main className="map-wrap">
        <div className="map-filters" role="group" aria-label="시설 필터">
          <button className={!mapFilter ? 'on' : ''} onClick={() => setMapFilter(null)}>
            전체 <b className="cnt">{places.length}</b>
          </button>
          {['wheelchair', 'toilet', 'parking', 'elevator'].map((b) => (
            <button key={b} className={mapFilter === b ? 'on' : ''}
                    onClick={() => setMapFilter(mapFilter === b ? null : b)}>
              <BadgeIcon badge={b} /> {BADGE_LABELS[b]} <b className="cnt">{badgeCounts[b] || 0}</b>
            </button>
          ))}
          <button className={myLoc ? 'on' : ''} onClick={locateMe}>내 위치 출발</button>
        </div>
        {/* 배지는 실사 원문에서 확실히 확인된 곳에만 단다 — 적은 건 버그가 아니라 데이터의 정직함 */}
        {mapFilter && (badgeCounts[mapFilter] || 0) === 0 && (
          <div className="filter-empty" role="status">
            이 지역에서 '{BADGE_LABELS[mapFilter]}'이(가) 확인된 곳이 아직 없어요.
            확실히 검증된 곳에만 배지를 답니다.
          </div>
        )}
        {route && (
          <div className="map-modes" role="group" aria-label="경로선 표시 기준">
            <span className="mm-label">경로선</span>
            {[['difficulty', '난이도'], ['slope', '경사']].map(([m, label]) => (
              <button key={m} className={lineMode === m ? 'on' : ''}
                      aria-pressed={lineMode === m} onClick={() => setLineMode(m)}>
                {label}
              </button>
            ))}
          </div>
        )}
        <MapView
          places={mapFilter ? places.filter((p) => p.badges.includes(mapFilter)) : places}
          course={course} route={route} center={region.center}
          origin={route ? getOrigin(region) : null} lineMode={lineMode}
          hidden={onboarding} activeFilter={mapFilter}
          restrooms={restrooms
            .map((it) => it.restroom)
            .filter((r) => r && !r.isSelf)} />
      </main>
    </div>
  )
}
