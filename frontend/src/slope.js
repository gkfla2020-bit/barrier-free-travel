// 경사 판정 공용 — 지도 경로선·고도 그래프·범례가 같은 임계와 색을 쓰게 한다.
// 임계는 backend/app/services/elevation.py와 같은 값이어야 한다 (언어가 달라 불가피한 이중 정의).
export const GRADE_MODERATE = 5      // % 보도 종단경사 권장 상한 (도로의 구조·시설 기준에 관한 규칙)
export const GRADE_STEEP = 8.33      // % 1/12 — 장애인등편의법 경사로 최대 기울기

export const gradeClass = (g) =>
  (g >= GRADE_STEEP ? 'hard' : g >= GRADE_MODERATE ? 'mid' : 'easy')

// 경사 등급색. App.css의 .line.* / .elev-seg.* 와 같은 값을 유지할 것 —
// 지도·그래프·범례가 어긋나면 같은 색이 다른 뜻이 되어 오히려 오해를 만든다.
export const SLOPE_COLOR = {
  easy: '#60a5fa', mid: '#f59e0b', hard: '#ef4444', unknown: '#94a3b8',
}

// elevation.py의 _haversine과 같은 식. 같은 폴리라인·같은 식이어야 백엔드가 준
// samples의 누적거리와 여기서 재는 누적거리가 일치한다 (근사식을 쓰면 색 경계가 밀린다).
export function haversine([lat1, lng1], [lat2, lng2]) {
  const p = Math.PI / 180
  const a = Math.sin(((lat2 - lat1) * p) / 2) ** 2 +
    Math.cos(lat1 * p) * Math.cos(lat2 * p) * Math.sin(((lng2 - lng1) * p) / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(a))
}

/** 구간 폴리라인을 경사 등급별로 잘라 [{cls, path}] 로 만든다.
 *  표고를 못 잰 구간(slope=null, 직선 폴백 등)은 'unknown' — 회색으로 칠해
 *  '경사 없음'이 아니라 '모름'임을 드러낸다. 평지로 위장시키지 않는다. */
export function slopeSegments(leg) {
  const poly = leg.polyline
  if (!poly || poly.length < 2) return []
  const s = leg.slope?.samples
  if (!s || s.length < 2) return [{ cls: 'unknown', path: poly }]

  // 표본 구간(≈90m)별 등급 — 누적거리 to 이하이면 그 등급
  const bands = []
  for (let i = 1; i < s.length; i++) {
    const run = s[i][0] - s[i - 1][0]
    const g = run > 0 ? (Math.abs(s[i][1] - s[i - 1][1]) / run) * 100 : 0
    bands.push({ to: s[i][0], cls: gradeClass(g) })
  }
  const clsAt = (d) => (bands.find((b) => d <= b.to) || bands[bands.length - 1]).cls

  const out = []
  let cum = 0
  for (let i = 0; i < poly.length - 1; i++) {
    const d = haversine(poly[i], poly[i + 1])
    const cls = clsAt(cum + d / 2) // 꼭짓점이 아니라 조각 중앙이 속한 표본 구간으로 판정
    const last = out[out.length - 1]
    if (last && last.cls === cls) last.path.push(poly[i + 1])
    else out.push({ cls, path: [poly[i], poly[i + 1]] }) // 이전 조각의 끝점부터 시작해 선이 끊기지 않게
    cum += d
  }
  return out
}
