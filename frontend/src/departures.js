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

// ---------------------------------------------------------------------------
// 채팅 기반 출발지 인식 (Req 3, 4)
//
// 사용자가 "광화문역에서 출발", "시청에서 시작", "서울역"처럼 입력하면 활성 지역의
// 출발지 후보에서 이름/별칭/부분 일치로 인식한다. 순수 함수로 유지해 테스트가 쉽다.

// 출발 의도 표현 — 제거(정규화) 대상이자 intent 판정 토큰
const INTENT_TOKENS = ['출발', '시작', '갈게', '갈래', '할게', '부터']
// 조사/후위 표현 — 정규화 시 제거
const PARTICLES = ['에서', '에', '서', '으로', '로', '요']
// 접미사 동등화 — "시청"이 "시청역"과 매칭되도록
const SUFFIXES = ['역', '터미널', '시청']

/**
 * 매칭용 정규화 문자열을 만든다 (Req 3.4).
 * - 앞뒤/내부 공백 정규화
 * - 출발 의도어·조사 제거
 * - 후행 접미사(역/터미널/시청) 제거로 동등화 (멱등)
 * - 라틴 문자만 소문자화
 * 빈 값/비문자열은 ''를 반환(방어적).
 */
export function normalizeDeparture(text) {
  if (typeof text !== 'string') return ''
  let s = text.trim().replace(/\s+/g, ' ')
  if (!s) return ''
  // 의도어·조사 제거 (긴 토큰 우선)
  for (const tok of [...INTENT_TOKENS, ...PARTICLES].sort((a, b) => b.length - a.length)) {
    s = s.split(tok).join('')
  }
  s = s.trim()
  // 후행 접미사 반복 제거 (멱등 보장)
  let changed = true
  while (changed) {
    changed = false
    for (const suf of SUFFIXES) {
      if (s.length > suf.length && s.endsWith(suf)) {
        s = s.slice(0, -suf.length)
        changed = true
      }
    }
  }
  // 라틴 문자만 소문자화 (한글은 대소문자 없음)
  return s.replace(/[A-Z]/g, (c) => c.toLowerCase()).trim()
}

const _hasIntent = (text) => {
  const t = String(text || '')
  return INTENT_TOKENS.some((k) => t.includes(k)) || /에서|부터/.test(t)
}

const _aliasList = (dep) =>
  Array.isArray(dep?.aliases) ? dep.aliases.filter((a) => typeof a === 'string') : []

/**
 * 채팅 입력에서 활성 지역의 출발지를 인식한다 (Req 3, 4).
 *
 * 정밀도 우선순위: (1) 이름 정확 일치 → (2) 별칭 정확 일치 → (3) 부분 문자열 일치.
 * 가장 높은 정밀도 단계의 후보 집합을 결과로 삼고 중복 제거 후 개수로 분류한다.
 *
 * @returns {{status:'single'|'multiple'|'none'|'notfound', matches:Array, intent:boolean}}
 */
export function recognizeDeparture(text, region) {
  const intent = _hasIntent(text)
  const empty = { status: intent ? 'notfound' : 'none', matches: [], intent }
  if (typeof text !== 'string' || !text.trim() || !region) return empty

  const deps = validDepartures(region)
  if (!deps.length) return empty

  const key = normalizeDeparture(text)
  if (!key) return empty

  const exact = [], aliasHit = [], partial = []
  for (const dep of deps) {
    const nk = normalizeDeparture(dep.name)
    if (nk && (key === nk || key.includes(nk) || nk.includes(key))) {
      // 이름 정확/포함
      if (key === nk) exact.push(dep)
      else partial.push(dep)
    }
    for (const al of _aliasList(dep)) {
      const ak = normalizeDeparture(al)
      if (!ak) continue
      if (key === ak) aliasHit.push(dep)
      else if (key.includes(ak) || ak.includes(key)) partial.push(dep)
    }
  }

  // 정밀도 높은 단계부터 채택
  let picked = exact.length ? exact : aliasHit.length ? aliasHit : partial
  // 중복 제거 (같은 출발지)
  const seen = new Set()
  picked = picked.filter((d) => {
    const id = `${d.name}@${d.lat},${d.lng}`
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })

  if (picked.length === 1) return { status: 'single', matches: picked, intent }
  if (picked.length >= 2) return { status: 'multiple', matches: picked, intent }
  return empty
}

/**
 * 경로 출발지 우선순위 결정 (Req 1.6, 6.4, 6.5) — 순수 함수.
 * 선택 출발지 > 내 위치(지역 내부) > 유효 departures[0] > 지역 기본 origin.
 */
export function resolveOrigin({ selectedDeparture, myLoc, region }) {
  if (selectedDeparture) return selectedDeparture
  if (isInsideBbox(myLoc, region)) return myLoc
  const valid = validDepartures(region)
  return valid[0] || region?.origin
}
