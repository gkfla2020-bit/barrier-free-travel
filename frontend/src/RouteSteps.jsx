const fmt = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${m}m`)
const fmtT = (s) => `${Math.max(1, Math.round(s / 60))}분`

function stepIcon(text) {
  return text.startsWith('⚠️') ? '' : '•' // 경고문은 자체 ⚠️ 포함, 나머지는 불릿
}

const DIFF_CLASS = { 쉬움: 'easy', 중간: 'mid', 어려움: 'hard' }

export function DiffChip({ level, reasons }) {
  return (
    <span className={`diff ${DIFF_CLASS[level] || 'easy'}`}
          title={reasons?.join(' · ') || ''}>
      {level}
    </span>
  )
}

export default function RouteSteps({ route, course }) {
  if (!route) return null
  const anyStairs = route.legs.some((l) => l.stairsPossible)
  const anyTransit = route.legs.some((l) => l.mode === 'transit')

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
            <ul>
              {leg.guides.map((g, j) => (
                <li key={j} className={g.startsWith('⚠️') ? 'warn' : /^\[(지하철|버스)\]/.test(g) ? 'transit' : ''}>
                  <span className="icon">{stepIcon(g)}</span>{g}
                </li>
              ))}
            </ul>
          </details>
        )
      })}

      <details className="criteria">
        <summary>ℹ️ 이동 난이도 기준</summary>
        <ul>
          <li><span className="diff hard">어려움</span> 계단·육교·지하보도 1회 이상 / 도보 1.2km 초과 / 경사로 3회 이상</li>
          <li><span className="diff mid">중간</span> 경사로 1~2회 / 횡단보도 5회 이상 / 도보 500m~1.2km</li>
          <li><span className="diff easy">쉬움</span> 위 해당 없음 (단, 중간 요소 4개 이상이면 어려움으로 상향)</li>
          <li className="crit-note">산정 원칙: 경로에서 <b>가장 어려운 요소 하나</b>가 최종 난이도를 정합니다(worst-element).
            계단 칸수·경사 각도·육교의 승강설비처럼 데이터로 확인할 수 없는 것은 안전하게 어려운 쪽으로 판정합니다.</li>
          <li className="crit-note">코스 전체가 도보 3km를 넘으면 이동약자 반나절 권장 기준 초과로 '어려움' 처리합니다.</li>
        </ul>
      </details>
      <p className="disclaimer">도보 계단 회피 기준이며, 현장 상황과 다를 수 있습니다.</p>
    </section>
  )
}
