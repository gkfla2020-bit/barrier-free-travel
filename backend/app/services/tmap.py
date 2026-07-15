"""Tmap 보행자 경로 클라이언트 — searchOption=30(계단제외) 우선, 실패 시 0 폴백."""
import json
import math
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx

from . import elevation

URL = "https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1"
FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "demo_route.json"

# 계단/경사/엘리베이터 turnType (Tmap 공식 문서)
STAIRS = {127, 129}
INFO_TURNS = {125: "육교", 126: "지하보도", 128: "경사로", 218: "엘리베이터"}

_cache: dict[tuple, dict] = {}


# ── 이동 난이도 산정 ──────────────────────────────────────────────
# 원칙 1  worst-element: 경로에서 가장 어려운 요소 하나가 최종 난이도를 정한다.
# 원칙 2  보수적 판정: 데이터로 확인 불가한 것(계단 칸수, 육교·지하보도의 승강설비 유무)은
#         전부 위험한 쪽으로 분류한다. "아마 되겠지"는 금지.
#         단 표고는 예외 — 조회 실패는 "존재하지만 못 잰 것"이 아니라 "아무것도 모르는 것"이라
#         난이도에서 빼버린다. 자세한 이유는 elevation.py 상단 참조.
# 원칙 3  이유 병기: 난이도만 던지지 않고 근거를 함께 보여준다.
#
# 어려움: 계단 1회+ · 육교/지하보도 1회+ · 도보 1500m 초과 · 경사로 3회+ · 지형경사 8.33%+
# 중간  : 경사로 1~2회 · 횡단보도 5회+ · 도보 700~1500m · 지형경사 5%+
# 보정  : 중간 요소 4개 이상 → 어려움 (기획 스펙)
# 거리 임계(700/1500m)는 도보 전용 코스 기준 — 스펙의 300/700m는 대중교통 잔여도보 기준.
#
# 경사는 두 소스를 함께 본다. 서로를 대체하지 않는다:
#   turnType 128  = 경사로 '구조물'이 있다 (횟수만 알고 기울기는 모름)
#   표고 프로파일 = 지형이 실제로 기울어져 있다 (90m 평균 기울기, 짧은 턱은 못 봄)
DIST_MEDIUM = 700
DIST_HARD = 1500
CROSSWALK_MEDIUM = 5   # 회 이상 → 중간 (연석·신호 압박, 단 도심 특성상 어려움까진 과잉)
SLOPE_HARD = 3         # 회 이상 → 어려움 (경사로 구조물 횟수 — 기울기는 표고가 따로 본다)
COURSE_HARD_TOTAL = 4000  # m — 이동약자 반나절 권장 상한, 초과 시 코스 난이도 어려움
_RANK = {"쉬움": 0, "중간": 1, "어려움": 2}


def _difficulty(distance: int, c: dict, prof: dict | None = None) -> tuple[str, list[str]]:
    hard, medium = [], []
    if c["stairs"]:
        hard.append(f"계단 구간 {c['stairs']}회")
    if c["bridge"]:
        hard.append(f"육교·지하보도 {c['bridge']}회 (승강설비 확인 불가)")
    if prof and prof["maxGrade"] >= elevation.GRADE_STEEP:
        hard.append(f"급경사 최대 {prof['maxGrade']:.0f}% "
                    f"(1/12 초과 구간 {prof['steepDist']}m)")
    elif prof and prof["maxGrade"] >= elevation.GRADE_MODERATE:
        medium.append(f"오르내림 최대 {prof['maxGrade']:.0f}% ({prof['moderateDist']}m)")
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
    if counts["bridge"]:
        stairs = True  # 육교·지하보도는 계단 가능성으로도 취급 (지도에 경고색)

    return {"polyline": polyline, "distance": distance, "duration": duration,
            "guides": guides, "stairsPossible": stairs, "fallback": False,
            "counts": counts}


