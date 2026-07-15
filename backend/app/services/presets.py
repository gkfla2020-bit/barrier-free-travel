"""출발지 기반 프리셋 코스 — store.PLACES에서 배지 확인된 장소를 nearest-neighbor로 엮는다.

전 구간 인접 지점 간 직선 1.2km 이내(도보권)를 지키고,
관광지(12)-음식점(39)-관광지 순으로 섞는다. Tmap 등 외부 호출 없음.
"""
import math

from . import store

# frontend api.js BADGE_LABELS와 동일
BADGE_LABELS = {
    "wheelchair": "휠체어",
    "elevator": "엘리베이터",
    "toilet": "장애인 화장실",
    "parking": "장애인 주차",
}

MAX_LEG_KM = 1.2  # 인접 장소 간 직선 상한


def _dist_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """구면 haversine (km)."""
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _labels(place: dict) -> list[str]:
    return [BADGE_LABELS[b] for b in place.get("badges", []) if b in BADGE_LABELS]


def preset_course(departure: dict, n: int = 4) -> list[dict]:
    """출발지 도보권 프리셋 코스 [{contentId, order, reason}].

    - 배지 ≥1 관광지(type 12) 최대 3곳 + 음식점(type 39) 1곳
    - 관광지-음식점-관광지(-관광지) 순, 인접 지점 간 1.2km 이내 nearest-neighbor
    - 엮인 장소가 2곳 미만이면 빈 리스트
    """
    region = departure.get("region", "")
    places = [p for p in store.PLACES.values() if p.get("region") == region]
    attractions = [p for p in places if p.get("type") == 12 and p.get("badges")]
    restaurants = [p for p in places if p.get("type") == 39]
    # 음식점도 배지 있는 곳 우선 (없으면 아무 음식점)
    rest_pool = [p for p in restaurants if p.get("badges")] or restaurants

    want_types = [12, 39, 12, 12][:max(n, 0)]  # 관광지-음식점-관광지-관광지
    cur_lat, cur_lng = departure["lat"], departure["lng"]
    prev_name = departure.get("name", "출발지")
    picked: list[tuple[dict, float, str]] = []  # (place, dist_km, prev_name)
    used: set[str] = set()

    for want in want_types:
        pool = attractions if want == 12 else rest_pool
        best, best_d = None, MAX_LEG_KM + 1
        for p in pool:
            if p["contentId"] in used:
                continue
            d = _dist_km(cur_lat, cur_lng, p["lat"], p["lng"])
            if d <= MAX_LEG_KM and d < best_d:
                best, best_d = p, d
        if best is None:
            continue  # 이 슬롯은 채울 수 없음 — 다음 슬롯 시도
        used.add(best["contentId"])
        picked.append((best, best_d, prev_name))
        cur_lat, cur_lng, prev_name = best["lat"], best["lng"], best.get("title", "")

    if len(picked) < 2:
        return []

    course = []
    for i, (p, d, frm) in enumerate(picked, start=1):
        kind = "관광지" if p.get("type") == 12 else "음식점"
        labels = _labels(p)
        badge_txt = "·".join(labels) if labels else "도보 접근"
        dist_m = int(round(d * 1000 / 10) * 10)
        course.append({
            "contentId": p["contentId"],
            "order": i,
            "reason": f"{frm}에서 약 {dist_m}m · {badge_txt} 확인된 {kind}",
        })
    return course
