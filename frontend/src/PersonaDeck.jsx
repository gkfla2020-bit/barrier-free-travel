import { useState } from 'react'
import { BADGE_LABELS } from './api'
import { Logo, BadgeIcon } from './Icons'

export const MOBILITY_TYPES = ['전동 휠체어', '수동 휠체어+동반자', '유모차 가족', '고령 보행약자', '목발/깁스']
const FACILITIES = [
  { label: '장애인 화장실', badge: 'toilet' },
  { label: '장애인 주차', badge: 'parking' },
  { label: '엘리베이터', badge: 'elevator' },
  { label: '휠체어 대여', badge: 'wheelchair' },
]
const TASTES = ['역사/문화', '자연/힐링', '인스타 핫플', '식도락']
const PACES = [
  { id: 'easy', label: '여유롭게 · 짧은 동선' },
  { id: 'full', label: '알차게 · 많이 보기' },
]

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
  const [pace, setPace] = useState('easy')

  const toggle = (set, setter) => (v) => {
    const n = new Set(set)
    n.has(v) ? n.delete(v) : n.add(v)
    setter(n)
  }

  return (
    <section className="persona">
      <div className="p-hero">
        <div className="p-hero-logo"><Logo size={44} /></div>
        <h2>어떤 여행자이신가요?</h2>
        <p>이동 조건에 <b>100% 맞는 안전한 장소만</b> 골라드릴게요.<br />
          딱 세 가지만 알려주세요 — 30초면 충분해요.</p>
        <div className="p-steps">
          <span className="on">① 이동 조건</span><span>② 후보 카드</span><span>③ 맞춤 코스</span>
        </div>
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
            <BadgeIcon badge={f.badge} /> {f.label}
          </Chip>
        ))}
      </div>
      <p className="p-q">일정 강도 <em>필수</em></p>
      <div className="p-row">
        {PACES.map((pc) => (
          <Chip key={pc.id} active={pace === pc.id} onClick={() => setPace(pc.id)}>{pc.label}</Chip>
        ))}
      </div>
      <p className="p-q">여행 취향 <em>선택</em></p>
      <div className="p-row">
        {TASTES.map((t) => (
          <Chip key={t} active={tastes.has(t)} onClick={() => toggle(tastes, setTastes)(t)}>{t}</Chip>
        ))}
      </div>
      <button className="p-submit"
              onClick={() => onSubmit({ type, badges: [...facs], tastes: [...tastes], pace })}>
        조건에 맞는 후보 보기
      </button>
      <button className="p-skip" onClick={onClose}>
        건너뛰고 채팅으로 물어볼게요 →
      </button>
    </section>
  )
}

export function CardDeck({ groups, onDone, onClose }) {
  // groups: [{label:'여행지', items:[{place,detail}]}, {label:'식당'...}, {label:'카페'...}]
  const [gi, setGi] = useState(0)
  const [ci, setCi] = useState(0)
  const [picked, setPicked] = useState([])

  const group = groups[gi]
  const card = group?.items[ci]
  // 상태 전환은 클릭 즉시 처리 (타이머에 넣으면 탭 스로틀링·연타에서 클릭 유실).
  const advance = (take) => {
    const next = take ? [...picked, card] : picked
    if (take) setPicked(next)
    if (ci + 1 < group.items.length) setCi(ci + 1)
    else if (gi + 1 < groups.length) { setGi(gi + 1); setCi(0) }
    else onDone(next)
  }

  if (!card) return null
  const raw = Object.entries(card.detail?.accessibilityRaw || {}).slice(0, 3)

  return (
    <section className="deck">
      <div className="p-head">
        <strong>{group.label} 고르기 ({ci + 1}/{group.items.length}) · 담음 {picked.length}</strong>
        <button className="p-close" onClick={() => onDone(picked)} aria-label="선택 종료">완료</button>
        <button className="p-close" onClick={onClose} aria-label="닫기">✕</button>
      </div>
      <div className="deck-steps">
        {groups.map((g, i) => (
          <span key={g.label} className={i === gi ? 'on' : i < gi ? 'done' : ''}>
            {g.label} {i < gi && '✓'}
          </span>
        ))}
      </div>
      <div className="card enter" key={`${gi}-${ci}`}>
        {card.detail?.image
          ? <img src={card.detail.image} alt="" className="card-img" />
          : <div className="card-img none">{card.place.title.slice(0, 1)}</div>}
        <div className="card-body">
          <div className="card-title">
            {card.place.title}
            <span className="ctype">{{ tour: '관광지', food: '음식점', cafe: '카페' }[card.place.category] || '관광지'}</span>
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
