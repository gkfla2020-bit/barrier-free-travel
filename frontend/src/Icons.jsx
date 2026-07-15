import logoUrl from './assets/logo.png'

// 이모지 대신 쓰는 미니 SVG 아이콘 세트 — 일관된 스트로크·컬러
// 브랜드 팔레트: 편해질(앰버 #f5a04b) · 지도(코랄 #e2574b) · 접힌 지도 아이콘

// 접힌 지도 — 로고 우측 아이콘 재현 (지그재그 3면, 앰버/코랄 교차)
export function MapFold({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.5 5.8 9 3.2v15.4l-5.5 2.6z" fill="#f6a04d" />
      <path d="M9 3.2l6 2.6v15.4l-6-2.6z" fill="#e2574b" />
      <path d="M15 5.8 20.5 3.2v15.4L15 21.2z" fill="#f6a04d" />
    </svg>
  )
}

// 워드마크 — 원본 손글씨 로고 PNG (720×201, 투명 배경).
// size는 기존 폰트 크기 의미를 유지 — 이미지 높이로 환산해 호출부 변경 없이 동작.
export function Wordmark({ size = 18 }) {
  return (
    <img className="wordmark-img" src={logoUrl} alt="편해질지도"
         style={{ height: Math.round(size * 1.55), width: 'auto', display: 'block' }} />
  )
}

export function Logo({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="7" fill="#f6a04d" />
      <circle cx="12" cy="7.6" r="2.3" fill="#fff" />
      <path d="M6.5 17.5c.8-3.4 2.8-5.2 5.5-5.2s4.7 1.8 5.5 5.2"
            stroke="#fff" strokeWidth="2.1" fill="none" strokeLinecap="round" />
      <circle cx="17.5" cy="17.5" r="1.4" fill="#e2574b" />
    </svg>
  )
}

const P = { stroke: 'currentColor', strokeWidth: 1.8, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' }

export const BadgeIcon = ({ badge, size = 13 }) => {
  const common = { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true }
  switch (badge) {
    case 'wheelchair':
      return (
        <svg {...common}>
          <circle cx="10" cy="4.5" r="2" fill="currentColor" />
          <path d="M10 7v5h5l3 6" {...P} />
          <path d="M13.5 19a5 5 0 1 1-6.9-6.6" {...P} />
        </svg>
      )
    case 'toilet':
      return (
        <svg {...common}>
          <circle cx="8" cy="4.5" r="1.8" fill="currentColor" />
          <path d="M8 7.5v5M5.5 9.5h5M8 12.5l-1.8 6M8 12.5l1.8 6" {...P} />
          <circle cx="16.5" cy="4.5" r="1.8" fill="currentColor" />
          <path d="M16.5 7.5l-2 6h4l-2-6zM16.5 13.5v5" {...P} />
        </svg>
      )
    case 'parking':
      return (
        <svg {...common}>
          <rect x="4" y="4" width="16" height="16" rx="3.5" {...P} />
          <path d="M10 16.5v-9h3.2a2.8 2.8 0 1 1 0 5.6H10" {...P} />
        </svg>
      )
    case 'elevator':
      return (
        <svg {...common}>
          <rect x="4.5" y="3.5" width="15" height="17" rx="2.5" {...P} />
          <path d="M9.5 10.5l2-2.5 2 2.5M9.5 14l2 2.5 2-2.5" {...P} transform="translate(0.5 0)" />
        </svg>
      )
    default:
      return null
  }
}
