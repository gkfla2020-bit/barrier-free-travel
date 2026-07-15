import { useState } from 'react'
import { BADGE_LABELS } from './api'

export const MOBILITY_TYPES = ['전동 휠체어', '수동 휠체어+동반자', '유모차 가족', '고령 보행약자', '목발/깁스']
const FACILITIES = [
  { label: '🚻 장애인 화장실', badge: 'toilet' },
  { label: '🅿️ 장애인 주차', badge: 'parking' },
  { label: '🛗 엘리베이터', badge: 'elevator' },
  { label: '♿ 휠체어 대여', badge: 'wheelchair' },
]
const TASTES = ['역사/문화', '자연/힐링', '인스타 핫플', '식도락']

function Chip({ active, onClick, children }) {
  return (
    <button className={`p-chip${active ? ' on' : ''}`} onClick={onClick}>
      {children}
    </button>
  )
}

export function PersonaSurvey({ onSubmit, onClose }) {
  const [type, setType] = useState(MOBILITY_TYPES[0])
  const [facs, setFacs] = useState(new Set(['toilet']))
  const [tastes, setTastes] = useState(new Set())

  const toggle = (set, setter) => (v) => {
    const n = new Set(set)
    n.has(v) ? n.delete(v) : n.add(v)
    setter(n)
  }

  return (
    <section className="persona">
      <div className="p-head">
        <strong>📋 나에게 맞는 여행 조건</strong>
        <button className="p-close" onClick={onClose} aria-label="닫기">✕</button>
      </div>
      <p className="p-q">이동 약자 유형 <em>필수</em></p>
      <div className="p-row">
        {MOBILITY_TYPES.map((t) => (
          <Chip key={t} active={type === t} onClick={() => setType(t)}>{t}</Chip>
        ))}
      </div>
      <p className="p-q">꼭 필요한 편의시설 <em>복수 선택</em></p>
      <div className="p-row">
        {FACILITIES.map((f) => (
          <Chip key={f.badge} active={facs.has(f.badge)} onClick={() => toggle(facs, setFacs)(f.badge)}>
            {f.label}
          </Chip>
        ))}
      </div>
      <p className="p-q">여행 취향 <em>선택</em></p>
      <div className="p-row">
        {TASTES.map((t) => (
          <Chip key={t} active={tastes.has(t)} onClick={() => toggle(tastes, setTastes)(t)}>{t}</Chip>
        ))}
      </div>
      <button className="p-submit"
              onClick={() => onSubmit({ type, badges: [...facs], tastes: [...tastes] })}>
        🃏 조건에 맞는 후보 보기
      </button>
    </section>
  )
}

export function CardDeck({ cards, onDone, onClose }) {
  const [idx, setIdx] = useState(0)
  const [picked, setPicked] = useState([])
  const [anim, setAnim] = useState('')

  const card = cards[idx]
  const advance = (take) => {
    if (anim) return // 애니메이션 중 연타 방지 (중복 담기/스킵 버그)
    setAnim(take ? 'take' : 'toss')
    setTimeout(() => {
      setAnim('')
      const next = take ? [...picked, card] : picked
      if (take) setPicked(next)
      if (idx + 1 >= cards.length) onDone(next)
      else setIdx(idx + 1)
    }, 220)
  }

  if (!card) return null
  const raw = Object.entries(card.detail?.accessibilityRaw || {}).slice(0, 3)

  return (
    <section className="deck">
      <div className="p-head">
        <strong>🃏 마음에 들면 담기 ({idx + 1}/{cards.length} · 담음 {picked.length})</strong>
        <button className="p-close" onClick={() => onDone(picked)} aria-label="선택 종료">완료</button>
        <button className="p-close" onClick={onClose} aria-label="닫기">✕</button>
      </div>
      <div className={`card ${anim}`}>
        {card.detail?.image
          ? <img src={card.detail.image} alt="" className="card-img" />
          : <div className="card-img none">🏛️</div>}
        <div className="card-body">
          <div className="card-title">
            {card.place.title}
            <span className="ctype">{card.place.type === 39 ? '음식점' : '관광지'}</span>
          </div>
          <div className="card-badges">
            {card.place.badges.map((b) => (
              <span key={b} className="badge big">{BADGE_LABELS[b]}</span>
            ))}
          </div>
          <ul className="card-raw">
            {raw.map(([k, v]) => <li key={k}><b>{k}</b> {v}</li>)}
            {!raw.length && <li>상세 접근성 원문 없음 — 배지 기준으로 선별된 곳입니다.</li>}
          </ul>
        </div>
        <div className="card-actions">
          <button className="toss" onClick={() => advance(false)}>← 패스</button>
          <button className="take" onClick={() => advance(true)}>담기 →</button>
        </div>
      </div>
    </section>
  )
}