def _score(leg: dict) -> dict:
    """표고 프로파일을 붙이고 난이도를 매긴다 (Open-Meteo 1회 호출).

    _parse에서 분리한 이유: 우회 후보를 고를 때 '거리 상한 통과분'만 표고를 조회하려면
    파싱과 채점 시점이 달라야 한다. 탈락할 후보에 API를 쓰지 않는다.
    """
    if leg["fallback"]:
        # 직선 폴백은 실제 보행로가 아니다. 두 점 사이 표고만 보면 완만해 보이지만
        # 그 사이에 뭐가 있는지 전혀 모르는 상태다 — 여기에 '쉬움'을 매기면
        # 경로 탐색 실패를 '편한 길'로 둔갑시킨다. 폴백의 '어려움'을 그대로 둔다.
        return leg
    prof = elevation.profile(leg["polyline"])
    leg["slope"] = prof
    level, reasons = _difficulty(leg["distance"], leg["counts"], prof)
    if prof and prof["ascent"] >= 10:
        reasons.append(f"누적 오르막 {prof['ascent']}m")
    if leg["counts"]["elevator"]:
        reasons.append(f"엘리베이터 경유 {leg['counts']['elevator']}회")
    if prof is None:
        reasons.append("경사 정보 없음 — 난이도에 미반영")
    leg["difficulty"] = level
    leg["reasons"] = reasons
    return leg


def _fetch_leg(start: dict, end: dict, via: dict | None = None) -> dict:
    body = {
        "startX": start["lng"], "startY": start["lat"],
        "endX": end["lng"], "endY": end["lat"],
        "startName": start.get("name") or "출발",
        "endName": end.get("name") or "도착",
        "reqCoordType": "WGS84GEO", "resCoordType": "WGS84GEO",
    }
    if via:
        body["passList"] = f"{via['lng']},{via['lat']}"  # Tmap 경유지: 경도,위도
    for opt in (30, 0):  # 계단제외 → 실패 시 추천 경로(계단 가능성 플래그)
        try:
            r = httpx.post(URL, headers={"appKey": os.environ["TMAP_APP_KEY"]},
                           data={**body, "searchOption": opt}, timeout=5.0)
            data = r.json()
            if r.status_code != 200 or "features" not in data:
                continue
            return _parse(data, stairs_forced=(opt != 30))
        except Exception:
            continue

    # 완전 실패 → 직선 폴백 (앱은 안 죽는다)
    return {"polyline": [[start["lat"], start["lng"]], [end["lat"], end["lng"]]],
            "distance": 0, "duration": 0,
            "guides": ["경로 탐색 일시 불가 — 직선으로 표시합니다"],
            "stairsPossible": True, "fallback": True,
            "difficulty": "어려움", "reasons": ["경로 확인 불가"], "slope": None,
            "counts": {"stairs": 0, "slope": 0, "elevator": 0, "crosswalk": 0, "bridge": 0}}


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


# ── 경사 회피 (avoidSlope 옵션) ────────────────────────────────────
# 우회 상한: 경사를 피하겠다고 무한정 돌 수는 없다. 이동약자에게 거리도 곧 부담이라
# 늘어난 거리가 아래 두 조건을 모두 통과해야 채택한다.
DETOUR_MAX_RATIO = 1.7   # 원경로의 1.7배 이내
DETOUR_MAX_EXTRA = 700   # m — 그리고 절대 증가분 700m 이내
MIN_DETOUR_LEG = 150     # m — 이보다 짧은 구간은 우회 자체가 무의미
VIA_OFFSETS = (120, 300)  # m — 직선 경로에서 수직으로 띄울 거리
VIA_TRIES = 2            # 실제 Tmap에 물어볼 후보 수 (표고가 중간값에 가까운 순으로)


def _via_candidates(start: dict, end: dict, direct: float) -> list[dict]:
    """출발→도착 직선의 수직 방향으로 우회 경유점 후보를 만든다.

    이건 Tmap에 "이쪽으로도 가보라"고 던지는 씨앗일 뿐이다. 채택 여부는 돌아온 실제
    경로의 표고 프로파일로만 판단한다 — '돌아갔으니 완만하겠지'라고 가정하지 않는다.
    """
    mid_lat, mid_lng = (start["lat"] + end["lat"]) / 2, (start["lng"] + end["lng"]) / 2
    m_lng = 111320 * math.cos(math.radians(mid_lat))
    dy = (end["lat"] - start["lat"]) * 111320
    dx = (end["lng"] - start["lng"]) * m_lng
    n = math.hypot(dx, dy) or 1.0
    px, py = -dy / n, dx / n  # 진행방향에 수직인 단위벡터
    out = []
    for off in VIA_OFFSETS:
        d = min(off, direct * 0.6)  # 짧은 구간에서 과한 우회 방지
        for s in (1, -1):
            out.append({"lat": mid_lat + py * d * s / 111320,
                        "lng": mid_lng + px * d * s / m_lng})
    return out


