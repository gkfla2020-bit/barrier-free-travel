"""LLM 코스 추천 — 후보 필터(코드) → Claude 단일 호출(tool 강제) → 검증(코드).

루프 없음. 후보 밖 contentId는 폐기 → 환각 원천 차단.
실패 시 fixtures/demo_chat.json 폴백.
"""
import json
import math
import os
from pathlib import Path

from anthropic import Anthropic

from . import store

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "demo_chat.json"

BADGE_KEYWORDS = {"휠체어": "wheelchair", "엘리베이터": "elevator",
                  "화장실": "toilet", "주차": "parking"}

TOOL = {
    "name": "recommend_course",
    "description": "무장애 여행 코스 추천 결과를 제출한다.",
    "input_schema": {
        "type": "object",
        "properties": {
            "reply": {"type": "string", "description": "사용자에게 보여줄 한국어 답변 2~3문장"},
            "course": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "contentId": {"type": "string"},
                        "order": {"type": "integer"},
                        "reason": {"type": "string", "description": "이 장소를 넣은 이유 (접근성 근거 포함, 1문장)"},
                    },
                    "required": ["contentId", "order", "reason"],
                },
            },
        },
        "required": ["reply", "course"],
    },
}

SYSTEM = """너는 이동약자(휠체어 이용자, 고령자, 유모차 가족)를 위한 무장애 여행 코스 플래너다.

규칙:
1. 반드시 아래 후보 목록에 있는 contentId만 사용한다. 목록 밖 장소는 절대 추천하지 않는다.
2. 코스는 3~5곳. 좌표(lat/lng) 기준 서로 가까운 장소만 골라, 인접 장소 간 도보 1km 이내·코스 전체 도보 3km 이내가 되도록 구성한다. 멀리 떨어진 장소는 아무리 좋아도 제외한다 (이동약자에게 긴 도보는 치명적).
3. 각 장소의 reason에는 badges의 접근성 근거를 인용한다 (예: "휠체어 대여와 장애인 화장실이 확인된 곳").
4. 관광지 사이에 음식점을 1곳 이상 배치해 반나절~하루 흐름을 만든다.
5. reply는 한국어 2~3문장으로 코스의 특징을 요약한다."""


def _candidates(message: str) -> list[dict]:
    required = [b for kw, b in BADGE_KEYWORDS.items() if kw in message]

    # 덤프 중심(경복궁)에서 가까운 순으로 후보를 좁힌다 — 이동약자 코스는 밀집이 생명.
    # LLM 프롬프트 지시만으론 먼 장소를 완전히 못 막아서 후보 단계에서 차단.
    lng0, lat0 = store.META.get("center", [126.977, 37.5788])
    ordered = sorted(store.PLACES.values(),
                     key=lambda p: math.hypot((p["lat"] - lat0) * 111, (p["lng"] - lng0) * 88))

    def pick(type_: int, n: int, strict: bool) -> list[dict]:
        out = []
        for p in ordered:
            if p["type"] != type_:
                continue
            if strict and not all(b in p["badges"] for b in required):
                continue
            out.append(p)
            if len(out) >= n:
                break
        return out

    tours = pick(12, 15, strict=True)
    foods = pick(39, 10, strict=True)
    if len(tours) + len(foods) < 5:  # 조건이 너무 빡빡하면 완화 (배지는 reason에서 걸러짐)
        tours, foods = pick(12, 15, strict=False), pick(39, 10, strict=False)
    return tours + foods


def _fixture_or_error() -> dict:
    if FIXTURE.exists():
        return json.loads(FIXTURE.read_text())
    return {"reply": "추천 서비스가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해주세요.",
            "course": []}


def chat(message: str, history: list[dict] | None = None) -> dict:
    cands = _candidates(message)
    if not cands:
        return _fixture_or_error()

    lines = "\n".join(json.dumps(
        {"contentId": p["contentId"], "title": p["title"],
         "type": "관광지" if p["type"] == 12 else "음식점",
         "badges": p["badges"], "lat": p["lat"], "lng": p["lng"]},
        ensure_ascii=False) for p in cands)

    messages = [{"role": m["role"], "content": m["content"]} for m in (history or [])]
    messages.append({"role": "user", "content": f"후보 목록:\n{lines}\n\n요청: {message}"})

    try:
        client = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"], timeout=15.0)
        resp = client.messages.create(
            model="claude-sonnet-5", max_tokens=1500, system=SYSTEM,
            tools=[TOOL], tool_choice={"type": "tool", "name": "recommend_course"},
            messages=messages)
        data = next(b for b in resp.content if b.type == "tool_use").input
    except Exception as e:
        print(f"⚠️ Claude 호출 실패: {e}")
        return _fixture_or_error()

    # 검증: 후보 밖 contentId 폐기 (환각 차단)
    valid = {p["contentId"] for p in cands}
    course = [c for c in data.get("course", [])
              if str(c.get("contentId")) in valid]
    course = [{"contentId": str(c["contentId"]), "order": int(c.get("order", i + 1)),
               "reason": str(c.get("reason", ""))} for i, c in enumerate(course)]
    if len(course) < 2:
        return _fixture_or_error()

    return {"reply": str(data.get("reply", "")), "course": course}
