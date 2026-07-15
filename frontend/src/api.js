const json = (r) => {
  if (!r.ok) throw new Error(`API ${r.status}`)
  return r.json()
}

export async function fetchAllPlaces() {
  // 백엔드 limit 100 → 유형별로 나눠 호출 후 병합
  const bbox = 'minLat=37.4&maxLat=37.7&minLng=126.8&maxLng=127.2'
  const [tours, foods] = await Promise.all([
    fetch(`/api/places?${bbox}&type=12`).then(json),
    fetch(`/api/places?${bbox}&type=39`).then(json),
  ])
  return [...tours, ...foods]
}

export const fetchPlaceDetail = (id) => fetch(`/api/places/${id}`).then(json)

export const postChat = (message) =>
  fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  }).then(json)

export const postRoute = (waypoints) =>
  fetch('/api/route', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ waypoints }),
  }).then(json)

export const BADGE_LABELS = {
  wheelchair: '휠체어',
  elevator: '엘리베이터',
  toilet: '장애인 화장실',
  parking: '장애인 주차',
}
