// 이모지 대신 쓰는 미니 SVG 아이콘 세트 — 일관된 스트로크·컬러
export function Logo({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="7" fill="#0d9488" />
      <circle cx="12" cy="7.6" r="2.3" fill="#fff" />
      <path d="M6.5 17.5c.8-3.4 2.8-5.2 5.5-5.2s4.7 1.8 5.5 5.2"
            stroke="#fff" strokeWidth="2.1" fill="none" strokeLinecap="round" />
      <circle cx="17.5" cy="17.5" r="1.4" fill="#5eead4" />
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
