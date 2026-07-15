import { useEffect, useRef, useState } from 'react'
import { BADGE_LABELS } from './api'

const TYPE_COLOR = { 12: '#0d9488', 39: '#ea580c' } // 관광지 teal, 음식점 orange

// Tmap jsv2는 index.html에서 동기 로드됨 — Map 클래스가 준비될 때까지만 대기
function loadTmap() {
  return new Promise((resolve) => {
    const check = () =>
      window.Tmapv2?.Map ? resolve(window.Tmapv2) : setTimeout(check, 50)
    check()
  })
}

const dotIcon = (color, r = 6) =>
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${r * 2}" height="${r * 2}">
       <circle cx="${r}" cy="${r}" r="${r - 1.5}" fill="${color}" stroke="white" stroke-width="1.5"/>
     </svg>`,
  )

const pinIcon = (num, color) =>
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34">
       <circle cx="17" cy="17" r="14" fill="${color}" stroke="white" stroke-width="3"/>
       <text x="17" y="22" text-anchor="middle" font-size="14" font-weight="bold" fill="white"
             font-family="sans-serif">${num}</text>
     </svg>`,
  )

function popupHtml(p) {
  const badges = p.badges?.length
    ? p.badges.map((b) => `<span class="pop-badge">${BADGE_LABELS[b] || b}</span>`).join('')
    : '<span class="pop-none">접근성 배지 정보 없음</span>'
  return `<div class="pop">
    <div class="pop-title">${p.title}</div>
    <div class="pop-type">${p.type === 12 ? '관광지' : '음식점'}</div>
    <div class="pop-badges">${badges}</div>
  </div>`
}

export default function MapView({ places, course, route, center }) {
  const elRef = useRef(null)
  const mapRef = useRef(null)
  const [ready, setReady] = useState(false)
  const overlaysRef = useRef({ places: [], course: [], route: [] })
  const infoRef = useRef(null)

  const clear = (group) => {
    overlaysRef.current[group].forEach((o) => o.setMap(null))
    overlaysRef.current[group] = []
  }

  const openInfo = (T, map, position, html) => {
    infoRef.current?.setMap(null)
    infoRef.current = new T.InfoWindow({
      position, content: html, type: 2, border: '0', background: 'none', map,
    })
  }

  useEffect(() => {
    let cancelled = false
    loadTmap().then((T) => {
      if (cancelled || mapRef.current) return
      elRef.current.innerHTML = '' // StrictMode/HMR 재마운트 시 이전 인스턴스 잔재 제거
      mapRef.current = new T.Map(elRef.current, {
        center: new T.LatLng(37.5788, 126.977),
        width: '100%', height: '100%', zoom: 15, httpsMode: true,
      })
      if (import.meta.env.DEV) window.__tmap = mapRef.current
      setReady(true)
    })
    return () => {
      cancelled = true
      try { mapRef.current?.destroy?.() } catch { /* Tmap destroy 미지원 대비 */ }
      if (elRef.current) elRef.current.innerHTML = ''
      mapRef.current = null
    }
  }, [])

  // 지역 전환 시 지도 이동
  useEffect(() => {
    if (!ready || !center) return
    const T = window.Tmapv2
    mapRef.current.setCenter(new T.LatLng(center.lat, center.lng))
    mapRef.current.setZoom(15)
  }, [ready, center?.lat, center?.lng])

  // 전체 장소 점 마커
  useEffect(() => {
    if (!ready) return
    const T = window.Tmapv2
    clear('places')
    places.forEach((p) => {
      const m = new T.Marker({
        position: new T.LatLng(p.lat, p.lng),
        icon: dotIcon(TYPE_COLOR[p.type] || '#64748b', p.badges?.length ? 6 : 4),
        iconSize: new T.Size(12, 12),
        map: mapRef.current,
        title: p.title,
      })
      m.addListener('click', () =>
        openInfo(T, mapRef.current, new T.LatLng(p.lat, p.lng), popupHtml(p)),
      )
      overlaysRef.current.places.push(m)
    })
  }, [ready, places])

  // 코스 번호 핀
  useEffect(() => {
    if (!ready) return
    const T = window.Tmapv2
    clear('course')
    course.forEach((c, i) => {
      const m = new T.Marker({
        position: new T.LatLng(c.place.lat, c.place.lng),
        icon: pinIcon(i + 1, c.place.type === 39 ? '#ea580c' : '#0d9488'),
        iconSize: new T.Size(34, 34),
        map: mapRef.current,
        zIndex: 1000,
      })
      m.addListener('click', () =>
        openInfo(T, mapRef.current, new T.LatLng(c.place.lat, c.place.lng), popupHtml(c.place)),
      )
      overlaysRef.current.course.push(m)
    })
  }, [ready, course])

  // 경로 폴리라인 — Tmap 좌표를 Tmap 지도에 그리므로 도로에 정확히 붙는다
  // ⚠️ Tmapv2.fitBounds는 빈 LatLngBounds+extend 조합에서 (27,-180)으로 날아가는
  //    버그가 있어 직접 중심·줌을 계산한다.
  useEffect(() => {
    if (!ready) return
    const T = window.Tmapv2
    clear('route')
    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180, hasPoint = false
    route?.legs?.forEach((leg) => {
      const path = leg.polyline.map(([lat, lng]) => {
        if (lat < minLat) minLat = lat
        if (lat > maxLat) maxLat = lat
        if (lng < minLng) minLng = lng
        if (lng > maxLng) maxLng = lng
        hasPoint = true
        return new T.LatLng(lat, lng)
      })
      const DIFF_COLOR = { 어려움: '#dc2626', 중간: '#f59e0b' }
      const line = new T.Polyline({
        path,
        strokeColor: DIFF_COLOR[leg.difficulty] || '#2563eb',
        strokeWeight: 6,
        strokeStyle: leg.stairsPossible ? 'dash' : 'solid', // 점선 = 계단 가능성
        strokeOpacity: 90,
        map: mapRef.current,
      })
      overlaysRef.current.route.push(line)
    })
    if (hasPoint) {
      const spanKm = Math.max((maxLat - minLat) * 111, (maxLng - minLng) * 88)
      const zoom = spanKm > 8 ? 12 : spanKm > 4 ? 13 : spanKm > 2 ? 14 : spanKm > 0.8 ? 15 : 16
      mapRef.current.setCenter(new T.LatLng((minLat + maxLat) / 2, (minLng + maxLng) / 2))
      mapRef.current.setZoom(zoom)
    }
  }, [ready, route])

  return <div id="map" ref={elRef} role="application" aria-label="무장애 여행 지도" />
}
