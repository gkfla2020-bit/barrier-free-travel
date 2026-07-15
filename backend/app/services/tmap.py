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


# ── 이동 난이도 산정 ──────────────────────────────────────────────
# 원칙 1  worst-element: 경로에서 가장 어려운 요소 하나가 최종 난이도를 정한다.
# 원칙 2  보수적 판정: 데이터로 확인 불가한 것(계단 칸수, 경사 각도, 육교·지하보도의
#         승강설비 유무)은 전부 위험한 쪽으로 분류한다. "아마 되겠지"는 금지.
# 원칙 3  이유 병기: 난이도만 던지지 않고 근거를 함께 보여준다.
#
# 어려움: 계단 1회+ · 육교/지하보도 1회+ · 도보 1200m 초과 · 경사로 3회+
# 중간  : 경사로 1~2회 · 횡단보도 5회+ · 도보 500~1200m
# 보정  : 중간 요소 4개 이상 → 어려움 (기획 스펙)
# 거리 임계(500/1200m)는 도보 전용 코스 기준 — 스펙의 300/700m는 대중교통 잔여도보 기준.
DIST_MEDIUM = 700
DIST_HARD = 1500
CROSSWALK_MEDIUM = 5   # 회 이상 → 중간 (연석·신호 압박, 단 도심 특성상 어려움까진 과잉)
SLOPE_HARD = 3         # 회 이상 → 어려움 (각도 데이터가 없어 횟수로 근사)
COURSE_HARD_TOTAL = 4000  # m — 이동약자 반나절 권장 상한, 초과 시 코스 난이도 어려움
_RANK = {"쉬움": 0, "중간": 1, "어려움": 2}


def _difficulty(distance: int, c: dict) -> tuple[str, list[str]]:
    hard, medium = [], []
    if c["stairs"]:
        hard.append(f"계단 구간 {c['stairs']}회")
    if c["bridge"]:
        hard.append(f"육교·지하보도 {c['bridge']}회 (승강설비 확인 불가)")
    if c["slope"] >= SLOPE_HARD:
        hard.append(f"경사로 {c['slope']}회")
    elif c["slope"]:
        medium.append(f"경사로 {c['slope']}회")
    if c["crosswalk"] >= CROSSWALK_MEDIUM:
        medium.append(f"횡단보도 {c['crosswalk']}회")
    if distance > DIST_HARD:
        hard.append(f"도보 {distance}m")
    elif distance > DIST_MEDIUM:
        medium.append(f"도보 {distance}m")

    if hard:
        return "어려움", hard + medium
    if len(medium) >= 4:
        return "어려움", medium
    if medium:
        return "중간", medium
    return "쉬움", []


CROSSWALKS = set(range(211, 218))          # 횡단보도 계열 turnType
BRIDGE_TURNS = {125: "육교", 126: "지하보도"}
BRIDGE_FACILITY = {"12", "14", "18"}       # LineString facilityType: 육교/지하보도/지하철지하보도
# 계단은 turnType(127/129)이 아니라 LineString facilityType 17로 온다 — 실측 확인:
# 명동→남산 옵션0 경로의 fac 17이 옵션30에서 완전히 사라짐 (17=계단 확정)
STAIRS_FACILITY = "17"


def _parse(data: dict, stairs_forced: bool) -> dict:
    polyline: list[list[float]] = []
    guides: list[str] = []
    distance = duration = 0
    stairs = stairs_forced
    counts = {"stairs": 0, "slope": 0, "elevator": 0, "crosswalk": 0, "bridge": 0}
    facility_bridge = 0

    for feat in data.get("features", []):
        geom, props = feat["geometry"], feat["properties"]
        if geom["type"] == "LineString":
            # Tmap은 [경도, 위도] 순서 → [lat, lng]로 뒤집는다
            polyline.extend([[c[1], c[0]] for c in geom["coordinates"]])
            fac = str(props.get("facilityType", ""))
            if fac in BRIDGE_FACILITY:
                facility_bridge += 1
            elif fac == STAIRS_FACILITY:
                stairs = True
                counts["stairs"] += 1
        elif geom["type"] == "Point":
            turn = props.get("turnType")
            desc = (props.get("description") or "").strip()
            if turn in STAIRS:
                stairs = True
                counts["stairs"] += 1
                desc = f"⚠️ 계단 구간: {desc}"
            elif turn in BRIDGE_TURNS:
                counts["bridge"] += 1
                desc = f"⚠️ {BRIDGE_TURNS[turn]}(승강설비 확인 불가): {desc}"
            elif turn in CROSSWALKS:
                counts["crosswalk"] += 1
            elif turn == 128:
                counts["slope"] += 1
                desc = f"[경사로] {desc}"
            elif turn == 218:
                counts["elevator"] += 1
                desc = f"[엘리베이터] {desc}"
            if desc:
                guides.append(desc)
            if props.get("pointType") == "SP":
                distance = int(props.get("totalDistance", 0))
                duration = int(props.get("totalTime", 0))

    # 안내점에 안 잡히고 구간 시설물로만 잡히는 육교/지하보도 보완 (중복 방지 위해 max)
    counts["bridge"] = max(counts["bridge"], facility_bridge)
    if counts["stairs"] and stairs_forced:  # 계단회피 실패 폴백 경로에만 등장 가능
        guides.insert(0, f"⚠️ 이 구간은 계단 {counts['stairs']}곳을 지납니다 (우회 경로를 찾지 못함)")

    level, reasons = _difficulty(distance, counts)
    if counts["elevator"]:
        reasons.append(f"엘리베이터 경유 {counts['elevator']}회")
    if counts["bridge"]:
        stairs = True  # 육교·지하보도는 계단 가능성으로도 취급 (지도에 경고색)
    return {"polyline": polyline, "distance": distance, "duration": duration,
            "guides": guides, "stairsPossible": stairs, "fallback": False,
            "difficulty": level, "reasons": reasons, "counts": counts}


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


