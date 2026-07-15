"""대중교통(지하철/버스) 경로 — ODsay 길찾기 + 도보 구간은 Tmap 계단회피 재사용.

이동약자 원칙 (tmap.py와 동일 기조):
- 경로 선택: ODsay 추천순이 아니라 환승 적은 순 → 총도보 적은 순으로 고른다.
- 지하철 구간은 승강설비(엘리베이터) 유무를 데이터로 확인할 수 없다 → 계단
  가능성으로 취급하고 난이도를 최소 '중간'으로 올린다.
- 버스 구간은 저상버스 여부 확인 안내를 붙인다 (TAGO 실시간 연동은 다음 단계).
- ODSAY_API_KEY 미설정·호출 실패 시 도보 경로로 폴백 — 앱은 안 죽는다.
"""
import math
import os

import httpx

from . import tago, tmap

URL = "https://api.odsay.com/v1/api/searchPubTransPathT"
WALK_ONLY_M = 700  # 직선거리 이하 구간은 대중교통 없이 도보 유지 (탑승이 오히려 손해)

_cache: dict[tuple, dict] = {}
_RANK = {"쉬움": 0, "중간": 1, "어려움": 2}

# 수도권 지하철 노선색 (ODsay lane.name 부분 일치) — 미등록 노선은 기본 보라
SUBWAY_COLOR = {
    "1호선": "#0052A4", "2호선": "#00A84D", "3호선": "#EF7C1C", "4호선": "#00A5DE",
    "5호선": "#996CAC", "6호선": "#CD7C2F", "7호선": "#747F00", "8호선": "#E6186C",
    "9호선": "#BDB092", "경의중앙": "#77C4A3", "공항철도": "#0090D2", "신분당": "#D4003B",
    "수인분당": "#F5A200", "우이신설": "#B0CE18",
}
BUS_COLOR = "#16a34a"
SUBWAY_DEFAULT = "#7c3aed"

NOTE_SUBWAY = "지하철 역사 승강설비(엘리베이터) 사전 확인 필요"
NOTE_BUS = "저상버스 배차 여부 확인 필요"


def _straight_m(a: dict, b: dict) -> int:
    return int(math.hypot((a["lat"] - b["lat"]) * 111_000, (a["lng"] - b["lng"]) * 88_000))


def _subway_color(name: str) -> str:
    for k, c in SUBWAY_COLOR.items():
        if k in name:
            return c
    return SUBWAY_DEFAULT


def _pick_path(paths: list[dict]) -> dict:
    """환승 최소 → 도보 최소. 이동약자에게 환승 1회는 시간 절약보다 비싸다."""
    def key(p):
        info = p.get("info", {})
        transfers = info.get("busTransitCount", 0) + info.get("subwayTransitCount", 0)
        return (transfers, info.get("totalWalk", 0), info.get("totalTime", 0))
    return min(paths, key=key)


def _odsay(start: dict, end: dict) -> dict | None:
    api_key = os.environ.get("ODSAY_API_KEY", "")
    if not api_key:
        return None
    # ODsay는 앱에 등록한 서비스 URI를 Referer로 대조한다 — 서버 호출도 헤더 필수
    referer = os.environ.get("ODSAY_REFERER", "")
    try:
        r = httpx.get(URL, params={
            "SX": start["lng"], "SY": start["lat"],
            "EX": end["lng"], "EY": end["lat"], "apiKey": api_key,
        }, headers={"Referer": referer} if referer else {}, timeout=7.0)
        paths = (r.json().get("result") or {}).get("path") or []
        return _pick_path(paths) if paths else None
    except Exception:
        return None


def _walk_to(cursor: dict, target: dict) -> dict:
    """도보 구간 — Tmap 계단회피(_leg)를 그대로 재사용해 난이도·안내문까지 얻는다."""
    w = tmap._leg(cursor, target)
    seg = {"mode": "walk", "name": "도보", "polyline": w["polyline"],
           "distance": w["distance"], "duration": w["duration"],
           "stations": [], "color": ""}
    return {"seg": seg, "leg": w}


