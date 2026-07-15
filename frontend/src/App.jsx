import { useEffect, useMemo, useState } from 'react'
import MapView from './MapView'
import ChatPanel from './ChatPanel'
import RouteSteps from './RouteSteps'
import { PersonaSurvey, CardDeck } from './PersonaDeck'
import { fetchAllPlaces, fetchPlaceDetail, postChat, postRoute, BADGE_LABELS } from './api'
import './App.css'

const CENTER = { lat: 37.5788, lng: 126.977 } // 경복궁 (덤프 중심)
const distKm = (a, b) => Math.hypot((a.lat - b.lat) * 111, (a.lng - b.lng) * 88)

// 담은 장소들을 가까운 순서로 자동 정렬 (최근접 이웃)
function optimizeOrder(items) {
  if (items.length <= 2) return items
  const start = items.reduce((s, p) => (distKm(p.place, CENTER) < distKm(s.place, CENTER) ? p : s))
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
  const emoji = { 쉬움: '🟢', 중간: '🟡', 어려움: '🔴' }
  const fmt = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${m}m`)
  const min = (s) => `${Math.max(1, Math.round(s / 60))}분`
  const legs = r.legs.map((l, i) => {
    const why = l.reasons?.length ? ` — ${l.reasons.join(', ')}` : ''
    return `${i + 1}. ${course[i].place.title} → ${course[i + 1].place.title}: ` +
      `${fmt(l.distance)}·${min(l.duration)} ${emoji[l.difficulty]}${l.difficulty}${why}`
  })
  const head =
    `🧭 이동 경로를 확인했어요. 총 도보 ${fmt(r.totalDistance)} · ${min(r.totalDuration)}\n` +
    `이동 난이도: ${emoji[r.difficulty]} ${r.difficulty}` +
    (r.reasons?.length ? ` (${r.reasons.join(' · ')})` : '')
  const stairs = r.legs.some((l) => l.stairsPossible)
    ? '\n⚠️ 일부 구간에 계단이 있을 수 있어요. 왼쪽 경로 안내에서 우회 지점을 확인하세요.'
    : '\n✅ 전 구간 계단 회피 경로입니다.'
  return `${head}\n${legs.join('\n')}${stairs}`
}

const GREETING = {
  role: 'assistant',
  content:
    '안녕하세요! 이동약자를 위한 무장애 여행 플래너 "모두의 여행"입니다. 🧭\n' +
    '어디로, 어떤 조건으로 여행하고 싶으신가요? (현재 데모 지역: 경복궁 일대 3km — 무장애 인증 장소 104곳)\n' +
    '예: "휠체어로 반나절 코스", "유모차 가족 코스"처럼 말씀해주세요.',
}

export default function App() {
  const [places, setPlaces] = useState([])
  const [messages, setMessages] = useState([GREETING])
  const [course, setCourse] = useState([])
  const [route, setRoute] = useState(null)
  const [loading, setLoading] = useState(false)
  const [survey, setSurvey] = useState(true) // 첫 화면 = 페르소나 설문 (스펙 1단계)
  const [deck, setDeck] = useState(null) // [{place, detail}] — 카드 스와이프 후보
  const [persona, setPersona] = useState(null) // {type, badges[], tastes[]}

  const placeById = useMemo(
    () => Object.fromEntries(places.map((p) => [p.contentId, p])),
    [places],
  )

  useEffect(() => {
    fetchAllPlaces().then(setPlaces).catch(() => {
      setMessages((m) => [...m, { role: 'assistant', content: '⚠️ 백엔드 서버에 연결할 수 없습니다. uvicorn이 켜져 있는지 확인해주세요.' }])
    })
  }, [])

  const handleSend = async (text) => {
    setMessages((m) => [...m, { role: 'user', content: text }])
    setLoading(true)
    setRoute(null)
    try {
      // 페르소나가 있으면 요청에 자동 반영 — 백엔드 후보 필터와 LLM이 함께 활용
      const apiMsg = persona
        ? `${text}\n(여행자 정보: ${persona.type} / 필수 시설: ${persona.badges.map((b) => BADGE_LABELS[b]).join(', ') || '없음'}${persona.tastes.length ? ` / 취향: ${persona.tastes.join(', ')}` : ''})`
        : text
      const res = await postChat(apiMsg)
      const resolved = (res.course || [])
        .sort((a, b) => a.order - b.order)
        .map((c) => ({ ...c, place: placeById[c.contentId] }))
        .filter((c) => c.place)
      setCourse(resolved)
      setMessages((m) => [...m, { role: 'assistant', content: res.reply, course: resolved.length ? resolved : undefined }])

      if (resolved.length >= 2) {
        const r = await postRoute(
          resolved.map((c) => ({ lat: c.place.lat, lng: c.place.lng, name: c.place.title })),
        )
        setRoute(r)
        setMessages((m) => [...m, { role: 'assistant', content: routeSummary(r, resolved) }])
      }
    } catch {
      setMessages((m) => [...m, { role: 'assistant', content: '⚠️ 요청 처리 중 오류가 발생했어요. 잠시 후 다시 시도해주세요.' }])
    } finally {
      setLoading(false)
    }
  }

  // 설문(스펙 1단계) → 안전지대 필터(2단계): 조건 100% 만족 장소만, 근접순 5+2곳
  const handleSurvey = async (p) => {
    setSurvey(false)
    setPersona(p)
    const required = [...new Set([
      ...p.badges,
      ...(p.type.includes('휠체어') ? ['wheelchair'] : []),
    ])]
    const near = (list) => [...list].sort((a, b) => distKm(a, CENTER) - distKm(b, CENTER))
    const match = (p) => required.every((b) => p.badges.includes(b))
    let tours = near(places.filter((pl) => pl.type === 12 && match(pl)))
    let foods = near(places.filter((pl) => pl.type === 39 && match(pl)))
    if (tours.length + foods.length < 4) { // 조건이 너무 빡빡하면 완화하되 사실대로 알림
      tours = near(places.filter((pl) => pl.type === 12))
      foods = near(places.filter((pl) => pl.type === 39))
      setMessages((m) => [...m, { role: 'assistant', content: '⚠️ 모든 조건을 만족하는 곳이 부족해 일부 조건을 완화한 후보를 보여드려요. 카드의 배지를 꼭 확인해주세요.' }])
    }
    const cand = [...tours.slice(0, 5), ...foods.slice(0, 2)]
    const details = await Promise.all(cand.map((pl) => fetchPlaceDetail(pl.contentId).catch(() => null)))
    setDeck(cand.map((pl, i) => ({ place: pl, detail: details[i] })))
    setMessages((m) => [...m, {
      role: 'assistant',
      content: `${p.type} 기준, 조건(${required.map((b) => BADGE_LABELS[b] || b).join(', ') || '무장애 인증'})을 만족하는 안전지대 후보 ${cand.length}곳을 골랐어요. 카드를 넘기며 마음에 드는 곳을 담아보세요!`,
    }])
  }

  // 카드 담기 완료(3단계) → 최근접 순 정렬 + 계단회피 경로(4단계)
  const handleDeckDone = async (picked) => {
    setDeck(null)
    if (picked.length < 2) {
      setMessages((m) => [...m, { role: 'assistant', content: '코스를 만들려면 2곳 이상 담아주세요. 설문부터 다시 시작할 수 있어요.' }])
      return
    }
    const ordered = optimizeOrder(picked)
    const resolved = ordered.map((c, i) => ({
      contentId: c.place.contentId, order: i + 1,
      reason: c.place.badges.map((b) => BADGE_LABELS[b]).join(' · ') || '무장애 인증 장소',
      place: c.place,
    }))
    setCourse(resolved)
    setMessages((m) => [...m, {
      role: 'assistant',
      content: `담은 ${picked.length}곳을 가까운 순서로 자동 정렬해 코스를 만들었어요. 계단 회피 경로를 확인할게요…`,
      course: resolved,
    }])
    try {
      const r = await postRoute(resolved.map((c) => ({ lat: c.place.lat, lng: c.place.lng, name: c.place.title })))
      setRoute(r)
      setMessages((m) => [...m, { role: 'assistant', content: routeSummary(r, resolved) }])
    } catch {
      setMessages((m) => [...m, { role: 'assistant', content: '⚠️ 경로 조회에 실패했어요. 잠시 후 다시 시도해주세요.' }])
    }
  }

  return (
    <div className="layout">
      <header className="topbar">
        <h1>♿ 모두의 여행</h1>
        <span className="sub">무장애 관광지 {places.length}곳 · 계단 회피 경로 · AI 코스 추천</span>
        {persona && (
          <button className="persona-pill" onClick={() => setSurvey(true)}
                  title="설문 다시 하기">
            {persona.type} · 필수 {persona.badges.length}개 ✏️
          </button>
        )}
        <span className="legend">
          <i className="dot tour" /> 관광지 <i className="dot food" /> 음식점
          <i className="line ok" /> 무계단 <i className="line warn" /> 계단 주의
        </span>
      </header>
      <aside className="side">
        {survey && <PersonaSurvey onSubmit={handleSurvey} onClose={() => setSurvey(false)} />}
        {deck && <CardDeck cards={deck} onDone={handleDeckDone} onClose={() => setDeck(null)} />}
        {!survey && !deck && (
          <>
            <button className="persona-cta" onClick={() => setSurvey(true)}>
              📋 설문으로 맞춤 코스 시작하기 <span>이동 조건 → 후보 카드 → 자동 코스</span>
            </button>
            <ChatPanel messages={messages} loading={loading} onSend={handleSend} course={course} />
            <RouteSteps route={route} course={course} />
          </>
        )}
      </aside>
      <main className="map-wrap">
        <MapView places={places} course={course} route={route} />
      </main>
    </div>
  )
}
