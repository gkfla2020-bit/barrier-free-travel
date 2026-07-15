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
import time

import httpx

from . import tago, tmap

URL = "https://api.odsay.com/v1/api/searchPubTransPathT"
WALK_ONLY_M = 700  # 직선거리 이하 구간은 대중교통 없이 도보 유지 (탑승이 오히려 손해)
# 저상버스 실시간 enrich 전체 예산(초). 다구간 코스에서 leg별 TAGO 순차 호출이
# 누적돼 전체 응답 10초(Req 9.1)를 넘길 수 있으므로, 이 예산을 넘기면 남은 버스
# 구간의 실시간 조회를 건너뛰고 lowFloor=None으로 둔다. 10초보다 여유 있게 잡는다.
LOW_FLOOR_BUDGET_S = 8.0

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


LANE_URL = "https://api.odsay.com/v1/api/loadLane"
NOTE_APPROX = "그려진 선은 정류장 간 개략 직선이며 실제 도로 형상과 다를 수 있습니다"
_lane_cache: dict[str, list | None] = {}


def _graphpos_to_polyline(graph_pos) -> list[list[float]]:
    """loadLane graphPos([{x:lng, y:lat}, ...])를 [[lat, lng], ...]로 변환.

    x/y가 없거나 숫자가 아닌 점은 건너뛰고 입력 순서를 보존한다.
    유효 점이 2개 미만이면 폴백 신호로 빈 리스트를 반환한다(순수 함수)."""
    out: list[list[float]] = []
    for p in graph_pos or []:
        try:
            lat, lng = float(p["y"]), float(p["x"])
        except (KeyError, TypeError, ValueError):
            continue
        out.append([lat, lng])
    return out if len(out) >= 2 else []


def _load_lane(map_obj: str) -> list[list[list[float]]] | None:
    """ODsay loadLane API로 노선 실제 도로 형상을 조회한다.

    반환: 각 section의 [[lat, lng], ...] 형상 리스트들의 리스트(대중교통 구간 순서).
    키 없음/실패/타임아웃/빈 형상이면 None (예외는 절대 올리지 않음). map_obj로 캐시."""
    if not map_obj:
        return None
    if map_obj in _lane_cache:
        return _lane_cache[map_obj]
    api_key = os.environ.get("ODSAY_API_KEY", "")
    if not api_key:
        _lane_cache[map_obj] = None
        return None
    referer = os.environ.get("ODSAY_REFERER", "")
    try:
        r = httpx.get(LANE_URL, params={
            "mapObject": f"0:0@{map_obj}", "apiKey": api_key,
        }, headers={"Referer": referer} if referer else {}, timeout=6.0)
        lanes = (r.json().get("result") or {}).get("lane") or []
        sections: list[list[list[float]]] = []
        for lane in lanes:
            for sec in lane.get("section") or []:
                pts = _graphpos_to_polyline(sec.get("graphPos"))
                if pts:
                    sections.append(pts)
        result = sections or None
    except Exception:
        result = None
    _lane_cache[map_obj] = result
    return result


def _walk_segment(base: dict) -> dict:
    """도보 leg 하나를 단일 walk segment로 분해한다.

    walk-only leg(700m 이하)와 ODsay 폴백 leg도 segment 목록을 갖도록 해
    전체 소요시간=Σsegment duration(Req 4.1), 전체 도보=Σwalk segment distance
    (Req 4.2) 불변식이 혼합 경로에서도 성립하게 한다. walk segment의 stations는
    항상 빈 리스트(Req 3.9)."""
    return {"mode": "walk", "name": "도보", "polyline": list(base.get("polyline", [])),
            "distance": base.get("distance", 0), "duration": base.get("duration", 0),
            "stations": [], "color": ""}


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
        base = tmap._leg(start, end)
        leg = {**base, "mode": "walk", "segments": [_walk_segment(base)]}
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

    # 실제 도로 형상(loadLane) 조회 — 대중교통 구간 순서대로 소비한다.
    # 실패/미가용이면 None → 각 대중교통 구간을 정류장 직선 + approx 폴백 처리.
    lane_sections = _load_lane((path.get("info") or {}).get("mapObj", ""))
    lane_idx = 0

    def _match_section(seg_pl: list, sub: dict):
        """이 대중교통 구간에 대응하는 loadLane section 형상을 순서대로 꺼낸다.
        endpoint 근접 검증: section 시작/끝이 구간 승하차점과 크게 어긋나면 폴백."""
        nonlocal lane_idx
        if not lane_sections or lane_idx >= len(lane_sections):
            return None
        sec = lane_sections[lane_idx]
        lane_idx += 1
        try:
            s_lat, s_lng = float(sub["startY"]), float(sub["startX"])
            e_lat, e_lng = float(sub["endY"]), float(sub["endX"])
        except (KeyError, TypeError, ValueError):
            return sec  # 승하차 좌표가 없으면 순서 기반만 신뢰
        # section 양끝이 구간 양끝과 대략 맞는지(방향 무관) 확인 — 약 500m 허용
        def near(a, b):
            return abs(a[0] - b[0]) < 0.005 and abs(a[1] - b[1]) < 0.006
        head, tail = sec[0], sec[-1]
        ok = (near(head, [s_lat, s_lng]) and near(tail, [e_lat, e_lng])) or \
             (near(head, [e_lat, e_lng]) and near(tail, [s_lat, s_lng]))
        return sec if ok else None

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
            # ODsay 지방 버스는 busNo에 기점이 붙어 온다 (예: "431(제주버스터미널)").
            # 그대로 쓰면 "431(제주버스터미널)번 버스"처럼 정류장을 지어낸 것처럼 보이고,
            # TAGO routeno("431")와도 매칭이 깨져 저상 조회가 조용히 실패한다.
            bus_no = lane.get("busNo", "").split("(")[0].strip()
            name = lane.get("name", "") if is_subway else f"{bus_no}번 버스"
            stations = [s.get("stationName", "")
                        for s in (sp.get("passStopList", {}).get("stations") or [])]
            pl = [[float(s["y"]), float(s["x"])]
                  for s in (sp.get("passStopList", {}).get("stations") or [])
                  if s.get("x") and s.get("y")]
            # 정류장 이름 + 좌표를 함께 — 지도 마커에 정류장명을 표시하기 위함
            stops = [{"name": s.get("stationName", ""),
                      "lat": float(s["y"]), "lng": float(s["x"])}
                     for s in (sp.get("passStopList", {}).get("stations") or [])
                     if s.get("x") and s.get("y")]
            secs = int(sp.get("sectionTime", 0)) * 60
            # 실제 도로 형상 우선: loadLane section이 대응되면 그 형상으로 그린다.
            # 없으면 정류장 직선(pl) + approx=True + stationCoords + 안내로 폴백.
            lane_pl = _match_section(pl, sp)
            if lane_pl and len(lane_pl) >= 2:
                draw_pl, approx = lane_pl, False
                station_coords: list[list[float]] = []
            else:
                draw_pl, approx = pl, True
                station_coords = pl
            seg = {
                "mode": "subway" if is_subway else "bus", "name": name,
                "polyline": draw_pl, "distance": int(sp.get("distance", 0)),
                "duration": secs, "stations": stations,
                "color": _subway_color(name) if is_subway else BUS_COLOR,
                "approx": approx, "stationCoords": station_coords,
                "stops": stops,
            }
            if not is_subway:  # 저상버스 실시간 조회용 승차 정보 (응답 시점에 사용)
                seg["_board"] = {"lat": sp["startY"], "lng": sp["startX"],
                                 "name": sp.get("startName", ""),
                                 "busNo": bus_no}
            segs.append(seg)
            polyline.extend(draw_pl)
            if approx:
                kind_ap = "지하철" if is_subway else "버스"
                guides.append(f"ℹ️ [{kind_ap}] {name}: {NOTE_APPROX}")
                if NOTE_APPROX not in reasons:
                    reasons.append(NOTE_APPROX)
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


