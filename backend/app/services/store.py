"""data/*_places.json 전부 메모리 상주 — 멀티 지역, 시연 중 외부 호출 0."""
import json
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[1] / "data"

PLACES: dict[str, dict] = {}
REGIONS: dict[str, dict] = {}  # region_id -> meta (center 포함)
META: dict = {}  # 하위호환: 첫 지역 meta


def load() -> None:
    global PLACES, REGIONS, META
    PLACES, REGIONS = {}, {}
    for f in sorted(DATA_DIR.glob("*_places.json")):
        data = json.loads(f.read_text())
        meta = data.get("meta", {})
        rid = meta.get("region") or f.stem.replace("_places", "")
        REGIONS[rid] = meta
        for p in data.get("places", []):
            p["region"] = rid
            PLACES[p["contentId"]] = p
    if not PLACES:
        print(f"⚠️  {DATA_DIR}에 *_places.json 없음 — scripts/dump_places.py를 먼저 실행하세요")
        return
    META = next(iter(REGIONS.values()), {})
    print(f"✅ 장소 {len(PLACES)}건 로드 (지역: {', '.join(REGIONS)})")


def region_center(region: str) -> tuple[float, float]:
    """(lng, lat) — 미지원 지역은 서울 기본값."""
    meta = REGIONS.get(region) or {}
    c = meta.get("center") or [126.977, 37.5788]
    return c[0], c[1]


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
