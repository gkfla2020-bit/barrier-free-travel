import { fmtDistance, fmtDuration } from './format'
import { GRADE_MODERATE, gradeClass } from './slope'

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
        {seg.approx && (
          <span className="seg-approx"> · ⚠️ 정류장 간 개략 직선 — 실제 도로와 다를 수 있음</span>
        )}
        {stations.length > 0 && (
          <details className="seg-stops">
            <summary>정류장 {stations.length}개 보기</summary>
            <ol>
              {stations.map((st, k) => (
                <li key={k}>{st}</li>
              ))}
            </ol>
          </details>
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

// 고도 프로파일 — 경사 구간을 색으로 드러내 "어디가 힘든지"를 바로 보여준다.
// 표본 간격(sampleStep, 보통 90m)을 캡션에 박아 해상도를 숨기지 않는다.
function ElevationChart({ slope }) {
  const s = slope?.samples
  if (!s || s.length < 2) return null
  const W = 300, H = 46, P = 6
  const end = s[s.length - 1][0] || 1
  const ys = s.map((p) => p[1])
  const lo = Math.min(...ys), hi = Math.max(...ys)
  const span = Math.max(hi - lo, 4) // 표고차가 작을 때 잔물결을 절벽처럼 과장하지 않게
  const px = (d) => P + (d / end) * (W - P * 2)
  const py = (e) => P + (1 - (e - lo) / span) * (H - P * 2)
  const area = `M ${px(0)} ${H - P} ` + s.map((p) => `L ${px(p[0])} ${py(p[1])}`).join(' ') +
    ` L ${px(end)} ${H - P} Z`

  return (
    <figure className="elev">
      <svg viewBox={`0 0 ${W} ${H}`} role="img"
           aria-label={`고도 ${Math.round(lo)}m에서 ${Math.round(hi)}m, 최대 경사 ${slope.maxGrade}%`}>
        <path className="elev-area" d={area} />
        {s.slice(1).map((p, i) => {
          const q = s[i]
          const run = p[0] - q[0]
          const g = run > 0 ? (Math.abs(p[1] - q[1]) / run) * 100 : 0
          return <line key={i} className={`elev-seg ${gradeClass(g)}`}
                       x1={px(q[0])} y1={py(q[1])} x2={px(p[0])} y2={py(p[1])} />
        })}
      </svg>
      <figcaption>
        고도 {Math.round(lo)}~{Math.round(hi)}m · 최대 경사 {slope.maxGrade}%
        {slope.steepDist > 0 && <b> · 급경사 {slope.steepDist}m</b>}
        <span className="elev-res">{slope.sampleStep}m 간격 지형 표고</span>
      </figcaption>
    </figure>
  )
}

// 회피 전/후 비교. 좋아진 것만 고르지 않고 나빠진 것(늘어난 거리)도 같이 보여준다 —
// 사용자가 우회를 받아들일지 스스로 판단할 수 있어야 한다.
const RANK = { 쉬움: 0, 중간: 1, 어려움: 2 }
// 좋아짐/나빠짐/그대로 3상태. 안 변한 걸 '나빠짐'(빨강)으로 칠하면 우회가 손해인 것처럼 보인다.
const cmp = (before, after) => (before > after ? 'better' : before < after ? 'worse' : 'same')

function Compare({ base, route }) {
  const grade = route.slope?.maxGrade ?? 0
  const steep = route.slope?.steepDist ?? 0
  const rows = [
    ['최대 경사', `${base.maxGrade}%`, `${grade}%`, cmp(base.maxGrade, grade)],
    ['급경사 거리', fmt(base.steepDist), fmt(steep), cmp(base.steepDist, steep)],
    ['총 도보', fmt(base.totalDistance), fmt(route.totalDistance),
      cmp(base.totalDistance, route.totalDistance)],
    ['난이도', base.difficulty, route.difficulty,
      cmp(RANK[base.difficulty], RANK[route.difficulty])],
  ]
  return (
    <div className="slope-cmp">
      <strong>{base.detourLegs}개 구간을 우회로 바꿨어요</strong>
      <table>
        <thead><tr><th /><th>회피 전</th><th>회피 후</th></tr></thead>
        <tbody>
          {rows.map(([k, a, b, state]) => (
            <tr key={k}>
              <th>{k}</th>
              <td>{a}</td>
              <td className={state}>{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {route.totalDistance > base.totalDistance && (
        <p className="cmp-note">
          경사를 줄인 대신 {fmt(route.totalDistance - base.totalDistance)}를 더 걷습니다.
          거리도 부담이라면 회피를 끄고 원래 경로를 쓰세요.
        </p>
      )}
    </div>
  )
}

export default function RouteSteps({ route, course, restrooms = null, avoidSlope, onAvoidSlope, slopeBusy }) {
  if (!route) return null
  const anyStairs = route.legs.some((l) => l.stairsPossible)
  const anyTransit = route.legs.some((l) => l.mode === 'transit')
  const anyFallback = route.legs.some((l) => l.fallback) // 경로 탐색 실패 = 직선 표시 구간
  const gentle = route.slope && route.slope.maxGrade < GRADE_MODERATE
  const restroomMap = restroomLookup(restrooms)

  // 픽스처 응답은 요청한 코스와 무관한 데모 경로다. 아래 구간 이름표는 사용자의 코스에서
  // 붙는 거라 그럴듯해 보이지만 전부 가짜 — 제일 먼저, 제일 크게 밝힌다.
  if (route.fallback) {
    return (
      <section className="steps">
        <div className="steps-total warn">
          <strong>⚠️ 실제 경로를 확인하지 못했어요</strong>
          <span>
            경로 서버에 연결하지 못해 미리 저장해둔 <b>데모 경로(서울 광화문)</b>를 표시합니다.
            담으신 코스의 실제 거리·계단·경사가 아니므로 이동 계획에 사용하지 마세요.
          </span>
        </div>
        <p className="disclaimer">잠시 후 다시 시도하면 실제 경로를 불러옵니다.</p>
      </section>
    )
  }

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

      <div className="slope-opt">
        <button className={`slope-toggle ${avoidSlope ? 'on' : ''}`}
                aria-pressed={avoidSlope} disabled={slopeBusy}
                onClick={() => onAvoidSlope(!avoidSlope)}>
          <span className="st-title">경사 회피 {avoidSlope ? 'ON' : 'OFF'}</span>
          <span className="st-sub">
            {slopeBusy ? '완만한 경로를 다시 찾는 중…' : '더 돌더라도 경사가 덜한 길로'}
          </span>
        </button>

        {/* 경사가 없는 이유를 구분해서 말한다. 경로 탐색(Tmap)이 실패해도 경사는 못 재는데,
            무조건 "표고를 못 가져왔다"고 하면 멀쩡한 Open-Meteo를 탓하며 진짜 원인을 가린다. */}
        {anyFallback ? (
          <p className="slope-note">
            일부 구간은 경로를 찾지 못해 직선으로 표시 중이에요 — 실제 보행로가 아니라 경사·난이도도 확인할 수 없습니다.
          </p>
        ) : !route.slope ? (
          <p className="slope-note">
            지형 표고를 가져오지 못해 이 경로의 경사는 확인되지 않았어요 — 난이도에도 반영되지 않았습니다.
          </p>
        ) : !route.slope.covered && (
          <p className="slope-note">일부 구간은 표고를 확인하지 못해 경사 집계에서 빠졌어요.</p>
        )}
        {avoidSlope && !slopeBusy && route.baseline && <Compare base={route.baseline} route={route} />}
        {avoidSlope && !slopeBusy && !route.baseline && route.slope && (
          <p className="slope-note">
            {gentle
              ? '이미 완만한 경로라 우회할 필요가 없었어요 (최대 경사 ' + route.slope.maxGrade + '%).'
              : '우회로를 찾아봤지만 거리만 늘고 경사는 나아지지 않아 원래 경로를 유지했어요.'}
          </p>
        )}
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
              {leg.detour && <span className="detour-tag">우회</span>}
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

            <ElevationChart slope={leg.slope} />

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
          <li><span className="diff hard">어려움</span> 계단·육교·지하보도 1회 이상 / 도보 1.5km 초과 / 경사로 3회 이상 / 지형 경사 8.33% 이상</li>
          <li><span className="diff mid">중간</span> 경사로 1~2회 / 횡단보도 5회 이상 / 도보 700m~1.5km / 지형 경사 5% 이상</li>
          <li><span className="diff easy">쉬움</span> 위 해당 없음 (단, 중간 요소 4개 이상이면 어려움으로 상향)</li>
          <li className="crit-note">산정 원칙: 경로에서 <b>가장 어려운 요소 하나</b>가 최종 난이도를 정합니다(worst-element).
            계단 칸수·육교의 승강설비처럼 데이터로 확인할 수 없는 것은 안전하게 어려운 쪽으로 판정합니다.</li>
          <li className="crit-note">경사 임계 5%는 보도 종단경사 권장 상한(도로의 구조·시설 기준에 관한 규칙),
            8.33%는 1/12로 장애인등편의법상 경사로 최대 기울기입니다. 내리막도 제동 부담이 있어 같은 기준으로 봅니다.</li>
          <li className="crit-note">경사는 Open-Meteo 표고(Copernicus DEM, 해상도 약 90m)로 잽니다.
            <b>언덕·고갯길 같은 지형 경사는 잡지만, 연석 턱이나 짧은 진입 경사로는 90m 평균에 묻혀 보이지 않습니다.</b>
            표고를 못 가져온 구간은 경사를 &apos;없음&apos;이 아니라 &apos;모름&apos;으로 처리해 난이도에서 뺍니다.</li>
          <li className="crit-note">코스 전체가 도보 4km를 넘으면 이동약자 반나절 권장 기준 초과로 &apos;어려움&apos; 처리합니다.
            경사 회피로 거리가 늘어 4km를 넘으면 난이도가 오히려 올라갈 수 있습니다.</li>
        </ul>
      </details>
      <p className="disclaimer">도보 계단 회피 기준이며, 현장 상황과 다를 수 있습니다.</p>
    </section>
  )
}
