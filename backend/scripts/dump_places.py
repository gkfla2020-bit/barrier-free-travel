#!/usr/bin/env python3
"""TourAPI 무장애 데이터 덤프 → app/data/seoul_places.json

사용: python scripts/dump_places.py [--lng 126.9770 --lat 37.5788] [--radius 3000]
기본 중심: 경복궁 (데모 시나리오 기준). 호출량 ≈ 페이지수 + 장소수×2 (일 1,000회 쿼터 내)
원본 응답은 scripts/raw/에 저장 — 파서 수정 시 --offline으로 재호출 없이 재생성.
"""
import argparse
import json
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app.services.badges import parse_badges, raw_korean  # noqa: E402 — 서버와 같은 파서 공유

BASE = "https://apis.data.go.kr/B551011/KorWithService2"
RAW_DIR = ROOT / "scripts" / "raw"
OUT = ROOT / "app" / "data" / "seoul_places.json"

calls = 0


def load_key() -> str:
    for line in (ROOT / ".env").read_text().splitlines():
        if line.startswith("TOUR_API_KEY="):
            return line.split("=", 1)[1].strip()
    sys.exit("TOUR_API_KEY가 backend/.env에 없습니다")


KEY = load_key()


def call(op: str, **params) -> dict:
    """게이트웨이 에러(XML)와 일시 오류에 3회 재시도."""
    global calls
    qs = urllib.parse.urlencode({"serviceKey": KEY, "MobileOS": "ETC",
                                 "MobileApp": "AccessTrip", "_type": "json", **params})
    for attempt in range(3):
        text = ""
        try:
            calls += 1
            with urllib.request.urlopen(f"{BASE}/{op}?{qs}", timeout=20) as r:
                text = r.read().decode()
            return json.loads(text)["response"]["body"]
        except Exception as e:
            print(f"  재시도 {attempt + 1}/3 ({op}): {e} {text[:120]}")
            time.sleep(2)
    raise RuntimeError(f"{op} 3회 실패 — 쿼터 초과 여부 확인 필요")


def items_of(body: dict) -> list[dict]:
    it = body.get("items") or {}
    if not isinstance(it, dict):  # 결과 0건이면 items가 빈 문자열
        return []
    item = it.get("item") or []
    return item if isinstance(item, list) else [item]


def fetch_list(lng: float, lat: float, radius: int, ctype: int) -> list[dict]:
    out, page = [], 1
    while True:
        body = call("locationBasedList2", mapX=lng, mapY=lat, radius=radius,
                    contentTypeId=ctype, arrange="E", numOfRows=100, pageNo=page)
        out.extend(items_of(body))
        if len(out) >= int(body.get("totalCount", 0)):
            return out
        page += 1


def build_place(item: dict, offline: bool) -> dict | None:
    cid = str(item["contentid"])
    raw_path = RAW_DIR / f"{cid}.json"

    if offline and raw_path.exists():
        raw = json.loads(raw_path.read_text())
    else:
        common = items_of(call("detailCommon2", contentId=cid))
        withtour = items_of(call("detailWithTour2", contentId=cid))
        raw = {"common": common[0] if common else {},
               "withtour": withtour[0] if withtour else {}}
        raw_path.write_text(json.dumps(raw, ensure_ascii=False))
        time.sleep(0.05)

    try:
        lat, lng = float(item["mapy"]), float(item["mapx"])
    except (KeyError, ValueError):
        return None  # 좌표 없는 장소는 지도에 못 찍으므로 제외

    common, withtour = raw["common"], raw["withtour"]
    return {
        "contentId": cid,
        "title": item.get("title", ""),
        "type": int(item["contenttypeid"]),
        "lat": lat, "lng": lng,
        "addr": common.get("addr1", "") or item.get("addr1", ""),
        "image": common.get("firstimage", "") or item.get("firstimage", ""),
        "overview": common.get("overview", ""),
        "tel": common.get("tel", "") or item.get("tel", ""),
        "badges": parse_badges(withtour),
        "accessibilityRaw": raw_korean(withtour),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lng", type=float, default=126.9770)  # 경복궁
    ap.add_argument("--lat", type=float, default=37.5788)
    ap.add_argument("--radius", type=int, default=3000)
    ap.add_argument("--offline", action="store_true", help="raw/ 캐시만으로 재생성")
    args = ap.parse_args()

    RAW_DIR.mkdir(exist_ok=True)
    OUT.parent.mkdir(exist_ok=True)

    places, counts = [], {}
    for ctype in (12, 39):
        listed = fetch_list(args.lng, args.lat, args.radius, ctype)
        print(f"contentTypeId={ctype}: 목록 {len(listed)}건")
        for i, item in enumerate(listed):
            p = build_place(item, args.offline)
            if p:
                places.append(p)
            if (i + 1) % 20 == 0:
                print(f"  상세 {i + 1}/{len(listed)} (누적 호출 {calls})")
        counts[str(ctype)] = sum(1 for p in places if p["type"] == ctype)

    OUT.write_text(json.dumps({
        "meta": {"generatedAt": datetime.now(timezone.utc).isoformat(),
                 "center": [args.lng, args.lat], "radius": args.radius,
                 "counts": counts},
        "places": places,
    }, ensure_ascii=False, indent=1))

    with_badges = sum(1 for p in places if p["badges"])
    print(f"\n✅ {OUT.name}: 총 {len(places)}건 (관광지 {counts.get('12', 0)}, "
          f"음식점 {counts.get('39', 0)}) / 배지 1개 이상 {with_badges}건 / API 호출 {calls}회")
    if counts.get("39", 0) < 15:
        print("⚠️ 음식점 15건 미만 — radius 5000 재덤프 권장 (T+1 판정 기준)")


if __name__ == "__main__":
    main()
