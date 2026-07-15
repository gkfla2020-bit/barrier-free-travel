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

// 검색어가 어느 지역·장소를 가리키는지만 확인 (메모리 연산, LLM 호출 0).
// 하드코딩 키워드에 없는 장소명("남산", "동백섬")도 백엔드가 전 지역 데이터로 찾아준다.
export const resolvePlace = (q, region = 'seoul') =>
  fetch(`/api/resolve?q=${encodeURIComponent(q)}&region=${region}`).then(json)

// 자유 텍스트 → 출발지/코스 매칭 (Claude Haiku — 오타·유사어 허용, 예: "재주"→제주)
export const postOnboard = (text) =>
  fetch('/api/onboard', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  }).then(json)

// mode: walk | transit · avoidSlope: 켜면 더 돌더라도 경사가 완만한 경로 (응답 느려짐)
export const postRoute = (waypoints, mode = 'walk', avoidSlope = false) =>
  fetch('/api/route', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ waypoints, mode, avoidSlope }),
  }).then(json)

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
