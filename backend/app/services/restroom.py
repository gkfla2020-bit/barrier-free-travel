"""Restroom_Coverage_Service — 코스 장소별 최근접 접근 화장실 탐색 (순수 로직).

각 코스 장소로부터 500m(Coverage_Radius) 이내의 접근 가능한 화장실("toilet" 배지)을
직선거리 기준으로 찾는다. 외부 의존 없는 순수 함수 계층이라 property 테스트가 쉽다.

판정 규칙 (Req 7.1~7.6):
- 코스 장소가 toilet 배지를 가지면 자기 자신을 거리 0m·isSelf=True로 보고한다.
- 아니면 후보(toilet 배지 보유 장소) 중 500m 이내 최근접을 고르되,
  거리 동률이면 이름 사전순 첫 번째를 선택한다.
- 500m 이내 후보가 없으면 None(화장실 없음 → notice).
- 결과 거리는 10m 단위로 반올림하며 name/lat/lng를 포함한다.
"""
from __future__ import annotations

import math

COVERAGE_RADIUS_M = 500
TOILET_BADGE = "toilet"

_EARTH_RADIUS_M = 6_371_000.0


def _coords(point) -> tuple[float, float]:
    """(lat, lng) 튜플로 정규화. dict(lat/lng) 또는 (lat, lng) 시퀀스 허용."""
    if isinstance(point, dict):
        return float(point["lat"]), float(point["lng"])
    lat, lng = point
    return float(lat), float(lng)


def _haversine_m(a, b) -> float:
    """두 지점 a, b 사이의 대권(great-circle) 거리(미터).

    a, b는 각각 {"lat","lng"} dict 또는 (lat, lng) 시퀀스.
    """
    lat1, lng1 = _coords(a)
    lat2, lng2 = _coords(b)
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    h = (
        math.sin(dphi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    )
    return 2 * _EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(h)))


def _round10(value: float) -> int:
    """10m 단위 반올림."""
    return int(round(value / 10.0) * 10)


def _has_toilet(place: dict) -> bool:
    return TOILET_BADGE in (place.get("badges") or [])


def nearest_restroom(place: dict, candidates: list[dict]) -> dict | None:
    """place 주변 500m 이내 후보 화장실 중 최근접 하나를 반환.

    거리 동률이면 이름(title) 사전순 첫 번째. 반경 내 후보가 없으면 None.
    반환 dict: {name, lat, lng, distance(10m 반올림), isSelf=False}.
    """
    best: dict | None = None
    best_key: tuple[float, str] | None = None
    for cand in candidates:
        dist = _haversine_m(place, cand)
        if dist > COVERAGE_RADIUS_M:
            continue
        name = str(cand.get("title") or "")
        key = (dist, name)
        if best_key is None or key < best_key:
            best_key = key
            best = {
                "name": name,
                "lat": float(cand["lat"]),
                "lng": float(cand["lng"]),
                "distance": _round10(dist),
                "isSelf": False,
            }
    return best


def coverage_for_course(
    course_places: list[dict], all_places: list[dict]
) -> list[dict]:
    """각 코스 장소별 화장실 커버리지 결과 리스트를 반환.

    반환 원소: {"contentId": str, "restroom": <RestroomInfo dict> | None}.
    - toilet 배지 보유 장소: 자기 자신을 거리 0m·isSelf=True로 보고.
    - 미보유 장소: 후보 중 최근접(없으면 restroom=None).
    """
    candidates = [p for p in all_places if _has_toilet(p)]
    items: list[dict] = []
    for place in course_places:
        content_id = str(place.get("contentId") or "")
        if _has_toilet(place):
            restroom = {
                "name": str(place.get("title") or ""),
                "lat": float(place["lat"]),
                "lng": float(place["lng"]),
                "distance": 0,
                "isSelf": True,
            }
        else:
            restroom = nearest_restroom(place, candidates)
        items.append({"contentId": content_id, "restroom": restroom})
    return items
