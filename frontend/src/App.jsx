import { useEffect, useMemo, useState } from 'react'
import MapView from './MapView'
import ChatPanel from './ChatPanel'
import RouteSteps from './RouteSteps'
import { PersonaSurvey, CardDeck } from './PersonaDeck'
import { Logo, BadgeIcon } from './Icons'
import { fetchAllPlaces, fetchPlaceDetail, postChat, postRoute, postRestroomCoverage, BADGE_LABELS } from './api'
import { validDepartures } from './departures'
import DepartureSelector from './DepartureSelector'
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
      { name: '광화문역', lat: 37.5717, lng: 126.9769, type: '지하철역' },
      { name: '서울역', lat: 37.5547, lng: 126.9706, type: '지하철역' },
    ],
    get origin() { return this.departures[0] },
    keywords: ['서울', '경복궁', '광화문', '종로', '북촌', '덕수궁', '인사동'] },
  { id: 'gyeongju', name: '경주 · 대릉원', ready: true,
    center: { lat: 35.837, lng: 129.216 }, bbox: [35.65, 36.05, 129.0, 129.45],
    departures: [
      { name: '경주시외버스터미널', lat: 35.8419, lng: 129.2089, type: '버스터미널' },
      { name: '대릉원 공영주차장', lat: 35.8365, lng: 129.2095, type: '주차장' },
    ],
    get origin() { return this.departures[0] },
    keywords: ['경주', '대릉원', '첨성대', '불국사', '황리단길', '동궁'] },
  { id: 'busan', name: '부산 · 해운대', ready: true,
    center: { lat: 35.1587, lng: 129.1604 }, bbox: [35.05, 35.28, 129.05, 129.30],
    departures: [
      { name: '해운대역', lat: 35.1637, lng: 129.1586, type: '지하철역' },
      { name: '센텀시티역', lat: 35.1691, lng: 129.1305, type: '지하철역' },
    ],
    get origin() { return this.departures[0] },
    keywords: ['부산', '해운대', '광안리'],
    canned: '부산은 해운대 무장애 해변 산책로와 영화의전당 일대가 휠체어 접근성이 좋기로 알려져 있어요.' },
  { id: 'jeonju', name: '전주 · 한옥마을', ready: true,
    center: { lat: 35.8143, lng: 127.1524 }, bbox: [35.70, 35.92, 127.05, 127.28],
    departures: [
      { name: '한옥마을 공영주차장', lat: 35.8172, lng: 127.1479, type: '주차장' },
      { name: '전주고속버스터미널', lat: 35.8253, lng: 127.1447, type: '버스터미널' },
    ],
    get origin() { return this.departures[0] },
    keywords: ['전주', '한옥마을'],
    canned: '전주 한옥마을은 경기전 앞 큰길과 태조로 구간이 비교적 평탄해 이동약자 여행 수요가 많은 곳이에요.' },
  { id: 'gangneung', name: '강릉 · 경포', ready: true,
    center: { lat: 37.7956, lng: 128.8961 }, bbox: [37.68, 37.92, 128.78, 129.02],
    departures: [
      { name: '강릉역', lat: 37.7638, lng: 128.8994, type: '버스터미널' },
      { name: '강릉시외버스터미널', lat: 37.7639, lng: 128.8967, type: '버스터미널' },
    ],
    get origin() { return this.departures[0] },
    keywords: ['강릉', '경포', '안목'] },
  { id: 'yeosu', name: '여수 · 오동도', ready: true,
    center: { lat: 34.7406, lng: 127.7669 }, bbox: [34.63, 34.87, 127.63, 127.87],
    departures: [
      { name: '여수엑스포역', lat: 34.7526, lng: 127.748, type: '버스터미널' },
      { name: '여수종합버스터미널', lat: 34.7607, lng: 127.6622, type: '버스터미널' },
    ],
    get origin() { return this.departures[0] },
    keywords: ['여수', '오동도', '낭만포차'] },
  { id: 'jeju', name: '제주 · 제주시', ready: true,
    center: { lat: 33.5138, lng: 126.5219 }, bbox: [33.4, 33.62, 126.38, 126.67],
    departures: [
      { name: '제주버스터미널', lat: 33.4996, lng: 126.5145, type: '버스터미널' },
      { name: '제주국제공항 주차장', lat: 33.5104, lng: 126.4914, type: '주차장' },
    ],
    get origin() { return this.departures[0] },
    keywords: ['제주', '용두암', '동문시장'] },
  { id: 'suwon', name: '수원 · 화성', ready: true,
    center: { lat: 37.2818, lng: 127.0137 }, bbox: [37.2, 37.36, 126.93, 127.1],
    departures: [
      { name: '팔달문', lat: 37.278, lng: 127.0163, type: '주차장' },
      { name: '수원역', lat: 37.2656, lng: 127.0006, type: '지하철역' },
    ],
    get origin() { return this.departures[0] },
    keywords: ['수원', '화성행궁', '행궁'] },
  { id: 'incheon', name: '인천 · 개항장', ready: true,
    center: { lat: 37.4736, lng: 126.6216 }, bbox: [37.4, 37.55, 126.55, 126.72],
    departures: [
      { name: '인천역', lat: 37.4766, lng: 126.6169, type: '지하철역' },
      { name: '인천종합버스터미널', lat: 37.4419, lng: 126.7009, type: '버스터미널' },
    ],
    get origin() { return this.departures[0] },
    keywords: ['인천', '개항장', '월미도', '차이나타운'] },
  { id: 'daegu', name: '대구 · 근대골목', ready: true,
    center: { lat: 35.866, lng: 128.595 }, bbox: [35.8, 35.94, 128.52, 128.68],
    departures: [
      { name: '반월당역', lat: 35.8659, lng: 128.5934, type: '지하철역' },
      { name: '동대구역', lat: 35.8797, lng: 128.6285, type: '지하철역' },
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

// 경로 설명은 LLM이 아니라 Tmap 실데이터에서 생성 — 계단 수·거리·시간이 100% 사실
function routeSummary(r, course) {
  const mark = { 쉬움: '[쉬움]', 중간: '[중간]', 어려움: '[어려움]' }
  const fmt = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${m}m`)
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
  const stairs = r.legs.some((l) => l.stairsPossible)
    ? '\n⚠️ 일부 구간에 계단이 있을 수 있어요. 왼쪽 경로 안내에서 우회 지점을 확인하세요.'
    : '\n✅ 전 구간 계단 회피 경로입니다.'
  return `${head}\n${legs.join('\n')}${stairs}`
}

const GREETING = {
  role: 'assistant',
  content:
    '안녕하세요! 이동약자를 위한 무장애 여행 플래너 "모두의 여행"입니다.\n' +
    '어디로, 어떤 조건으로 여행하고 싶으신가요? 전국 10개 지역(서울·경주·부산·전주·강릉·여수·제주·수원·인천·대구)을 지원해요.\n' +
    '예: "휠체어로 반나절 코스", "유모차 가족 코스"처럼 말씀해주세요.',
}

export default function App() {
  const [places, setPlaces] = useState([])
  const [messages, setMessages] = useState([GREETING])
  const [course, setCourse] = useState([])
  const [route, setRoute] = useState(null)
  const [loading, setLoading] = useState(false)
  const [survey, setSurvey] = useState(true) // 첫 화면 = 페르소나 설문 (스펙 1단계)
  const [travelMode, setTravelMode] = useState('walk') // walk | transit
  const [deck, setDeck] = useState(null) // [{place, detail}] — 카드 스와이프 후보
  const [persona, setPersona] = useState(null) // {type, badges[], tastes[]}
  const [mapFilter, setMapFilter] = useState(null) // 지도 시설 필터 (badge 키)
  const [region, setRegion] = useState(REGIONS[0]) // 현재 지역 (ready 지역만 진입)
  const [myLoc, setMyLoc] = useState(null) // 사용자가 허용한 실제 위치
  const [routeCourse, setRouteCourse] = useState([]) // 출발지 포함 경로용 코스
  const [awaitRegion, setAwaitRegion] = useState(false) // 설문 직후: 채팅으로 지역 받기
  const [selectedDeparture, setSelectedDeparture] = useState(null) // 사용자가 고른 출발지 (Req 2.2)
  const [restrooms, setRestrooms] = useState([]) // 코스 장소별 화장실 커버리지 결과 (Req 7.1, 7.4, 7.5)

  // 출발지 우선순위 (Req 2.2): 선택 출발지 > 내 위치(지역 안) > 유효 departures[0] > r.origin
  // 유효성 검증(validDepartures)을 통과한 출발지만 사용한다 (Req 1.6).
  const getOrigin = (r) => {
    if (selectedDeparture) return selectedDeparture
    if (myLoc && myLoc.lat >= r.bbox[0] && myLoc.lat <= r.bbox[1] &&
        myLoc.lng >= r.bbox[2] && myLoc.lng <= r.bbox[3]) return myLoc
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

  const placeById = useMemo(
    () => Object.fromEntries(places.map((p) => [p.contentId, p])),
    [places],
  )

  const loadRoute = async (resolved, mode = travelMode) => {
    const r = await postRoute(
      resolved.map((c) => ({ lat: c.place.lat, lng: c.place.lng, name: c.place.title })),
      mode,
    )
    setRoute(r)
    return r
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
    // 출발지를 제외한 코스 장소 목록 확보 (routeCourse[0]은 __origin)
    const coursePlaces = routeCourse.length >= 2 ? routeCourse.slice(1) : course
    if (coursePlaces.length < 1) return // 코스가 없으면 재계산하지 않음

    const eff = selectedDeparture
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
    setCourse([])
    setRoute(null)
    setRouteCourse([])
    setSelectedDeparture(null)
    setRestrooms([])
  }

  const handleSend = async (text) => {
    setMessages((m) => [...m, { role: 'user', content: text }])

    // 설문 직후엔 지역명을 받아 바로 후보 카드로 (목록 없이 채팅 기반)
    if (awaitRegion) {
      const r = detectRegion(text)
      if (r?.ready) {
        setAwaitRegion(false)
        if (r.id !== region.id) switchRegion(r)
        setMessages((m) => [...m, { role: 'assistant', content: `${r.name}(으)로 떠나볼게요! 조건에 맞는 후보를 고르고 있어요…` }])
        buildDeck(persona, r)
        return
      }
      if (r && !r.ready) {
        setMessages((m) => [...m, { role: 'assistant', content: `${r.canned || ''}\n지금 바로 코스를 만들 수 있는 곳: ${readyNames()}. 이 중에서 골라주세요!` }])
        return
      }
      setMessages((m) => [...m, { role: 'assistant', content: `지역 이름을 못 알아들었어요. ${readyNames()} 중에서 말씀해주세요!` }])
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
    const active = detected && detected.id !== region.id ? detected : region
    if (active.id !== region.id) {
      switchRegion(active)
      setMessages((m) => [...m, { role: 'assistant', content: `${active.name}(으)로 안내할게요!` }])
    }

    setLoading(true)
    setRoute(null)
    try {
      // 페르소나가 있으면 요청에 자동 반영 — 백엔드 후보 필터와 LLM이 함께 활용
      const apiMsg = persona
        ? `${text}\n(여행자 정보: ${persona.type} / 필수 시설: ${persona.badges.map((b) => BADGE_LABELS[b]).join(', ') || '없음'}${persona.tastes.length ? ` / 취향: ${persona.tastes.join(', ')}` : ''})`
        : text
      const res = await postChat(apiMsg, active.id)
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

  // 설문(스펙 1단계) 완료 → 채팅에서 지역 질문 (지역 선택 후 후보 필터로 진행)
  const handleSurvey = (p) => {
    setSurvey(false)
    setPersona(p)
    setAwaitRegion(true)
    setMessages((m) => [...m, {
      role: 'assistant',
      content: `${p.type} 조건 확인했어요. 어디로 떠나실까요? 지역 이름을 채팅으로 말씀해주세요.\n예: 서울, 경주, 부산, 전주, 강릉, 여수, 제주, 수원, 인천, 대구`,
    }])
  }

  const handleRegion = (r) => {
    setMessages((m) => [...m, { role: 'user', content: r.name }])
    if (!r.ready) {
      setMessages((m) => [...m, { role: 'assistant', content: `${r.canned || ''}\n지도 코스는 ${readyNames()} 지역에서 바로 만들 수 있어요.` }])
      return
    }
    if (r.id !== region.id) switchRegion(r)
    buildDeck(persona, r)
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
    let selT = tours.slice(0, 5), selF = foods.slice(0, 2)
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
        selF = foods.filter((pl) => distKm(pl, anchor) <= km).sort(byAnchor).slice(0, 2)
        if (selT.length >= 3 && selF.length >= 1) break
      }
    }
    const cand = [...selT, ...selF]
    const details = await Promise.all(cand.map((pl) => fetchPlaceDetail(pl.contentId).catch(() => null)))
    setDeck(cand.map((pl, i) => ({ place: pl, detail: details[i] })))
    setMessages((m) => [...m, {
      role: 'assistant',
      content: `${p.type} 기준, 조건(${required.map((b) => BADGE_LABELS[b] || b).join(', ') || '무장애 인증'})을 만족하는 후보 ${cand.length}곳을 골랐어요.${p.pace !== 'full' ? ' 짧은 동선이 되도록 서로 가까운 곳만 모았어요.' : ''} 카드를 넘기며 마음에 드는 곳을 담아보세요!`,
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

  return (
    <div className="layout">
      <header className="topbar">
        <h1><Logo /> 모두의 여행</h1>
        <span className="sub">무장애 관광지 {places.length}곳 · 계단 회피 경로 · AI 코스 추천</span>
        {persona && (
          <button className="persona-pill" onClick={() => setSurvey(true)}
                  title="설문 다시 하기">
            {persona.type} · 필수 {persona.badges.length}개 · 수정
          </button>
        )}
        <span className="legend">
          <i className="dot tour" /> 관광지 <i className="dot food" /> 음식점
          <i className="line easy" /> 쉬움 <i className="line mid" /> 중간 <i className="line hard" /> 어려움
        </span>
      </header>
      <aside className="side">
        {survey && <PersonaSurvey onSubmit={handleSurvey} onClose={() => setSurvey(false)} />}
        {deck && <CardDeck cards={deck} onDone={handleDeckDone} onClose={() => setDeck(null)} />}
        {!survey && !deck && (
          <>
            <button className="persona-cta" onClick={() => setSurvey(true)}>
              설문으로 맞춤 코스 시작하기 <span>이동 조건 → 후보 카드 → 자동 코스</span>
            </button>
            <ChatPanel messages={messages} loading={loading} onSend={handleSend} course={course} onRegion={handleRegion} />
            <DepartureSelector
              region={region}
              selected={selectedDeparture}
              myLoc={myLoc}
              onSelect={setSelectedDeparture} />
            {(routeCourse.length || course.length) >= 2 && (
              <div className="mode-toggle" role="group" aria-label="이동 방법 선택">
                <button className={travelMode === 'walk' ? 'on' : ''}
                        onClick={() => switchMode('walk')} disabled={loading}>도보만</button>
                <button className={travelMode === 'transit' ? 'on' : ''}
                        onClick={() => switchMode('transit')} disabled={loading}>대중교통 포함</button>
              </div>
            )}
            <RouteSteps route={route} course={routeCourse.length ? routeCourse : course} restrooms={restrooms} />
          </>
        )}
      </aside>
      <main className="map-wrap">
        <div className="map-filters" role="group" aria-label="시설 필터">
          <button className={!mapFilter ? 'on' : ''} onClick={() => setMapFilter(null)}>전체</button>
          {['wheelchair', 'toilet', 'parking', 'elevator'].map((b) => (
            <button key={b} className={mapFilter === b ? 'on' : ''}
                    onClick={() => setMapFilter(mapFilter === b ? null : b)}>
              <BadgeIcon badge={b} /> {BADGE_LABELS[b]}
            </button>
          ))}
          <button className={myLoc ? 'on' : ''} onClick={locateMe}>내 위치 출발</button>
        </div>
        <MapView
          places={mapFilter ? places.filter((p) => p.badges.includes(mapFilter)) : places}
          course={course} route={route} center={region.center}
          origin={route ? getOrigin(region) : null}
          restrooms={restrooms
            .map((it) => it.restroom)
            .filter((r) => r && !r.isSelf)} />
      </main>
    </div>
  )
}
