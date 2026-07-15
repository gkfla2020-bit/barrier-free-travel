// 출발지(Departure_Point) 검증 유틸 (Req 1.6)
//
// REGIONS의 각 지역은 정확히 2개의 고정 출발지(departures)를 가진다.
// 이 모듈은 각 출발지 정의가 유효한지 검사해, 불합격 지점을 선택 목록에서 제외하고
// 제외 사유를 console.warn으로 기록한다. 순수 함수로 유지해 테스트가 쉽도록 한다.

// 유효한 출발지 유형 집합
export const DEPARTURE_TYPES = ['지하철역', '버스터미널', '주차장']

const NAME_MIN = 1
const NAME_MAX = 60
const LAT_MIN = -90
const LAT_MAX = 90
const LNG_MIN = -180
const LNG_MAX = 180

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v)

/**
 * 단일 출발지가 지역 내에서 유효한지 검사한다.
 *
 * 유효 조건:
 *  - name: 1~60자 문자열
 *  - lat: 숫자, -90 ~ 90
 *  - lng: 숫자, -180 ~ 180
 *  - lat/lng가 region.bbox [minLat, maxLat, minLng, maxLng] 내부
 *
 * @param {{name?: string, lat?: number, lng?: number, type?: string}} dep
 * @param {{bbox?: [number, number, number, number]}} region
 * @returns {{valid: boolean, reason: string}} valid가 false면 reason에 사유가 담긴다.
 */
export function validateDeparture(dep, region) {
  if (!dep || typeof dep !== 'object') {
    return { valid: false, reason: '출발지 정의가 없습니다' }
  }

  const { name, lat, lng } = dep

  // 이름 검증
  if (typeof name !== 'string' || name.length < NAME_MIN || name.length > NAME_MAX) {
    return {
      valid: false,
      reason: `이름은 ${NAME_MIN}~${NAME_MAX}자여야 합니다 (받은 값: ${JSON.stringify(name)})`,
    }
  }

  // 좌표 숫자 검증
  if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) {
    return { valid: false, reason: `위도/경도가 숫자가 아닙니다 (lat: ${lat}, lng: ${lng})` }
  }

  // 좌표 범위 검증
  if (lat < LAT_MIN || lat > LAT_MAX) {
    return { valid: false, reason: `위도가 범위(${LAT_MIN}~${LAT_MAX})를 벗어났습니다 (lat: ${lat})` }
  }
  if (lng < LNG_MIN || lng > LNG_MAX) {
    return { valid: false, reason: `경도가 범위(${LNG_MIN}~${LNG_MAX})를 벗어났습니다 (lng: ${lng})` }
  }

  // bbox 내부 검증
  const bbox = region?.bbox
  if (!Array.isArray(bbox) || bbox.length < 4 || !bbox.every(isFiniteNumber)) {
    return { valid: false, reason: '지역 bbox가 올바르지 않습니다' }
  }
  const [minLat, maxLat, minLng, maxLng] = bbox
  if (lat < minLat || lat > maxLat || lng < minLng || lng > maxLng) {
    return {
      valid: false,
      reason: `좌표가 지역 bbox [${minLat}, ${maxLat}, ${minLng}, ${maxLng}] 밖입니다 (lat: ${lat}, lng: ${lng})`,
    }
  }

  return { valid: true, reason: '' }
}

/**
 * 지역의 유효한 출발지만 반환한다. 불합격 출발지는 제외하고 console.warn으로 사유를 기록한다.
 *
 * @param {{departures?: Array, name?: string, bbox?: [number, number, number, number]}} region
 * @returns {Array} 유효한 출발지 배열
 */
export function validDepartures(region) {
  const departures = region?.departures
  if (!Array.isArray(departures)) return []

  return departures.filter((dep) => {
    const { valid, reason } = validateDeparture(dep, region)
    if (!valid) {
      console.warn(`[departures] excluded: ${dep?.name} — ${reason}`)
    }
    return valid
  })
}

// ---------------------------------------------------------------------------
// 출발지 옵션 개수 로직 (Req 2.5, 2.6)
//
// "내 위치" 옵션을 추가로 노출할지 여부는 기기 위치가 활성 지역 bbox 내부인지에
// 달려 있다. 이 판정을 순수 함수로 분리해 단위/속성 테스트가 쉽도록 한다.
// DepartureSelector는 departureOptions()가 반환한 목록을 그대로 렌더하므로
// 옵션 개수(2 또는 3)는 여기서 결정되는 테스트 가능한 순수 로직이다.

/**
 * 위치가 지역 bbox [minLat, maxLat, minLng, maxLng] 내부인지 판정한다.
 *
 * loc 또는 region.bbox가 없거나 좌표가 숫자가 아니면 false를 반환한다.
 *
 * @param {{lat?: number, lng?: number} | null | undefined} loc
 * @param {{bbox?: [number, number, number, number]} | null | undefined} region
 * @returns {boolean} 위치가 bbox 내부에 있으면 true
 */
export function isInsideBbox(loc, region) {
  if (!loc || typeof loc !== 'object') return false
  const { lat, lng } = loc
  if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) return false

  const bbox = region?.bbox
  if (!Array.isArray(bbox) || bbox.length < 4 || !bbox.every(isFiniteNumber)) return false

  const [minLat, maxLat, minLng, maxLng] = bbox
  return lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng
}

/**
 * 지역의 선택 가능한 출발지 옵션 목록을 반환한다.
 *
 * 항상 지역의 유효한 고정 출발지(validDepartures)를 포함하고,
 * myLoc이 지역 bbox 내부에 있으면 "내 위치" 옵션을 추가로 붙인다 (Req 2.5).
 * 그렇지 않으면(권한 거부/bbox 밖) 고정 출발지만 반환한다 (Req 2.6).
 *
 * 각 옵션은 {name, lat, lng, type} 형태이며, "내 위치" 옵션은 type='내 위치'로 표시된다.
 *
 * @param {{departures?: Array, bbox?: [number, number, number, number]}} region
 * @param {{lat?: number, lng?: number, name?: string} | null | undefined} myLoc
 * @returns {Array<{name: string, lat: number, lng: number, type: string}>}
 */
export function departureOptions(region, myLoc) {
  const fixed = validDepartures(region)
  if (!isInsideBbox(myLoc, region)) return fixed

  return [
    ...fixed,
    { name: myLoc.name || '내 위치', lat: myLoc.lat, lng: myLoc.lng, type: '내 위치' },
  ]
}
