import { BadgeIcon, Wordmark } from './Icons'

const FEATURES = [
  { icon: 'wheelchair', title: '안전지대만 골라서', desc: '내 이동 조건을 100% 만족하는 무장애 인증 장소만 추천해요' },
  { icon: 'elevator', title: '계단 없는 길로', desc: '계단을 피하는 도보 경로와 구간별 이동 난이도를 함께 보여드려요' },
  { icon: 'toilet', title: '편의시설까지 한눈에', desc: '장애인 화장실·주차·엘리베이터 위치를 지도에서 바로 확인해요' },
]

export default function Landing({ onStart }) {
  return (
    <div className="landing">
      <div className="landing-inner">
        <h1 className="landing-wordmark"><Wordmark size={34} /></h1>
        <p className="landing-slogan">조금 돌아가더라도, 갈 수 없는 길이 없게</p>
        <p className="landing-tag">이동약자를 위한 무장애 여행 플래너</p>

        <ul className="landing-features">
          {FEATURES.map((f) => (
            <li key={f.title}>
              <span className="lf-icon"><BadgeIcon badge={f.icon} size={20} /></span>
              <div>
                <strong>{f.title}</strong>
                <p>{f.desc}</p>
              </div>
            </li>
          ))}
        </ul>

        <button className="landing-cta" onClick={onStart}>시작하기</button>

        <p className="landing-meta">
          전국 10개 지역 · 무장애 인증 341곳
          <span>서울 · 경주 · 부산 · 전주 · 강릉 · 여수 · 제주 · 수원 · 인천 · 대구</span>
        </p>
      </div>
    </div>
  )
}