def _leg(start: dict, end: dict) -> dict:
    ck = (round(start["lat"], 5), round(start["lng"], 5),
          round(end["lat"], 5), round(end["lng"], 5))
    if ck in _cache:
        return _cache[ck]

    path = _odsay(start, end)
    if not path:  # 키 없음 / 경로 없음 / 호출 실패 → 도보 폴백
        leg = {**tmap._leg(start, end), "mode": "walk", "segments": []}
        leg["guides"] = ["대중교통 경로를 찾지 못해 도보 경로로 안내합니다"] + leg["guides"]
        return leg

    segs: list[dict] = []
    polyline: list[list[float]] = []
    guides: list[str] = []
    reasons: list[str] = []
    counts = {"stairs": 0, "slope": 0, "elevator": 0, "crosswalk": 0, "bridge": 0}
    walk_m = dur_s = 0
    stairs = False
    worst = "쉬움"
    has_subway = has_bus = False
    cursor = start
    subs = path.get("subPath", [])

    def add_walk(target: dict):
        nonlocal walk_m, dur_s, stairs, worst, cursor
        w = _walk_to(cursor, target)
        segs.append(w["seg"])
        polyline.extend(w["seg"]["polyline"])
        walk_m += w["leg"]["distance"]
        dur_s += w["leg"]["duration"]
        stairs = stairs or w["leg"]["stairsPossible"]
        if _RANK[w["leg"]["difficulty"]] > _RANK[worst]:
            worst = w["leg"]["difficulty"]
        for k in counts:
            counts[k] += w["leg"].get("counts", {}).get(k, 0)
        guides.extend(w["leg"]["guides"])
        reasons.extend(r for r in w["leg"]["reasons"] if r not in reasons)
        cursor = target

    for i, sp in enumerate(subs):
        t = sp.get("trafficType")
        if t == 3:  # 도보: 다음 승차 지점(없으면 최종 목적지)까지 계단회피로
            if not sp.get("distance"):
                continue
            target = end
            for nxt in subs[i + 1:]:
                if nxt.get("trafficType") in (1, 2):
                    target = {"lat": nxt["startY"], "lng": nxt["startX"],
                              "name": nxt.get("startName", "")}
                    break
            add_walk(target)
        elif t in (1, 2):  # 1 지하철, 2 버스
            lane = (sp.get("lane") or [{}])[0]
            is_subway = t == 1
            name = lane.get("name", "") if is_subway else f"{lane.get('busNo', '')}번 버스"
            stations = [s.get("stationName", "")
                        for s in (sp.get("passStopList", {}).get("stations") or [])]
            pl = [[float(s["y"]), float(s["x"])]
                  for s in (sp.get("passStopList", {}).get("stations") or [])
                  if s.get("x") and s.get("y")]
            secs = int(sp.get("sectionTime", 0)) * 60
            seg = {
                "mode": "subway" if is_subway else "bus", "name": name,
                "polyline": pl, "distance": int(sp.get("distance", 0)),
                "duration": secs, "stations": stations,
                "color": _subway_color(name) if is_subway else BUS_COLOR,
            }
            if not is_subway:  # 저상버스 실시간 조회용 승차 정보 (응답 시점에 사용)
                seg["_board"] = {"lat": sp["startY"], "lng": sp["startX"],
                                 "name": sp.get("startName", ""),
                                 "busNo": lane.get("busNo", "")}
            segs.append(seg)
            polyline.extend(pl)
            dur_s += secs
            kind = "지하철" if is_subway else "버스"
            guides.append(
                f"[{kind}] {name}: {sp.get('startName', '')} → {sp.get('endName', '')}"
                f" ({sp.get('stationCount', 0)}개 {'역' if is_subway else '정류장'},"
                f" {sp.get('sectionTime', 0)}분)")
            if is_subway:
                has_subway = True
                stairs = True  # 역사 계단 가능성 — 승강설비 확인 불가는 위험쪽으로
                if NOTE_SUBWAY not in reasons:
                    reasons.append(NOTE_SUBWAY)
            else:
                has_bus = True
                if NOTE_BUS not in reasons:
                    reasons.append(NOTE_BUS)
            cursor = {"lat": sp["endY"], "lng": sp["endX"], "name": sp.get("endName", "")}

    if _straight_m(cursor, end) > 50:  # ODsay가 잔여 도보를 안 준 경우 보완
        add_walk(end)

    # 지하철 포함 leg는 최소 '중간' — 승강설비 미확인을 쉬움으로 표시하지 않는다
    if has_subway and _RANK[worst] < _RANK["중간"]:
        worst = "중간"

    leg = {"mode": "transit", "segments": segs, "polyline": polyline,
           "distance": walk_m, "duration": dur_s, "guides": guides,
           "stairsPossible": stairs, "fallback": False,
           "difficulty": worst, "reasons": reasons, "counts": counts,
           "_transit": {"subway": has_subway, "bus": has_bus}}
    _cache[ck] = leg
    return leg


