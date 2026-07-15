// mapdraw.js — 지도 렌더의 순수 계산 로직 (테스트 가능)
//
// MapView의 route 폴리라인 렌더 루프와 정확히 동일한 규칙으로
// "실제로 그려질 폴리라인 수"를 계산한다. 좌표가 2점 미만인 구간은
// 폴리라인을 그리지 않으므로 카운트에서 제외한다 (Req 5.5).

// 좌표 리스트가 폴리라인으로 그려질 수 있는지(≥2점) 판정.
// MapView.addLine의 `if (coords.length < 2) return` 가드와 일치.
export function isDrawable(coords) {
  return Array.isArray(coords) && coords.length >= 2
}

// 하나의 leg에서 그려질 폴리라인 수를 계산.
// - segments가 있으면 각 segment.polyline 중 ≥2점인 것만 카운트
// - segments가 없으면 leg.polyline이 ≥2점일 때 1
export function drawableSegmentsInLeg(leg) {
  if (!leg) return 0
  if (leg.segments?.length) {
    return leg.segments.reduce(
      (n, s) => n + (isDrawable(s?.polyline) ? 1 : 0),
      0,
    )
  }
  return isDrawable(leg.polyline) ? 1 : 0
}

// route 전체에서 그려질 폴리라인 수 = 좌표가 있는(≥2점) 구간 수.
// MapView의 route.legs.forEach 렌더 루프가 그리는 폴리라인 수와 정확히 일치한다.
export function renderablePolylineCount(route) {
  const legs = route?.legs
  if (!Array.isArray(legs)) return 0
  return legs.reduce((n, leg) => n + drawableSegmentsInLeg(leg), 0)
}
