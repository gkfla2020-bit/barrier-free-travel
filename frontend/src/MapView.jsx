import { useEffect, useRef, useState } from 'react'
import { BADGE_LABELS } from './api'
import { SLOPE_COLOR, slopeSegments } from './slope'

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

export default function MapView({ places, course, route, center, origin, lineMode = 'difficulty' }) {
  const elRef = useRef(null)
  const mapRef = useRef(null)
  const [ready, setReady] = useState(false)
  const overlaysRef = useRef({ places: [], course: [], route: [], origin: [] })
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

  // 출발지 마커 (역·터미널 또는 내 위치)
  useEffect(() => {
    if (!ready) return
    const T = window.Tmapv2
    clear('origin')
    if (!origin) return
    const m = new T.Marker({
      position: new T.LatLng(origin.lat, origin.lng),
      icon: pinIcon('출', '#334155'),
      iconSize: new T.Size(34, 34),
      map: mapRef.current,
      zIndex: 1100,
      title: origin.name,
    })
    overlaysRef.current.origin.push(m)
  }, [ready, origin?.lat, origin?.lng])

  // 경로 폴리라인 — Tmap 좌표를 Tmap 지도에 그리므로 도로에 정확히 붙는다
  // lineMode: 'difficulty'=구간 난이도(worst-element) / 'slope'=지형 경사 등급.
  //   경사는 난이도와 산정 로직이 달라(구간 단위 vs 90m 표본 단위) 한 선에 겹쳐 칠할 수 없다.
  //   같은 색이 모드마다 다른 뜻이라 범례도 App.jsx에서 함께 바뀐다.
  // ⚠️ Tmapv2.fitBounds는 빈 LatLngBounds+extend 조합에서 (27,-180)으로 날아가는
  //    버그가 있어 직접 중심·줌을 계산한다.
  useEffect(() => {
    if (!ready) return
    const T = window.Tmapv2
    clear('route')
    const DIFF_COLOR = { 어려움: '#dc2626', 중간: '#f59e0b' }
    const draw = (path, color, dashed) =>
      overlaysRef.current.route.push(new T.Polyline({
        path: path.map(([lat, lng]) => new T.LatLng(lat, lng)),
        strokeColor: color, strokeWeight: 6,
        strokeStyle: dashed ? 'dash' : 'solid', // 점선 = 계단 가능성 (두 모드 공통)
        strokeOpacity: 90, map: mapRef.current,
      }))

    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180, hasPoint = false
    // 픽스처(데모) 경로는 요청한 코스와 무관한 광화문 좌표다. 지도에 그리면 코스 핀과
    // 동떨어진 선이 그려져 진짜 경로인 척 하게 된다 — 아예 안 그린다 (RouteSteps가 이유를 알림).
    const legs = route?.fallback ? [] : (route?.legs ?? [])
    legs.forEach((leg) => {
      // 경사 회피로 바뀐 구간은 '원래 가려던 길'을 회색 점선으로 깔아 우회를 눈에 보이게 한다
      if (leg.detour && leg.baseline?.polyline?.length) {
        overlaysRef.current.route.push(new T.Polyline({
          path: leg.baseline.polyline.map(([lat, lng]) => new T.LatLng(lat, lng)),
          strokeColor: '#94a3b8', strokeWeight: 4, strokeStyle: 'dot',
          strokeOpacity: 70, map: mapRef.current,
        }))
      }
      leg.polyline.forEach(([lat, lng]) => {
        if (lat < minLat) minLat = lat
        if (lat > maxLat) maxLat = lat
        if (lng < minLng) minLng = lng
        if (lng > maxLng) maxLng = lng
        hasPoint = true
      })
      if (lineMode === 'slope') {
        // 한 구간 안에서도 경사가 바뀌므로 폴리라인을 등급별로 잘라 칠한다
        slopeSegments(leg).forEach((sg) =>
          draw(sg.path, SLOPE_COLOR[sg.cls], leg.stairsPossible))
      } else {
        draw(leg.polyline, DIFF_COLOR[leg.difficulty] || '#2563eb', leg.stairsPossible)
      }
    })
    if (hasPoint) {
      const spanKm = Math.max((maxLat - minLat) * 111, (maxLng - minLng) * 88)
      const zoom = spanKm > 8 ? 12 : spanKm > 4 ? 13 : spanKm > 2 ? 14 : spanKm > 0.8 ? 15 : 16
      mapRef.current.setCenter(new T.LatLng((minLat + maxLat) / 2, (minLng + maxLng) / 2))
      mapRef.current.setZoom(zoom)
    }
  }, [ready, route, lineMode])

  return <div id="map" ref={elRef} role="application" aria-label="무장애 여행 지도" />
}
