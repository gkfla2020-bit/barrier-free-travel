"""자연어 → 지역/랜드마크 의도 매칭 — 로컬 사전 우선, 실패 시 Claude Haiku 단일 호출.

recommend.py와 같은 기조: 루프 없음, tool_choice 강제, enum 밖 값 폐기(환각 차단),
실패 시 low confidence로 조용히 폴백 — 앱은 안 죽는다.
1차 로컬 매칭(부분 문자열)이 잡으면 LLM 호출 0회 — 비용·지연 모두 절약.
"""
import os
import re

from anthropic import Anthropic

MODEL = "claude-haiku-4-5-20251001"

# 랜드마크 사전 — 이름이 그대로 tool enum이 된다 (목록 밖 장소는 매칭 불가 = 환각 차단)
LANDMARKS: dict[str, dict] = {
    "광화문":       {"region": "seoul",     "lat": 37.5759, "lng": 126.9769},
    "덕수궁":       {"region": "seoul",     "lat": 37.5658, "lng": 126.9751},
    "북촌한옥마을": {"region": "seoul",     "lat": 37.5826, "lng": 126.9850},
    "대릉원":       {"region": "gyeongju",  "lat": 35.8383, "lng": 129.2125},
    "첨성대":       {"region": "gyeongju",  "lat": 35.8347, "lng": 129.2190},
    "황리단길":     {"region": "gyeongju",  "lat": 35.8360, "lng": 129.2100},
    "해운대해수욕장": {"region": "busan",   "lat": 35.1587, "lng": 129.1604},
    "동백섬":       {"region": "busan",     "lat": 35.1523, "lng": 129.1523},
    "전주한옥마을": {"region": "jeonju",    "lat": 35.8143, "lng": 127.1524},
    "경기전":       {"region": "jeonju",    "lat": 35.8150, "lng": 127.1500},
    "경포호":       {"region": "gangneung", "lat": 37.7956, "lng": 128.8961},
    "안목해변":     {"region": "gangneung", "lat": 37.7720, "lng": 128.9470},
    "오동도":       {"region": "yeosu",     "lat": 34.7433, "lng": 127.7681},
    "동문시장":     {"region": "jeju",      "lat": 33.5119, "lng": 126.5277},
    "용두암":       {"region": "jeju",      "lat": 33.5157, "lng": 126.5119},
    "화성행궁":     {"region": "suwon",     "lat": 37.2818, "lng": 127.0137},
    "인천개항장":   {"region": "incheon",   "lat": 37.4736, "lng": 126.6216},
    "차이나타운":   {"region": "incheon",   "lat": 37.4750, "lng": 126.6180},
    "근대골목":     {"region": "daegu",     "lat": 35.8690, "lng": 128.5920},
    "김광석길":     {"region": "daegu",     "lat": 35.8601, "lng": 128.6053},
}

REGION_IDS = ("seoul", "gyeongju", "busan", "jeonju", "gangneung",
              "yeosu", "jeju", "suwon", "incheon", "daegu")

# 지역 키워드 → region id (한국어 지명 + 영문 id 자체도 허용)
REGION_KEYWORDS: dict[str, str] = {
    "서울": "seoul", "경주": "gyeongju", "부산": "busan", "전주": "jeonju",
    "강릉": "gangneung", "여수": "yeosu", "제주": "jeju", "수원": "suwon",
    "인천": "incheon", "대구": "daegu",
    **{rid: rid for rid in REGION_IDS},
}

_MISS = {"regionId": None, "landmark": None, "confidence": "low"}

TOOL = {
    "name": "match_intent",
    "description": "문장이 가리키는 랜드마크/지역 판정 결과를 제출한다.",
    "input_schema": {
        "type": "object",
        "properties": {
            "landmark": {
                "type": "string", "enum": [*LANDMARKS, "없음"],
                "description": "문장이 가리키는 랜드마크. 주변 지명·유사 표현이면 가장 "
                               "가까운 항목으로 (예: '경복궁 앞' → 광화문). 확신 없으면 '없음'.",
            },
            "regionId": {
                "type": "string", "enum": [*REGION_IDS, "none"],
                "description": "문장이 가리키는 지역. 오타·발음 유사 포함 (예: '재주' → jeju). "
                               "랜드마크를 골랐으면 그 랜드마크의 지역. 모르겠으면 'none'.",
            },
            "confidence": {
                "type": "string", "enum": ["high", "low"],
                "description": "판정 확신도. 의미 불명 문자열이거나 추측이면 low.",
            },
        },
        "required": ["landmark", "regionId", "confidence"],
    },
}

SYSTEM = """너는 이동약자용 무장애 여행 앱의 의도 분류기다. 사용자 문장에서 가려는 지역/랜드마크를 판정한다.

규칙:
1. 반드시 enum에 있는 값만 쓴다. 목록 밖 장소는 landmark='없음'으로 두고 지역만 판정한다.
2. 오타·발음 유사 표현을 적극 매칭한다: "재주"→jeju, "붓산"→busan, "경쥬"→gyeongju.
3. 랜드마크 주변·유사 지명은 가장 가까운 랜드마크로 매칭한다: "경복궁 앞"→광화문, "해운대"→해운대해수욕장, "황남빵 거리"→황리단길.
4. 여행 의도와 무관하거나 의미를 알 수 없는 문장("asdf" 등)은 landmark='없음', regionId='none', confidence='low'.
5. 확실한 매칭만 high. 추측이 섞이면 low."""


def _hit(name: str, conf: str) -> dict:
    lm = LANDMARKS[name]
    return {"regionId": lm["region"],
            "landmark": {"name": name, "lat": lm["lat"], "lng": lm["lng"]},
            "confidence": conf}


def match(text: str) -> dict:
    """{"regionId": str|None, "landmark": {name,lat,lng}|None, "confidence": high|low}"""
    compact = re.sub(r"\s+", "", text).lower()  # "북촌 한옥마을"도 잡히게 공백 제거

    # 1차: 로컬 매칭 — 랜드마크명이 더 구체적이므로 지역 키워드보다 먼저 본다
    for name in LANDMARKS:
        if name in compact:
            return _hit(name, "high")
    for kw, rid in REGION_KEYWORDS.items():
        if kw in compact:
            return {"regionId": rid, "landmark": None, "confidence": "high"}

    # 2차: Haiku 단일 호출 (tool 강제) — 오타·유사표현 매칭
    try:
        client = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"], timeout=8.0)
        resp = client.messages.create(
            model=MODEL, max_tokens=300, system=SYSTEM,
            tools=[TOOL], tool_choice={"type": "tool", "name": "match_intent"},
            messages=[{"role": "user", "content": text}])
        data = next(b for b in resp.content if b.type == "tool_use").input
    except Exception as e:
        print(f"⚠️ intent Haiku 호출 실패: {e}")
        return dict(_MISS)

    # 검증: enum 밖 값 폐기 (환각 차단) — 랜드마크가 잡히면 지역은 사전에서 확정
    conf = "high" if data.get("confidence") == "high" else "low"
    name = data.get("landmark")
    if name in LANDMARKS:
        return _hit(name, conf)
    rid = data.get("regionId")
    if rid in REGION_IDS:
        return {"regionId": rid, "landmark": None, "confidence": conf}
    return dict(_MISS)
