import { useRef, useState, useEffect } from 'react'
import { BADGE_LABELS } from './api'

const QUICK_PROMPTS = [
  '휠체어로 경복궁 근처 반나절 코스 짜줘 (여행지 3곳 + 식당 1곳)',
  '유모차 끌고 갈 수 있는 코스 추천해줘',
  '장애인 화장실 있는 곳 위주로 하루 코스',
]

export default function ChatPanel({ messages, loading, onSend, course, onRegion }) {
  const [input, setInput] = useState('')
  const bodyRef = useRef(null)

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, loading])

  const send = (text) => {
    const t = (text ?? input).trim()
    if (!t || loading) return
    setInput('')
    onSend(t)
  }

  return (
    <section className="chat">
      <div className="chat-body" ref={bodyRef}>
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.content}
            {m.regions && (
              <div className="region-chips">
                {m.regions.map((r) => (
                  <button key={r.id} className={`chip${r.ready ? '' : ' soon'}`}
                          onClick={() => onRegion(r)}>
                    {r.name}{!r.ready && ' · 준비 중'}
                  </button>
                ))}
              </div>
            )}
            {m.course && (
              <ol className="course-list">
                {m.course.map((c, j) => (
                  <li key={c.place.contentId}>
                    <div className="course-head">
                      <span className={`num${c.place.type === 39 ? ' food' : ''}`}>{j + 1}</span>
                      <strong>{c.place.title}</strong>
                      <span className="ctype">{c.place.type === 39 ? '식당' : '관광지'}</span>
                    </div>
                    <div className="course-badges">
                      {c.place.badges.map((b) => (
                        <span key={b} className="badge">{BADGE_LABELS[b]}</span>
                      ))}
                    </div>
                    <p className="reason">{c.reason}</p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        ))}
        {loading && <div className="msg assistant typing">코스를 구성하고 있어요…</div>}
      </div>

      {messages.length <= 1 && (
        <div className="chips">
          {QUICK_PROMPTS.map((q) => (
            <button key={q} className="chip" onClick={() => send(q)}>{q}</button>
          ))}
        </div>
      )}

      <div className="chat-input">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="어디로 여행 가고 싶으세요?"
          aria-label="여행 요청 입력"
        />
        <button onClick={() => send()} disabled={loading}>보내기</button>
      </div>
    </section>
  )
}
