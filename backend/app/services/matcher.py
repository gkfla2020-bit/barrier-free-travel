"""출발지/지역 텍스트 매칭 — 규칙 기반(fast_match) 우선, 실패 시 Claude Haiku.

data/departures.json은 frontend/src/App.jsx REGIONS의 미러다 (값 임의 변경 금지).
Haiku 호출은 실패해도 앱이 죽지 않도록 전부 (None, None)으로 삼킨다.
"""
import json
import os
from pathlib import Path

DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "departures.json"

HAIKU_MODEL = "claude-haiku-4-5-20251001"
HAIKU_TIMEOUT = 10.0  # 초 — 초과 시 (None, None)

_cache: dict | None = None


def load_departures() -> dict:
    """departures.json 로드 (모듈 캐시). {"regions": [...], "departures": [...]}"""
    global _cache
    if _cache is None:
        _cache = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    return _cache


def region_name(region_id: str | None) -> str:
    if not region_id:
        return ""
    for r in load_departures()["regions"]:
        if r["id"] == region_id:
            return r["name"]
    return region_id


def region_departures(region_id: str) -> list[dict]:
    return [d for d in load_departures()["departures"] if d["region"] == region_id]


# 출발 의도어·조사 — 정규화 시 제거 (frontend departures.js와 같은 철학, 긴 토큰 우선)
_STRIP_TOKENS = sorted(
    ["에서부터", "출발하고싶어", "출발하고", "출발할래", "출발할게", "출발해줘",
     "출발", "시작", "갈게", "갈래", "할게", "에서", "부터", "으로", "이요", "로", "요"],
    key=len, reverse=True,
)


def _normalize(text: str) -> str:
    if not isinstance(text, str):
        return ""
    s = "".join(text.split())  # 모든 공백 제거
    for tok in _STRIP_TOKENS:
        s = s.replace(tok, "")
    return s.strip().lower()


def fast_match(text: str) -> tuple[dict | None, str | None]:
    """LLM 없이 name/keywords 부분 문자열 매칭. 반환: (departure|None, region_id|None).

    가장 긴 키가 이기게 해서 "경주시외버스터미널"이 제주 키워드 "버스터미널"에
    잘못 잡히지 않게 한다. 출발지 매칭이 지역 매칭보다 우선.
    """
    data = load_departures()
    key = _normalize(text)
    if not key:
        return None, None

    # 1) 출발지: name + keywords 중 텍스트에 포함된 가장 긴 것
    best_dep, best_len = None, 0
    for dep in data["departures"]:
        for cand in [dep["name"], *dep.get("keywords", [])]:
            ck = _normalize(cand)
            if ck and ck in key and len(ck) > best_len:
                best_dep, best_len = dep, len(ck)
    if best_dep:
        return best_dep, best_dep["region"]

    # 2) 지역: name + keywords (서울/경주/부산/전주/강릉/여수/제주/수원/인천/대구)
    best_region, best_len = None, 0
    for r in data["regions"]:
        for cand in [r["name"], *r.get("keywords", [])]:
            ck = _normalize(cand)
            if ck and ck in key and len(ck) > best_len:
                best_region, best_len = r["id"], len(ck)
    return None, best_region


_TOOL = {
    "name": "match_departure",
    "description": "사용자 텍스트가 가리키는 출발지 또는 지역을 하나 보고한다. 확신이 없으면 둘 다 null.",
    "input_schema": {
        "type": "object",
        "properties": {
            "departureId": {
                "type": ["string", "null"],
                "description": "후보 목록에 있는 출발지 id. 특정 출발지를 못 정하면 null.",
            },
            "regionId": {
                "type": ["string", "null"],
                "description": "지역 목록에 있는 지역 id. 지역조차 못 정하면 null.",
            },
        },
        "required": ["departureId", "regionId"],
        "additionalProperties": False,
    },
}


def _haiku_system() -> str:
    data = load_departures()
    deps = "\n".join(
        f'- id={d["id"]} name={d["name"]} region={d["region"]}' for d in data["departures"]
    )
    regions = "\n".join(f'- id={r["id"]} name={r["name"]}' for r in data["regions"])
    return (
        "너는 한국 무장애 여행 앱의 출발지 매칭기다. 사용자가 친 자유 텍스트가 아래 "
        "출발지 후보 중 어디를 가리키는지 판별해 match_departure 도구로 보고하라.\n\n"
        f"[출발지 후보]\n{deps}\n\n[지역 목록]\n{regions}\n\n"
        "규칙:\n"
        "- 오타·발음 유사(예: 재주→제주, 광하문→광화문)·부분 표현(예: 팔달문→팔달문)을 "
        "허용해 가장 그럴듯한 하나를 골라라.\n"
        "- 특정 출발지까지 좁혀지면 departureId와 그 출발지의 regionId를 함께 채워라.\n"
        "- 지역만 알 수 있으면 departureId=null, regionId만 채워라.\n"
        "- 확신이 없으면 둘 다 null로 보고하라. 목록에 없는 id를 지어내지 마라."
    )


def haiku_match(text: str) -> tuple[dict | None, str | None]:
    """Claude Haiku 강제 tool_choice 매칭. 실패/타임아웃(10s)은 (None, None)."""
    data = load_departures()
    try:
        import anthropic

        client = anthropic.Anthropic(
            api_key=os.environ["ANTHROPIC_API_KEY"],
            timeout=HAIKU_TIMEOUT,
            max_retries=0,
        )
        resp = client.messages.create(
            model=HAIKU_MODEL,
            max_tokens=300,
            system=_haiku_system(),
            tools=[_TOOL],
            tool_choice={"type": "tool", "name": "match_departure"},
            messages=[{"role": "user", "content": text}],
        )
        block = next(b for b in resp.content if b.type == "tool_use")
        dep_id = block.input.get("departureId")
        region_id = block.input.get("regionId")
    except Exception:
        return None, None

    dep = next((d for d in data["departures"] if d["id"] == dep_id), None) if dep_id else None
    if dep:
        return dep, dep["region"]
    if region_id and any(r["id"] == region_id for r in data["regions"]):
        return None, region_id
    return None, None


def match(text: str) -> tuple[dict | None, str | None]:
    """fast_match 먼저, 아무것도 못 잡으면 haiku_match."""
    dep, region = fast_match(text)
    if dep or region:
        return dep, region
    return haiku_match(text)
