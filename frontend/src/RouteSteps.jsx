import { fmtDistance, fmtDuration } from './format'

// 거리/시간 포맷은 순수 유틸(format.js)로 분리해 테스트 가능하게 유지한다 (Req 4.7).
const fmt = fmtDistance
const fmtT = fmtDuration

function stepIcon(text) {
  return text.startsWith('⚠️') ? '' : '•' // 경고문은 자체 ⚠️ 포함, 나머지는 불릿
}

const DIFF_CLASS = { 쉬움: 'easy', 중간: 'mid', 어려움: 'hard' }

// 정거장 수는 항상 비음수 정수 (Req 4.4)
const stopCount = (seg) => {
  if (typeof seg?.stationCount === 'number' && Number.isFinite(seg.stationCount)) {
    return Math.max(0, Math.round(seg.stationCount))
  }
  return Array.isArray(seg?.stations) ? seg.stations.length : 0
}

// 버스 저상 여부 라벨 (Req 4.5, 4.6)
const lowFloorLabel = (lowFloor) => {
  if (lowFloor === true) return '저상버스'
  if (lowFloor === false) return '일반차량(저상 아님)'
  return '저상 정보 없음'
}

// restrooms prop은 배열 또는 contentId 키 맵으로 올 수 있다. 방어적으로 조회 맵을 만든다.
function restroomLookup(restrooms) {
  if (!restrooms) return {}
  if (Array.isArray(restrooms)) {
    return Object.fromEntries(restrooms.filter((it) => it && it.contentId).map((it) => [it.contentId, it]))
  }
  if (typeof restrooms === 'object') return restrooms
  return {}
}

// 코스 장소별 화장실 커버리지 표시 (Req 7.4, 7.5)
function RestroomInfo({ item }) {
  const restroom = item?.restroom
  if (!restroom) {
    return <p className="restroom-info none">🚻 주변 인증 화장실 없음</p>
  }
  const label = restroom.isSelf
    ? `가장 가까운 접근 화장실: ${restroom.name} (이 장소, 0m)`
    : `가장 가까운 접근 화장실: ${restroom.name} (${restroom.distance}m)`
  return <p className="restroom-info">🚻 {label}</p>
}

// 대중교통 구간(bus/subway) 상세 표시 (Req 4.4, 4.5, 4.6)
function TransitSegment({ seg }) {
  const stations = Array.isArray(seg.stations) ? seg.stations : []
  const board = stations[0] || '승차역 정보 없음'
  const alight = stations.length ? stations[stations.length - 1] : '하차역 정보 없음'
  const stops = stopCount(seg)
  const isBus = seg.mode === 'bus'
  return (
    <li className="transit">
      <span className="icon">•</span>
      <span className="seg-mode-tag" style={seg.color ? { background: seg.color } : undefined}>
        {seg.mode === 'subway' ? '지하철' : '버스'}
      </span>
      <span className="seg-detail">
        <b>{seg.name || (isBus ? '버스' : '지하철')}</b>
        {' '}· {board} → {alight} · {stops}개 정거장
        {isBus && (
          <span className={`low-floor ${seg.lowFloor === true ? 'yes' : seg.lowFloor === false ? 'no' : 'unknown'}`}>
            {' '}· {lowFloorLabel(seg.lowFloor)}
            {seg.lowFloorNote ? ` (${seg.lowFloorNote})` : ''}
          </span>
        )}
      </span>
    </li>
  )
}

export function DiffChip({ level, reasons }) {
  return (
    <span className={`diff ${DIFF_CLASS[level] || 'easy'}`}
          title={reasons?.join(' · ') || ''}>
      {level}
    </span>
  )
}

export default function RouteSteps({ route, course, restrooms = null }) {
  if (!route) return null
  const anyStairs = route.legs.some((l) => l.stairsPossible)
  const anyTransit = route.legs.some((l) => l.mode === 'transit')
  const restroomMap = restroomLookup(restrooms)

  return (
    <section className="steps">
      <div className={`steps-total ${anyStairs ? 'warn' : 'ok'}`}>
        <strong>
          도보 {fmt(route.totalDistance)} · {anyTransit ? '전체 ' : ''}{fmtT(route.totalDuration)}
          {' '}<DiffChip level={route.difficulty} reasons={route.reasons} />
        </strong>
        <span>
          {anyStairs ? '⚠️ 계단 가능 구간 포함 — 아래 안내 확인' : '✅ 계단 회피 경로'}
          {route.reasons?.length ? ` · ${route.reasons.join(' · ')}` : ''}
        </span>
      </div>

      {route.legs.map((leg, i) => {
        const from = course[i]?.place.title ?? '출발'
        const to = course[i + 1]?.place.title ?? '도착'
        // 목적지 장소(course[i+1])의 화장실 커버리지 (__origin은 대상 아님)
        const destPlace = course[i + 1]?.place
        const restroomItem = destPlace ? restroomMap[destPlace.contentId] : null
        // 대중교통 구간(bus/subway)만 상세 표시 — 도보 구간은 기존 guides 텍스트로 안내
        const transitSegs = (leg.segments || []).filter((s) => s.mode === 'bus' || s.mode === 'subway')
        return (
          <details key={i} className="leg" open={i === 0}>
            <summary>
              <span className={`leg-line ${DIFF_CLASS[leg.difficulty] || 'easy'}${leg.stairsPossible ? ' dashed' : ''}`} />
              {from} → {to}
              {leg.mode === 'transit' && <span className="seg-mode">대중교통</span>}
              <span className="leg-meta">
                {leg.mode === 'transit' ? `도보 ${fmt(leg.distance)}` : fmt(leg.distance)} · {fmtT(leg.duration)} <DiffChip level={leg.difficulty} reasons={leg.reasons} />
              </span>
            </summary>

            {transitSegs.length > 0 && (
              <ul className="seg-list">
                {transitSegs.map((seg, k) => (
                  <TransitSegment key={k} seg={seg} />
                ))}
              </ul>
            )}

            <ul>
              {leg.guides.map((g, j) => (
                <li key={j} className={g.startsWith('⚠️') ? 'warn' : /^\[(지하철|버스|저상)\]/.test(g) ? 'transit' : ''}>
                  <span className="icon">{stepIcon(g)}</span>{g}
                </li>
              ))}
            </ul>

            {restroomItem !== undefined && restroomItem !== null && (
              <RestroomInfo item={restroomItem} />
            )}
          </details>
        )
      })}

      <details className="criteria">
        <summary>ℹ️ 이동 난이도 기준</summary>
        <ul>
          <li><span className="diff hard">어려움</span> 계단·육교·지하보도 1회 이상 / 도보 1.5km 초과 / 경사로 3회 이상</li>
          <li><span className="diff mid">중간</span> 경사로 1~2회 / 횡단보도 5회 이상 / 도보 700m~1.5km</li>
          <li><span className="diff easy">쉬움</span> 위 해당 없음 (단, 중간 요소 4개 이상이면 어려움으로 상향)</li>
          <li className="crit-note">산정 원칙: 경로에서 <b>가장 어려운 요소 하나</b>가 최종 난이도를 정합니다(worst-element).
            계단 칸수·경사 각도·육교의 승강설비처럼 데이터로 확인할 수 없는 것은 안전하게 어려운 쪽으로 판정합니다.</li>
          <li className="crit-note">코스 전체가 도보 4km를 넘으면 이동약자 반나절 권장 기준 초과로 '어려움' 처리합니다.</li>
        </ul>
      </details>
      <p className="disclaimer">도보 계단 회피 기준이며, 현장 상황과 다를 수 있습니다.</p>
    </section>
  )
}
