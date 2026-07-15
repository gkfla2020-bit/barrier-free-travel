import { useEffect, useRef, useState } from 'react'
import { BADGE_LABELS } from './api'
import { renderablePolylineCount } from './mapdraw'
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

// 화장실 커버리지 마커 — 장소 점(원)·코스 핀과 구분되는 작은 사각형 아이콘
const restroomIcon = (color = '#2563eb') =>
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18">
       <rect x="2" y="2" width="14" height="14" rx="3" fill="${color}" stroke="white" stroke-width="2"/>
       <text x="9" y="13" text-anchor="middle" font-size="9" font-weight="bold" fill="white"
             font-family="sans-serif">WC</text>
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

export default function MapView({ places, course, route, center, origin, restrooms = [], lineMode = 'difficulty', hidden = false }) {
  const elRef = useRef(null)
  const mapRef = useRef(null)
  const [ready, setReady] = useState(false)
  const overlaysRef = useRef({ places: [], course: [], route: [], origin: [], restrooms: [] })
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

  // 온보딩(숨김) → 지도 단계 전환 시 리사이즈 — 숨김 상태에서 초기화된 Tmap은
  // 컨테이너 크기 0으로 남아 타일이 안 그려질 수 있다.
  useEffect(() => {
    if (!ready || hidden) return
    requestAnimationFrame(() => {
      try {
        const el = elRef.current
        if (el && el.clientWidth > 0) mapRef.current.resize(el.clientWidth, el.clientHeight)
      } catch { /* Tmap resize 미지원 대비 */ }
    })
  }, [ready, hidden])

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

  // 화장실 커버리지 마커 (Req 6.6, 7.6) — {name, lat, lng} 좌표에 WC 마커
  useEffect(() => {
    if (!ready) return
    const T = window.Tmapv2
    clear('restrooms')
    ;(restrooms || []).forEach((r) => {
      const lat = r?.lat, lng = r?.lng
      if (typeof lat !== 'number' || typeof lng !== 'number') return
      const m = new T.Marker({
        position: new T.LatLng(lat, lng),
        icon: restroomIcon('#2563eb'),
        iconSize: new T.Size(18, 18),
        map: mapRef.current,
        zIndex: 900,
        title: r.name || '접근 가능 화장실',
      })
      overlaysRef.current.restrooms.push(m)
    })
  }, [ready, restrooms])

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

    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180, hasPoint = false
    const toPath = (coords) =>
      coords.map(([lat, lng]) => {
        if (lat < minLat) minLat = lat
        if (lat > maxLat) maxLat = lat
        if (lng < minLng) minLng = lng
        if (lng > maxLng) maxLng = lng
        hasPoint = true
        return new T.LatLng(lat, lng)
      })
    const addLine = (coords, color, dash, weight = 6) => {
      if (coords.length < 2) return
      overlaysRef.current.route.push(new T.Polyline({
        path: toPath(coords),
        strokeColor: color,
        strokeWeight: weight,
        strokeStyle: dash ? 'dash' : 'solid', // 점선 = 계단 가능성 (두 모드 공통)
        strokeOpacity: 90,
        map: mapRef.current,
      }))
    }
    // 픽스처(데모) 경로는 요청한 코스와 무관한 광화문 좌표다. 지도에 그리면 코스 핀과
    // 동떨어진 선이 그려져 진짜 경로인 척 하게 된다 — 아예 안 그린다 (RouteSteps가 이유를 알림).
    const legs = route?.fallback ? [] : (route?.legs ?? [])
    legs.forEach((leg) => {
      // 경사 회피로 바뀐 구간은 '원래 가려던 길'을 회색 점선으로 깔아 우회를 눈에 보이게 한다.
      // 고스트 선은 실제 이동 경로가 아니므로 bounds 계산에는 넣지 않는다 (toPath 대신 직접 map).
      if (leg.detour && leg.baseline?.polyline?.length) {
        overlaysRef.current.route.push(new T.Polyline({
          path: leg.baseline.polyline.map(([lat, lng]) => new T.LatLng(lat, lng)),
          strokeColor: '#94a3b8', strokeWeight: 4, strokeStyle: 'dot',
          strokeOpacity: 70, map: mapRef.current,
        }))
      }
      if (leg.segments?.length) {
        // 대중교통 leg: 도보(점선·난이도색) / 지하철(노선색) / 버스(녹색) 구간별로.
        // approx=true(정류장 간 개략 직선)면 점선으로 그려 실제 도로가 아님을 신호하고
        // 정류장 좌표에 작은 마커를 찍어 "정류장 to 정류장"임을 명확히 한다.
        leg.segments.forEach((s) => {
          if (s.mode === 'walk') {
            // 경사 모드에서 대중교통 leg의 도보 구간은 표고 미집계 → '모름' 회색으로.
            // 난이도색으로 칠하면 경사 범례와 같은 색이 다른 뜻이 되어 오해를 만든다.
            addLine(s.polyline,
              lineMode === 'slope' ? SLOPE_COLOR.unknown : (DIFF_COLOR[leg.difficulty] || '#2563eb'),
              true)
          } else {
            addLine(s.polyline, s.color || '#7c3aed', !!s.approx, 7)
            // 정류장마다 마커 — 클릭하면 정류장 이름을 보여준다.
            const stops = Array.isArray(s.stops) && s.stops.length
              ? s.stops
              : (Array.isArray(s.stationCoords) ? s.stationCoords.map(([lat, lng], k) => ({
                  name: s.stations?.[k] || '', lat, lng,
                })) : [])
            stops.forEach((st) => {
              if (typeof st.lat !== 'number' || typeof st.lng !== 'number') return
              const mk = new T.Marker({
                position: new T.LatLng(st.lat, st.lng),
                icon: dotIcon(s.color || '#7c3aed', 5),
                iconSize: new T.Size(10, 10),
                map: mapRef.current,
                title: st.name || '',
              })
              if (st.name) {
                const kind = s.mode === 'subway' ? '역' : '정류장'
                mk.addListener('click', () =>
                  openInfo(T, mapRef.current, new T.LatLng(st.lat, st.lng),
                    `<div class="pop"><div class="pop-title">${st.name}</div>` +
                    `<div class="pop-type">${s.name} · ${kind}</div></div>`),
                )
              }
              overlaysRef.current.route.push(mk)
            })
          }
        })
      } else if (lineMode === 'slope') {
        // 한 구간 안에서도 경사가 바뀌므로 폴리라인을 등급별로 잘라 칠한다
        slopeSegments(leg).forEach((sg) =>
          addLine(sg.path, SLOPE_COLOR[sg.cls], leg.stairsPossible))
      } else {
        addLine(leg.polyline, DIFF_COLOR[leg.difficulty] || '#2563eb',
                leg.stairsPossible) // 점선 = 계단 가능성
      }
    })
    // 렌더 루프가 그린 폴리라인 수는 순수 계산(좌표 ≥2점 구간 수)과 일치해야 한다 (Req 5.5)
    // 단, slope 모드는 등급별 분할로, fallback은 아예 안 그려서, detour는 회색 고스트 선이
    // 추가되어 순수 계산과 1:1 대응이 깨진다 — 기본(difficulty) 렌더에 고스트가 없을 때만 검사.
    if (import.meta.env.DEV && lineMode === 'difficulty' && !route?.fallback) {
      const hasGhost = legs.some((leg) => leg.detour && leg.baseline?.polyline?.length)
      if (!hasGhost) {
        const expected = renderablePolylineCount(route)
        const drawn = overlaysRef.current.route.filter((o) => o instanceof T.Polyline).length
        if (drawn !== expected) {
          console.warn(
            `[MapView] 폴리라인 렌더 수 불일치: 그림=${drawn}, 예상=${expected}`,
          )
        }
      }
    }
    if (hasPoint) {
      const spanKm = Math.max((maxLat - minLat) * 111, (maxLng - minLng) * 88)
      const zoom = spanKm > 8 ? 12 : spanKm > 4 ? 13 : spanKm > 2 ? 14 : spanKm > 0.8 ? 15 : 16
      mapRef.current.setCenter(new T.LatLng((minLat + maxLat) / 2, (minLng + maxLng) / 2))
      mapRef.current.setZoom(zoom)
    }
  }, [ready, route, lineMode])

  return <div id="map" ref={elRef} role="application" aria-label="무장애 여행 지도" />
}
