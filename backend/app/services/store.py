"""seoul_places.json 메모리 상주 스토어 — 시연 중 외부 호출 0."""
import json
from pathlib import Path

DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "seoul_places.json"

PLACES: dict[str, dict] = {}
META: dict = {}


def load() -> None:
    global PLACES, META
    if not DATA_PATH.exists():
        print(f"⚠️  {DATA_PATH} 없음 — scripts/dump_places.py를 먼저 실행하세요")
        return
    data = json.loads(DATA_PATH.read_text())
    META = data.get("meta", {})
    PLACES = {p["contentId"]: p for p in data.get("places", [])}
    print(f"✅ 장소 {len(PLACES)}건 로드 (counts={META.get('counts')})")


def query(min_lat: float, max_lat: float, min_lng: float, max_lng: float,
          type_: int | None = None, limit: int = 100) -> list[dict]:
    out = []
    for p in PLACES.values():
        if not (min_lat <= p["lat"] <= max_lat and min_lng <= p["lng"] <= max_lng):
            continue
        if type_ is not None and p["type"] != type_:
            continue
        out.append(p)
        if len(out) >= limit:
            break
    return out


def get(content_id: str) -> dict | None:
    return PLACES.get(content_id)


load()
