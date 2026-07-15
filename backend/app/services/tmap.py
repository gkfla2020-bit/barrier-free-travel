"""Tmap 보행자 경로 클라이언트 — searchOption=30(계단제외) 우선, 실패 시 0 폴백."""
import json
import os
from pathlib import Path

import httpx

URL = "https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1"
FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "demo_route.json"

# 계단/경사/엘리베이터 turnType (Tmap 공식 문서)
STAIRS = {127, 129}
INFO_TURNS = {125: "육교", 126: "지하보도", 128: "경사로", 218: "엘리베이터"}

_cache: dict[tuple, dict] = {}


def _parse(data: dict, stairs_forced: bool) -> dict:
    polyline: list[list[float]] = []
    guides: list[str] = []
    distance = duration = 0
    stairs = stairs_forced

    for feat in data.get("features", []):
        geom, props = feat["geometry"], feat["properties"]
        if geom["type"] == "LineString":
            # Tmap은 [경도, 위도] 순서 → [lat, lng]로 뒤집는다
            polyline.extend([[c[1], c[0]] for c in geom["coordinates"]])
        elif geom["type"] == "Point":
            turn = props.get("turnType")
            desc = (props.get("description") or "").strip()
            if turn in STAIRS:
                stairs = True
                desc = f"⚠️ 계단 구간: {desc}"
            elif turn in INFO_TURNS:
                desc = f"[{INFO_TURNS[turn]}] {desc}"
            if desc:
                guides.append(desc)
            if props.get("pointType") == "SP":
                distance = int(props.get("totalDistance", 0))
                duration = int(props.get("totalTime", 0))

    return {"polyline": polyline, "distance": distance, "duration": duration,
            "guides": guides, "stairsPossible": stairs, "fallback": False}


def _leg(start: dict, end: dict) -> dict:
    key = (round(start["lat"], 5), round(start["lng"], 5),
           round(end["lat"], 5), round(end["lng"], 5))
    if key in _cache:
        return _cache[key]

    body = {
        "startX": start["lng"], "startY": start["lat"],
        "endX": end["lng"], "endY": end["lat"],
        "startName": start.get("name") or "출발",
        "endName": end.get("name") or "도착",
        "reqCoordType": "WGS84GEO", "resCoordType": "WGS84GEO",
    }
    for opt in (30, 0):  # 계단제외 → 실패 시 추천 경로(계단 가능성 플래그)
        try:
            r = httpx.post(URL, headers={"appKey": os.environ["TMAP_APP_KEY"]},
                           data={**body, "searchOption": opt}, timeout=5.0)
            data = r.json()
            if r.status_code != 200 or "features" not in data:
                continue
            leg = _parse(data, stairs_forced=(opt != 30))
            _cache[key] = leg
            return leg
        except Exception:
            continue

    # 완전 실패 → 직선 폴백 (앱은 안 죽는다)
    return {"polyline": [[start["lat"], start["lng"]], [end["lat"], end["lng"]]],
            "distance": 0, "duration": 0,
            "guides": ["경로 탐색 일시 불가 — 직선으로 표시합니다"],
            "stairsPossible": True, "fallback": True}


def route(waypoints: list[dict]) -> dict:
    legs = [_leg(waypoints[i], waypoints[i + 1]) for i in range(len(waypoints) - 1)]

    # 전 구간 실패 + 데모 픽스처 존재 → 픽스처 반환 (발표장 네트워크 사망 대비)
    if all(l["fallback"] for l in legs) and FIXTURE.exists():
        return json.loads(FIXTURE.read_text())

    return {"legs": legs,
            "totalDistance": sum(l["distance"] for l in legs),
            "totalDuration": sum(l["duration"] for l in legs)}
