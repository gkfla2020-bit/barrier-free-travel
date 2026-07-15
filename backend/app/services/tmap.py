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


# 이동 난이도 기준 (기획 스펙 기반, 도보 전용 코스에 맞게 거리 임계만 조정:
# 스펙의 300/700m는 대중교통 잔여도보 기준이라 도보 코스에 그대로 쓰면 전부 '어려움'이 됨)
DIST_MEDIUM = 500   # m 초과 → 중간
DIST_HARD = 1200    # m 초과 → 어려움
_RANK = {"쉬움": 0, "중간": 1, "어려움": 2}


def _difficulty(distance: int, stairs_cnt: int, slope_cnt: int) -> tuple[str, list[str]]:
    """경로 내 가장 어려운 요소가 최종 난이도 (worst-element 방식)."""
    level, reasons = "쉬움", []
    if stairs_cnt:
        level = "어려움"
        reasons.append(f"계단 구간 {stairs_cnt}회")
    if slope_cnt:
        level = max(level, "중간", key=_RANK.get)
        reasons.append(f"경사로 {slope_cnt}회")
    if distance > DIST_HARD:
        level = "어려움"
        reasons.append(f"도보 {distance}m")
    elif distance > DIST_MEDIUM:
        level = max(level, "중간", key=_RANK.get)
        reasons.append(f"도보 {distance}m")
    return level, reasons


def _parse(data: dict, stairs_forced: bool) -> dict:
    polyline: list[list[float]] = []
    guides: list[str] = []
    distance = duration = 0
    stairs = stairs_forced
    stairs_cnt = slope_cnt = elevator_cnt = 0

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
                stairs_cnt += 1
                desc = f"⚠️ 계단 구간: {desc}"
            elif turn in INFO_TURNS:
                if turn == 128:
                    slope_cnt += 1
                elif turn == 218:
                    elevator_cnt += 1
                desc = f"[{INFO_TURNS[turn]}] {desc}"
            if desc:
                guides.append(desc)
            if props.get("pointType") == "SP":
                distance = int(props.get("totalDistance", 0))
                duration = int(props.get("totalTime", 0))

    level, reasons = _difficulty(distance, stairs_cnt, slope_cnt)
    if elevator_cnt:
        reasons.append(f"엘리베이터 {elevator_cnt}회")
    return {"polyline": polyline, "distance": distance, "duration": duration,
            "guides": guides, "stairsPossible": stairs, "fallback": False,
            "difficulty": level, "reasons": reasons}


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
            "stairsPossible": True, "fallback": True,
            "difficulty": "어려움", "reasons": ["경로 확인 불가"]}


def route(waypoints: list[dict]) -> dict:
    legs = [_leg(waypoints[i], waypoints[i + 1]) for i in range(len(waypoints) - 1)]

    # 전 구간 실패 + 데모 픽스처 존재 → 픽스처 반환 (발표장 네트워크 사망 대비)
    if all(l["fallback"] for l in legs) and FIXTURE.exists():
        return json.loads(FIXTURE.read_text())

    # 코스 전체 난이도: 최악 구간 기준 + '중간' 4개 이상이면 어려움 보정 (기획 스펙)
    worst = max((l["difficulty"] for l in legs), key=_RANK.get, default="쉬움")
    if worst == "중간" and sum(1 for l in legs if l["difficulty"] == "중간") >= 4:
        worst = "어려움"
    total_stairs = sum(l["difficulty"] == "어려움" and "계단" in " ".join(l["reasons"]) for l in legs)
    reasons = []
    if total_stairs:
        reasons.append(f"계단 포함 구간 {total_stairs}개")
    reasons.append(f"총 도보 {sum(l['distance'] for l in legs)}m")

    return {"legs": legs,
            "totalDistance": sum(l["distance"] for l in legs),
            "totalDuration": sum(l["duration"] for l in legs),
            "difficulty": worst, "reasons": reasons}