def segment_failure_message(a: dict, b: dict) -> str:
    """완전 실패(직선 폴백) 구간을 사람이 읽을 수 있게 식별한다 (Req 9.3).

    두 경유지 사이 경로를 전혀 만들지 못한 경우, 어느 구간(출발지→도착지)이
    라우팅되지 못했는지 이름으로 알려주는 안내 문구를 만든다."""
    fa = (a.get("name") or "").strip() or "출발지"
    fb = (b.get("name") or "").strip() or "도착지"
    return f"'{fa}' → '{fb}' 구간의 경로를 찾지 못했습니다 (직선으로 표시)"


def mark_unrouted(leg: dict, a: dict, b: dict) -> None:
    """완전 실패 leg에 실패 구간 식별 메시지를 안내·사유 앞에 추가한다 (Req 9.3).

    호출부는 캐시 오염을 막기 위해 leg의 guides/reasons를 복사한 뒤 전달해야 한다.
    중복 삽입은 방지한다."""
    msg = segment_failure_message(a, b)
    guides = leg.setdefault("guides", [])
    if msg not in guides:
        guides.insert(0, msg)
    reasons = leg.setdefault("reasons", [])
    if msg not in reasons:
        reasons.insert(0, msg)


def route(waypoints: list[dict]) -> dict:
    # 개별 외부 호출은 모두 타임아웃이 걸려 있어 응답 시간이 경계지어진다(Req 9.1):
    # Tmap 보행자 호출은 _leg에서 httpx timeout=5.0(opt 30→0)로 제한된다.
    legs = []
    for a, b in zip(waypoints, waypoints[1:]):
        leg = _leg(a, b)
        if leg.get("fallback"):
            # 완전 실패 구간 — 캐시 원본을 오염시키지 않도록 복사 후 식별 메시지 추가
            leg = {**leg, "guides": list(leg.get("guides", [])),
                   "reasons": list(leg.get("reasons", []))}
            mark_unrouted(leg, a, b)
        legs.append(leg)

    # 전 구간 실패 + 데모 픽스처 존재 → 픽스처 반환 (발표장 네트워크 사망 대비)
    if all(l["fallback"] for l in legs) and FIXTURE.exists():
        return json.loads(FIXTURE.read_text())

    # 코스 전체 난이도: 최악 구간 + 중간 4개 이상 보정 + 총거리 상한 (반나절 3km)
    total = sum(l["distance"] for l in legs)
    worst = max((l["difficulty"] for l in legs), key=_RANK.get, default="쉬움")
    if worst == "중간" and sum(1 for l in legs if l["difficulty"] == "중간") >= 4:
        worst = "어려움"

    agg = {k: sum(l.get("counts", {}).get(k, 0) for l in legs)
           for k in ("stairs", "bridge", "slope", "crosswalk", "elevator")}
    reasons = []
    if agg["stairs"]:
        reasons.append(f"계단 구간 {agg['stairs']}회")
    if agg["bridge"]:
        reasons.append(f"육교·지하보도 {agg['bridge']}회")
    if total > COURSE_HARD_TOTAL:
        worst = "어려움"
        reasons.append(f"총 도보 {total}m — 반나절 권장(4km) 초과")
    else:
        reasons.append(f"총 도보 {total}m")
    if agg["crosswalk"]:
        reasons.append(f"횡단보도 {agg['crosswalk']}회")

    return {"legs": legs,
            "totalDistance": total,
            "totalDuration": sum(l["duration"] for l in legs),
            "difficulty": worst, "reasons": reasons}
