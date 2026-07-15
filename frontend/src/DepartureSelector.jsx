import { useEffect, useState } from 'react'
import { departureOptions } from './departures'

const DISPLAY_THRESHOLD = 3  // 이 개수를 넘으면 "더 보기"로 접는다

// 출발지 선택 UI (Req 2.1, 2.3, 2.4, 2.5, 2.6)
//
// - 지역의 유효 출발지(고정 2개)를 이름 + 유형 라벨과 함께 선택 버튼으로 표시한다.
// - myLoc이 지역 bbox 안이면 "내 위치" 옵션을 추가로 노출한다(총 3개). 밖이면 2개만.
//   이 옵션 개수 결정은 순수 함수 departureOptions()에 위임한다.
// - 아무것도 선택하지 않았으면 대중교통 경로 계산이 막혀 있다는 안내를 표시한다(Req 2.4).
// - 현재 선택된 옵션을 시각적으로 강조한다.

// 두 옵션이 동일한지 좌표+이름으로 판정 (selected는 이전에 선택된 출발지 객체)
const sameOption = (a, b) =>
  !!a && !!b && a.name === b.name && a.lat === b.lat && a.lng === b.lng

export default function DepartureSelector({ region, selected, myLoc, onSelect }) {
  const [expanded, setExpanded] = useState(false)
  // 지역이 바뀌면 접힘 상태로 초기화
  useEffect(() => { setExpanded(false) }, [region?.id])

  if (!region) return null

  const options = departureOptions(region, myLoc)
  const overflow = options.length > DISPLAY_THRESHOLD
  const shown = overflow && !expanded ? options.slice(0, DISPLAY_THRESHOLD) : options

  return (
    <section className="dep-selector" aria-label="출발지 선택">
      <div className="dep-selector-head">
        <strong>출발지 선택</strong>
        {!selected && <span className="dep-hint">경로 계산 전 출발지를 골라주세요</span>}
      </div>

      <div className="dep-options" role="radiogroup" aria-label="출발지 옵션">
        {shown.map((opt) => {
          const on = sameOption(selected, opt)
          const isMyLoc = opt.type === '내 위치'
          return (
            <button
              key={`${opt.name}-${opt.lat}-${opt.lng}`}
              type="button"
              role="radio"
              aria-checked={on}
              className={`dep-option${on ? ' on' : ''}${isMyLoc ? ' myloc' : ''}`}
              onClick={() => onSelect?.(opt)}
            >
              <span className="dep-option-name">
                {isMyLoc && <span className="dep-option-icon" aria-hidden="true">📍</span>}
                {opt.name}
              </span>
              <span className="dep-option-type">{opt.type}</span>
            </button>
          )
        })}
      </div>

      {overflow && (
        <button type="button" className="dep-more" onClick={() => setExpanded((v) => !v)}>
          {expanded ? '접기' : `더 보기 (${options.length - DISPLAY_THRESHOLD})`}
        </button>
      )}

      {!selected && (
        <p className="dep-notice" role="status">
          출발지를 먼저 선택해주세요. 대중교통 경로는 출발지를 고른 뒤 계산됩니다.
        </p>
      )}
    </section>
  )
}