def _enrich_low_floor(leg: dict) -> None:
    """버스 구간마다 다음 버스 저상 여부를 실시간 조회해 안내에 붙인다.
    실시간 정보라 leg 캐시에 넣지 않고 매 응답마다 갱신한다."""
    for seg in leg["segments"]:
        board = seg.get("_board")
        if seg.get("mode") != "bus" or not board:
            continue
        low, note = tago.next_bus(board["lat"], board["lng"],
                                  board["busNo"], board["name"])
        seg["lowFloor"] = low
        seg["lowFloorNote"] = note
        if not note:
            continue
        prefix = "[저상] " if low else "⚠️ "
        head = f"[버스] {seg['name']}"  # 해당 버스 안내문 바로 뒤에 삽입
        idx = next((i for i, g in enumerate(leg["guides"]) if g.startswith(head)), None)
        leg["guides"].insert(idx + 1 if idx is not None else len(leg["guides"]),
                             prefix + note)
        if not low and "저상 아님" not in " ".join(leg["reasons"]):
            leg["reasons"].append(f"{seg['name']} 다음 차량 저상 아님")


def route(waypoints: list[dict]) -> dict:
    legs = []
    for a, b in zip(waypoints, waypoints[1:]):
        if _straight_m(a, b) <= WALK_ONLY_M:
            base = {**tmap._leg(a, b), "mode": "walk", "segments": []}
        else:
            base = _leg(a, b)
        # 캐시 원본을 오염시키지 않도록 복사 후 실시간 정보를 얹는다
        leg = {**base, "guides": list(base["guides"]), "reasons": list(base["reasons"]),
               "segments": [dict(s) for s in base.get("segments", [])]}
        _enrich_low_floor(leg)
        legs.append(leg)

    total_walk = sum(l["distance"] for l in legs)
    worst = max((l["difficulty"] for l in legs), key=_RANK.get, default="쉬움")
    if worst == "중간" and sum(1 for l in legs if l["difficulty"] == "중간") >= 4:
        worst = "어려움"

    n_transit = sum(1 for l in legs if l.get("mode") == "transit")
    reasons = [f"총 도보 {total_walk}m", f"대중교통 {n_transit}개 구간 이용"]
    if any(l.get("_transit", {}).get("subway") for l in legs):
        reasons.append(NOTE_SUBWAY)
    # 실시간 조회로 저상 여부를 알아낸 구간은 구체적으로, 못 알아낸 구간만 일반 안내
    bus_segs = [s for l in legs for s in l["segments"] if s.get("mode") == "bus"]
    if any(s.get("lowFloor") is False for s in bus_segs):
        reasons.append("일부 구간 다음 버스가 저상 아님 — 구간 안내 확인")
    elif any(s.get("lowFloor") for s in bus_segs):
        reasons.append("다음 버스 저상 확인됨")
    if any(s.get("lowFloor") is None for s in bus_segs):
        reasons.append(NOTE_BUS)

    for l in legs:  # 내부 필드는 응답에서 제거
        l.pop("_transit", None)

    return {"legs": legs, "totalDistance": total_walk,
            "totalDuration": sum(l["duration"] for l in legs),
            "difficulty": worst, "reasons": reasons}
