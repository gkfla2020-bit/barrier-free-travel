// ETA/거리 포맷 순수 유틸 (Req 4.7, 4.3)
//
// 대중교통/도보 경로의 소요시간·거리를 표시용 문자열/숫자로 변환하는 순수 함수 모음.
// RouteSteps 등 UI 컴포넌트와 분리해 단위/속성 테스트가 쉽도록 한다.

/**
 * 소요시간(초)을 표시용 분(minutes)으로 변환한다.
 *
 * 규칙(Req 4.7): 분 = max(1, round(초/60)). 반올림하되 최소 1분.
 * 음수·비숫자 입력은 방어적으로 0초로 간주해 최소값 1분을 반환한다.
 *
 * @param {number} secs 소요시간(초)
 * @returns {number} 표시용 분 (1 이상의 정수)
 */
export const fmtMinutes = (secs) => {
  const s = typeof secs === 'number' && Number.isFinite(secs) && secs > 0 ? secs : 0
  return Math.max(1, Math.round(s / 60))
}

/**
 * 소요시간(초)을 "N분" 문자열로 변환한다.
 *
 * @param {number} secs 소요시간(초)
 * @returns {string} 예: "5분"
 */
export const fmtDuration = (secs) => `${fmtMinutes(secs)}분`

/**
 * 거리(m)를 표시용 문자열로 변환한다.
 *
 * 1000m 이상이면 km(소수 첫째 자리), 미만이면 m 단위로 표시한다.
 * 음수·비숫자 입력은 0m로 간주한다.
 *
 * @param {number} meters 거리(미터)
 * @returns {string} 예: "850m", "1.2km"
 */
export const fmtDistance = (meters) => {
  const m = typeof meters === 'number' && Number.isFinite(meters) && meters > 0
    ? Math.round(meters)
    : 0
  return m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${m}m`
}
