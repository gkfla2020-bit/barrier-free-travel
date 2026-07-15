import { useEffect, useMemo, useState } from 'react'
import MapView from './MapView'
import ChatPanel from './ChatPanel'
import RouteSteps from './RouteSteps'
import { fetchAllPlaces, postChat, postRoute } from './api'
import './App.css'

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
      const res = await postChat(text)
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

  return (
    <div className="layout">
      <header className="topbar">
        <h1>♿ 모두의 여행</h1>
        <span className="sub">무장애 관광지 {places.length}곳 · 계단 회피 경로 · AI 코스 추천</span>
        <span className="legend">
          <i className="dot tour" /> 관광지 <i className="dot food" /> 음식점
          <i className="line ok" /> 무계단 <i className="line warn" /> 계단 주의
        </span>
      </header>
      <aside className="side">
        <ChatPanel messages={messages} loading={loading} onSend={handleSend} course={course} />
        <RouteSteps route={route} course={course} />
      </aside>
      <main className="map-wrap">
        <MapView places={places} course={course} route={route} />
      </main>
    </div>
  )
}
