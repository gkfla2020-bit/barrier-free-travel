"""LLM 코스 추천 — 후보 필터(코드) → Claude 단일 호출(tool 강제) → 검증(코드).

루프 없음. 후보 밖 contentId는 폐기 → 환각 원천 차단.
실패 시 fixtures/demo_chat.json 폴백.
"""
import json
import math
import os
import re
from pathlib import Path

from anthropic import Anthropic

from . import store

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "demo_chat.json"

BADGE_KEYWORDS = {"휠체어": "wheelchair", "엘리베이터": "elevator",
                  "화장실": "toilet", "주차": "parking"}

# ── 앵커 매칭 ────────────────────────────────────────────────────
# 후보를 '지역 중심'에서만 뽑으면 검색어가 뭐든 같은 곳만 나온다 (서울=광화문 반경 850m
# 16곳). 남산 데이터가 있는데도 광화문에서 2.9km라 후보에 절대 못 든다.
# 그래서 검색어에서 장소를 찾아 그 장소를 중심으로 후보를 뽑는다.
#
# 사용자는 데이터의 정확한 제목대로 쓰지 않는다("남산타워" vs "남산케이블카").
# 그래서 최장 공통부분문자열로 느슨하게 맞추되, **어디를 기준으로 잡았는지 응답에 실어
# 보낸다**(ChatOut.anchor). 잘못 잡아도 사용자가 화면에서 바로 알아챌 수 있어야 한다.

# 조사가 붙어도 걸러지도록 '접두 일치'로 본다 ("코스를", "휠체어로" 등)
_STOP = ("코스", "근처", "주변", "여행", "추천", "가족", "휠체어", "유모차", "반나절",
         "하루", "일정", "장소", "구경", "가고", "싶어", "짜줘", "알려", "부탁", "어디",
         "관광", "식당", "맛집", "함께", "가볼", "만한", "있는", "곳을", "곳이",
         # 지역명은 지역 선택이 따로 처리한다. 여기서 앵커로 쓰면
         # "서울 관광 코스"가 '서울로 7017'에 붙어버린다.
         "서울", "부산", "경주", "전주", "강릉", "여수", "제주", "수원", "인천", "대구")


def _tokens(text: str) -> list[str]:
    return [t for t in re.split(r"[^가-힣a-zA-Z0-9]+", text)
            if len(t) >= 2 and not any(t.startswith(s) for s in _STOP)]


def _lcs(a: str, b: str) -> int:
    """최장 공통부분문자열 길이 — "남산타워"와 "남산케이블카"에서 "남산"(2)을 찾는다."""
    prev = [0] * (len(b) + 1)
    best = 0
    for i in range(1, len(a) + 1):
        cur = [0] * (len(b) + 1)
        for j in range(1, len(b) + 1):
            if a[i - 1] == b[j - 1]:
                cur[j] = prev[j - 1] + 1
                best = max(best, cur[j])
        prev = cur
    return best


def _anchor(message: str, pool: list[dict]) -> dict | None:
    """검색어가 가리키는 장소. 못 찾으면 None (지역 중심으로 폴백)."""
    toks = _tokens(message)
    if not toks:
        return None
    best, best_score = None, 1  # 2글자 이상 겹쳐야 인정
    for p in pool:
        title = re.sub(r"\(.*?\)", "", p["title"])  # "조계사(서울)" → "조계사"
        score = max((len(t) if t in title else _lcs(t, title)) for t in toks)
        # 동점이면 제목이 짧은 쪽 = 더 정확히 그 장소를 가리킨 것으로 본다
        if score > best_score or (score == best_score and best and len(title) < len(best["title"])):
            best, best_score = p, score
    return best


def resolve(message: str, region: str) -> tuple[str, dict | None]:
    """검색어 → (실제 지역, 앵커 장소). 다른 지역 장소명이면 지역도 바꿔 돌려준다.

    이걸로 App.jsx의 하드코딩 키워드 목록에 없는 장소명("남산", "동백섬")도 인식된다.
    """
    here = [p for p in store.PLACES.values() if p.get("region", "seoul") == region]
    a = _anchor(message, here)
    if a:
        return region, a
    a = _anchor(message, list(store.PLACES.values()))  # 다른 지역 장소를 말한 걸 수도
    if a:
        return a.get("region", region), a
    return region, None

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


def _candidates(message: str, region: str = "seoul",
                anchor: dict | None = None) -> list[dict]:
    required = [b for kw, b in BADGE_KEYWORDS.items() if kw in message]

    # 앵커(검색어가 가리킨 장소)가 있으면 그 주변, 없으면 지역 중심 주변.
    # 가까운 순으로 해당 지역 장소만 — 이동약자 코스는 밀집이 생명.
    # LLM 프롬프트 지시만으론 먼 장소를 완전히 못 막아서 후보 단계에서 차단.
    if anchor:
        lat0, lng0 = anchor["lat"], anchor["lng"]
    else:
        lng0, lat0 = store.region_center(region)
    pool = [p for p in store.PLACES.values() if p.get("region", "seoul") == region] \
        or list(store.PLACES.values())
    ordered = sorted(pool,
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

    tours = pick(12, 10, strict=True)
    foods = pick(39, 6, strict=True)
    if len(tours) + len(foods) < 5:  # 조건이 너무 빡빡하면 완화 (배지는 reason에서 걸러짐)
        tours, foods = pick(12, 10, strict=False), pick(39, 6, strict=False)
    return tours + foods


def _fixture_or_error() -> dict:
    """데모 폴백 — 서울 광화문 코스 사전 저장본.

    fallback=True를 반드시 실어 보낸다. 이게 없으면 사용자가 뭘 검색하든 광화문 코스가
    '진짜 추천'인 척 돌아온다. 실제로 이것 때문에 "어느 지역을 검색해도 광화문만 나온다"는
    버그로 오인됐다. 폴백이면 폴백이라고 말해야 한다.
    """
    if FIXTURE.exists():
        return {**json.loads(FIXTURE.read_text()), "region": "seoul", "fallback": True}
    return {"reply": "추천 서비스가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해주세요.",
            "course": [], "region": "seoul", "fallback": True}


def chat(message: str, history: list[dict] | None = None, region: str = "seoul") -> dict:
    region, anchor = resolve(message, region)
    cands = _candidates(message, region, anchor)
    if not cands:
        return _fixture_or_error()
    out = {"region": region,
           "anchor": {"contentId": anchor["contentId"], "title": anchor["title"],
                      "region": anchor.get("region", region)} if anchor else None}

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

    return {**out, "reply": str(data.get("reply", "")), "course": course}