def _less_slope(start: dict, end: dict, base: dict) -> dict:
    """base보다 경사가 완만한 대안 경로를 찾는다. 못 찾으면 base 그대로."""
    prof = base.get("slope")
    if base["fallback"] or not prof or prof["maxGrade"] < elevation.GRADE_MODERATE:
        return base  # 이미 완만하거나 판단 근거 없음 → 외부 호출 0회로 조기 종료
    direct = elevation._haversine(start["lat"], start["lng"], end["lat"], end["lng"])
    if direct < MIN_DETOUR_LEG:
        return base

    # 어느 후보부터 Tmap에 물어볼지 — 표고가 '낮은' 순이 아니라 '중간값에 가까운' 순이다.
    # 최저점을 고르면 골짜기로 내려갔다 다시 올라오는 경로가 나와 오히려 나빠진다.
    # (실측: 출발177m·도착120m 구간에서 최저 경유점 131m를 고르자 177→133→196→136이 되어
    #  비용이 5706 → 6400으로 악화. 등고선을 따라가야 오르내림이 안 생긴다.)
    # 경유점이 중간 지점에 있으니 이상적인 표고는 출발·도착의 중간값이다.
    vias = _via_candidates(start, end, direct)
    ends = elevation.fetch([(start["lat"], start["lng"]), (end["lat"], end["lng"])])
    elevs = elevation.fetch([(v["lat"], v["lng"]) for v in vias])
    if elevs and ends:
        ideal = (ends[0] + ends[1]) / 2
        vias = [v for _, v in sorted(zip(elevs, vias), key=lambda x: abs(x[0] - ideal))]
    vias = vias[:VIA_TRIES]
    with ThreadPoolExecutor(max_workers=len(vias)) as ex:
        cands = list(ex.map(lambda v: _fetch_leg(start, end, v), vias))

    best, best_cost = base, elevation.cost(prof, base["distance"])
    for c in cands:
        if (c["fallback"] or not c["distance"]
                or c["distance"] > base["distance"] * DETOUR_MAX_RATIO
                or c["distance"] > base["distance"] + DETOUR_MAX_EXTRA):
            continue  # 거리 상한 탈락분엔 표고 API를 쓰지 않는다
        _score(c)
        # 최고 기울기가 나빠지면 탈락 — 급경사 '총량'이 줄어도 채택하지 않는다.
        # worst-element 원칙: 35% 구간은 10m라도 휠체어가 못 지나간다. 총량이 준 대가로
        # 더 가파른 봉우리를 새로 만드는 건 '경사 회피'가 아니라 거짓말이다.
        # (실측: 북촌 코스에서 급경사 457m→369m로 줄지만 최대 29.6%→34.9%로 악화되는
        #  후보가 비용 비교만으론 채택됐다.)
        if not c["slope"] or c["slope"]["maxGrade"] > prof["maxGrade"]:
            continue
        c_cost = elevation.cost(c["slope"], c["distance"])
        if c_cost < best_cost:
            best, best_cost = c, c_cost

    if best is base:
        return base
    extra = best["distance"] - base["distance"]
    best["detour"] = True
    best["baseline"] = {"distance": base["distance"], "difficulty": base["difficulty"],
                        "maxGrade": prof["maxGrade"], "steepDist": prof["steepDist"],
                        "polyline": base["polyline"]}  # 지도에 '원래 가려던 길'을 겹쳐 보여준다
    best["guides"] = [
        f"[경사 회피] 최대 경사 {prof['maxGrade']:.0f}% 구간을 피해 우회합니다 "
        f"(+{extra}m, 최대 {best['slope']['maxGrade']:.0f}%)" if best["slope"] else
        f"[경사 회피] 우회 경로입니다 (+{extra}m)"
    ] + best["guides"]
    return best


def _leg(start: dict, end: dict, avoid_slope: bool = False) -> dict:
    key = (round(start["lat"], 5), round(start["lng"], 5),
           round(end["lat"], 5), round(end["lng"], 5))
    if (key, avoid_slope) in _cache:
        return _cache[(key, avoid_slope)]

    base = _cache.get((key, False)) or _score(_fetch_leg(start, end))
    _cache[(key, False)] = base
    leg = _less_slope(start, end, base) if avoid_slope else base
    _cache[(key, avoid_slope)] = leg
    return leg


