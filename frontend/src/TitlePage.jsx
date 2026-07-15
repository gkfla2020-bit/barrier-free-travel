// 시연 영상 오프닝용 풀스크린 타이틀 화면.
// App.jsx 연결 예시: {stage === 'title' ? <TitlePage onStart={() => setStage('app')} /> : (기존 레이아웃)}
import { Logo } from './Icons'

const S = { stroke: 'currentColor', strokeWidth: 1.8, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' }

// 핵심 기능 3개 — 이모지 대신 미니 인라인 SVG (Icons.jsx와 같은 스트로크 톤)
const FEATURES = [
  {
    label: '계단 회피 경로',
    icon: <path d="M4 19h4v-4h4v-4h4V7h4" {...S} />,
  },
  {
    label: '저상버스 실시간',
    icon: (
      <>
        <rect x="4.5" y="4" width="15" height="12.5" rx="3" {...S} />
        <path d="M4.5 10.5h15" {...S} />
        <circle cx="8.6" cy="19.6" r="1.5" fill="currentColor" />
        <circle cx="15.4" cy="19.6" r="1.5" fill="currentColor" />
      </>
    ),
  },
  {
    label: '경사 회피',
    icon: (
      <>
        <path d="M4 18h16" {...S} />
        <path d="M4 18C9.5 17.2 15 12.5 20 7.5" {...S} />
      </>
    ),
  },
]

export default function TitlePage({ onStart }) {
  return (
    <div className="title-page">
      <div className="title-logo"><Logo size={72} /></div>
      <h1 className="title-name">편해질지도</h1>
      <p className="title-slogan">조금 돌아가더라도, 갈 수 없는 길이 없게</p>
      <p className="title-desc">이동약자를 위한 무장애 여행 플래너</p>
      <ul className="title-feats">
        {FEATURES.map((f) => (
          <li key={f.label} className="title-feat">
            <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">{f.icon}</svg>
            {f.label}
          </li>
        ))}
      </ul>
      <button type="button" className="title-start" onClick={onStart}
              aria-label="편해질지도 시작하기">
        시작하기
      </button>
    </div>
  )
}
