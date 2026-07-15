# 무장애 여행 지도 (가칭: 모두의 여행)

이동약자(휠체어 이용자, 고령자, 유모차 가족)를 위한 여행 계획 앱 — 무박이일 해커톤 프로젝트 (팀 삼박자).

- 무장애 인증 관광지/음식점을 지도에 표시 (한국관광공사 무장애 여행정보 API)
- 계단을 회피하는 도보 경로 안내 (Tmap 보행자 API, `searchOption=30`)
- LLM 채팅으로 접근성 조건에 맞는 여행 코스 추천 (Claude API)

## 스택

| 레이어 | 기술 |
|---|---|
| 앱 | Flutter + flutter_naver_map |
| 백엔드 | Python FastAPI (노트북 로컬 실행) |
| 데이터 | TourAPI KorWithService2 사전 덤프 → `seoul_places.json` |

## 문서

- [ARCHITECTURE.md](./ARCHITECTURE.md) — 상세 아키텍처 (해커톤 실행판)

## 백엔드 실행

```bash
cd backend
cp .env.example .env   # 키 3종 입력 (팀 메신저 참조)
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

⚠️ `.env`는 절대 커밋하지 않는다 (.gitignore에 등록됨).