def route(waypoints: list[dict], avoid_slope: bool = False) -> dict:
    # 개별 외부 호출은 모두 타임아웃이 걸려 있어 응답 시간이 경계지어진다(Req 9.1):
    # Tmap 보행자 호출은 _fetch_leg에서 httpx timeout=5.0(opt 30→0)로 제한된다.
    legs = []
    for a, b in zip(waypoints, waypoints[1:]):
        leg = _leg(a, b, avoid_slope)
        if leg.get("fallback"):
            # 완전 실패 구간 — 캐시 원본을 오염시키지 않도록 복사 후 식별 메시지 추가
            leg = {**leg, "guides": list(leg.get("guides", [])),
                   "reasons": list(leg.get("reasons", []))}
            mark_unrouted(leg, a, b)
        legs.append(leg)

    # 전 구간 실패 + 데모 픽스처 존재 → 픽스처 반환 (발표장 네트워크 사망 대비)
    # fallback=True를 반드시 실어 보낸다. 픽스처는 요청한 waypoints와 아무 상관 없는
    # 광화문 데모 경로인데, 이걸 안 밝히면 FE가 사용자의 코스 이름표를 붙여 진짜 경로인 척
    # 보여준다. 게다가 픽스처엔 difficulty가 없어 스키마 기본값 '쉬움'이 찍힌다 —
    # 실제로 Tmap 쿼터가 소진되자 모르는 경로가 '쉬움'으로 표시됐다. 휠체어 앱에서 최악의 거짓말.
    if all(l["fallback"] for l in legs) and FIXTURE.exists():
        fx = json.loads(FIXTURE.read_text())
        return {**fx, "fallback": True, "avoidSlope": avoid_slope,
                "difficulty": fx.get("difficulty", "어려움"),
                "reasons": fx.get("reasons", ["경로를 확인할 수 없어 데모 경로를 표시합니다"]),
                "slope": None, "baseline": None}

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

    # 코스 전체 경사 — 최대 기울기는 최댓값, 나머지는 합산 (worst-element와 같은 결)
    profs = [l["slope"] for l in legs if l.get("slope")]
    slope = None
    if profs:
        slope = {"maxGrade": max(p["maxGrade"] for p in profs),
                 "ascent": sum(p["ascent"] for p in profs),
                 "descent": sum(p["descent"] for p in profs),
                 "steepDist": sum(p["steepDist"] for p in profs),
                 "moderateDist": sum(p["moderateDist"] for p in profs),
                 "covered": len(profs) == len(legs)}  # 일부 구간만 쟀는지 정직하게 표기
        if slope["steepDist"]:
            reasons.append(f"급경사(1/12 초과) {slope['steepDist']}m")
        if slope["ascent"] >= 10:
            reasons.append(f"누적 오르막 {slope['ascent']}m")

    if total > COURSE_HARD_TOTAL:
        worst = "어려움"
        reasons.append(f"총 도보 {total}m — 반나절 권장(4km) 초과")
    else:
        reasons.append(f"총 도보 {total}m")
    if agg["crosswalk"]:
        reasons.append(f"횡단보도 {agg['crosswalk']}회")

    # 회피 전/후 비교 — 우회가 거리를 늘려 오히려 손해인 경우도 그대로 보여준다.
    # "돌아간 만큼 좋아졌다"고 단정하지 않는 게 이 화면의 유일한 존재 이유다.
    baseline = None
    if avoid_slope and any(l.get("detour") for l in legs):
        b_dist = sum(l.get("baseline", l)["distance"] for l in legs)
        b_worst = max((l.get("baseline", l)["difficulty"] for l in legs),
                      key=_RANK.get, default="쉬움")
        b_grades = [l["baseline"]["maxGrade"] if l.get("baseline")
                    else (l["slope"] or {}).get("maxGrade", 0) for l in legs]
        if b_dist > COURSE_HARD_TOTAL:
            b_worst = "어려움"
        # 우회 안 한 구간은 자기 값이 곧 회피 전 값 — 빼먹으면 회피 전을 과소평가해
        # "덕분에 급경사가 이만큼 줄었다"고 부풀리게 된다.
        baseline = {"totalDistance": b_dist, "difficulty": b_worst,
                    "maxGrade": max(b_grades, default=0.0),
                    "steepDist": sum(l["baseline"]["steepDist"] if l.get("baseline")
                                     else (l["slope"] or {}).get("steepDist", 0)
                                     for l in legs),
                    "detourLegs": sum(1 for l in legs if l.get("detour"))}

    return {"legs": legs,
            "totalDistance": total,
            "totalDuration": sum(l["duration"] for l in legs),
            "difficulty": worst, "reasons": reasons,
            "avoidSlope": avoid_slope, "slope": slope, "baseline": baseline}