def _enrich_low_floor(leg: dict, deadline: float | None = None) -> None:
    """버스 구간마다 다음 버스 저상 여부를 실시간 조회해 안내에 붙인다.
    실시간 정보라 leg 캐시에 넣지 않고 매 응답마다 갱신한다.

    deadline(monotonic 타임스탬프)이 주어지면 전체 예산 가드로 동작한다(Req 9.1):
    현재 시각이 deadline을 넘긴 뒤의 버스 구간은 TAGO 호출을 생략하고
    lowFloor=None, lowFloorNote=""로 둔다. deadline=None이면 예산 없이 전부 조회
    (하위 호환). 개별 TAGO 실패는 tago.next_bus가 (None, "")를 돌려주므로
    여기서 조용히 생략된다(Req 9.2)."""
    for seg in leg["segments"]:
        board = seg.get("_board")
        if seg.get("mode") != "bus" or not board:
            continue
        # 예산 초과: 남은 버스 구간은 실시간 조회를 건너뛰고 미확정으로 둔다
        if deadline is not None and time.monotonic() > deadline:
            seg["lowFloor"] = None
            seg["lowFloorNote"] = ""
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
    # 저상버스 enrich 전체 예산: leg 루프 전체에 걸쳐 공유한다(Req 9.1).
    # 이 시각을 넘기면 남은 버스 구간의 TAGO 실시간 조회를 건너뛴다.
    enrich_deadline = time.monotonic() + LOW_FLOOR_BUDGET_S
    legs = []
    for a, b in zip(waypoints, waypoints[1:]):
        if _straight_m(a, b) <= WALK_ONLY_M:
            walk = tmap._leg(a, b)
            base = {**walk, "mode": "walk", "segments": [_walk_segment(walk)]}
        else:
            base = _leg(a, b)
        # 캐시 원본을 오염시키지 않도록 복사 후 실시간 정보를 얹는다
        leg = {**base, "guides": list(base["guides"]), "reasons": list(base["reasons"]),
               "segments": [dict(s) for s in base.get("segments", [])]}
        # 두 경유지 사이 경로를 완전히 만들지 못한 경우(도보 폴백마저 직선 폴백),
        # 어느 구간(출발지→도착지)이 라우팅되지 못했는지 이름으로 안내한다(Req 9.3).
        if leg.get("fallback"):
            tmap.mark_unrouted(leg, a, b)
        _enrich_low_floor(leg, deadline=enrich_deadline)
        legs.append(leg)

    # 전체 도보 거리 = 모든 walk segment distance 합(Req 4.2). 각 leg의 distance는
    # walk segment 거리 합으로 구성되므로 leg-level 합과 동일하지만, 명세를 정확히
    # 반영하도록 segment 단위로 직접 합산한다.
    total_walk = sum(s["distance"] for l in legs
                     for s in l.get("segments", []) if s.get("mode") == "walk")
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

    # 전체 소요시간 = 모든 segment duration 합(Req 4.1). leg의 duration은 그 leg의
    # segment duration 합으로 구성되므로 leg-level 합과 동일하지만, 명세를 정확히
    # 반영하도록 segment 단위로 직접 합산한다.
    total_duration = sum(s["duration"] for l in legs for s in l.get("segments", []))

    return {"legs": legs, "totalDistance": total_walk,
            "totalDuration": total_duration,
            "difficulty": worst, "reasons": reasons}
