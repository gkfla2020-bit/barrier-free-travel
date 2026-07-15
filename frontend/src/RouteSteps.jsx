const fmt = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${m}m`)
const fmtT = (s) => `${Math.max(1, Math.round(s / 60))}분`

function stepIcon(text) {
  if (text.includes('계단')) return '⚠️'
  if (text.includes('엘리베이터')) return '🛗'
  if (text.includes('경사로')) return '↗️'
  if (text.includes('횡단보도')) return '🚸'
  if (text.includes('육교') || text.includes('지하보도')) return '🌉'
  return '🚶'
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

  return (
    <section className="steps">
      <div className={`steps-total ${anyStairs ? 'warn' : 'ok'}`}>
        <strong>
          도보 {fmt(route.totalDistance)} · {fmtT(route.totalDuration)}
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
              <span className={`leg-line${leg.stairsPossible ? ' warn' : ''}`} />
              {from} → {to}
              <span className="leg-meta">
                {fmt(leg.distance)} · {fmtT(leg.duration)} <DiffChip level={leg.difficulty} reasons={leg.reasons} />
              </span>
            </summary>
            <ul>
              {leg.guides.map((g, j) => (
                <li key={j} className={g.includes('계단') ? 'warn' : ''}>
                  <span className="icon">{stepIcon(g)}</span>{g}
                </li>
              ))}
            </ul>
          </details>
        )
      })}
      <p className="disclaimer">도보 계단 회피 기준이며, 현장 상황과 다를 수 있습니다.</p>
    </section>
  )
}
