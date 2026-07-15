const json = (r) => {
  if (!r.ok) throw new Error(`API ${r.status}`)
  return r.json()
}

export async function fetchAllPlaces(bbox) {
  // 백엔드 limit 100 → 유형별로 나눠 호출 후 병합. bbox = [minLat, maxLat, minLng, maxLng]
  const q = `minLat=${bbox[0]}&maxLat=${bbox[1]}&minLng=${bbox[2]}&maxLng=${bbox[3]}`
  const [tours, foods] = await Promise.all([
    fetch(`/api/places?${q}&type=12`).then(json),
    fetch(`/api/places?${q}&type=39`).then(json),
  ])
  return [...tours, ...foods]
}

export const fetchPlaceDetail = (id) => fetch(`/api/places/${id}`).then(json)

export const postChat = (message, region = 'seoul') =>
  fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, region }),
  }).then(json)

// opts는 옵션 객체 { mode, avoidSlope } — 기존 호출부 호환을 위해 문자열(mode)도 허용
export const postRoute = (waypoints, opts = {}) => {
  const { mode = 'walk', avoidSlope = false } =
    typeof opts === 'string' ? { mode: opts } : opts
  return fetch('/api/route', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ waypoints, mode, avoidSlope }),
  }).then(json)
}

// 자유 발화 → 지역/랜드마크 인텐트 해석 (Task 3)
// 응답: { regionId, landmark: {name,lat,lng}|null, confidence }
// 백엔드 미배포·네트워크 실패 시 조용히 null을 반환해 기존 흐름을 유지한다.
export async function postIntent(text) {
  try {
    const r = await fetch('/api/intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    if (!r.ok) return null
    return await r.json()
  } catch {
    return null
  }
}

// 코스 장소별 500m 이내 최근접 접근 화장실 커버리지 (Req 7.1, 7.4, 7.5)
// places = [{ contentId, lat, lng, badges }] → { items: [{ contentId, restroom: {name,lat,lng,distance,isSelf}|null }] }
export const postRestroomCoverage = (places) =>
  fetch('/api/restrooms/coverage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ places }),
  }).then(json)

export const BADGE_LABELS = {
  wheelchair: '휠체어',
  elevator: '엘리베이터',
  toilet: '장애인 화장실',
  parking: '장애인 주차',
}
