"""Open-Meteo Elevation — 경로 표고 프로파일과 경사 산정.

데이터 한계 (구현 전 반드시 읽을 것):
Open-Meteo는 Copernicus DEM GLO-90을 쓴다. 수평 해상도 약 90m, 표고는 1m 단위 정수.
여기서 나오는 경사는 전부 **90m 구간 평균 지형 경사**다.
  - 잡는 것  : 언덕·고갯길처럼 지형 자체가 기울어진 구간
  - 못 잡는 것: 연석 턱, 짧은 진입 경사로, 건물 앞 단차 — 90m 평균에 묻힌다
그래서 표고 경사는 turnType 128(경사로 안내)을 **대체하지 않고 보완한다.** 둘 다 본다.

SAMPLE_STEP을 90m 아래로 내리면 안 된다. 실측(남산 오르막, 8개 표본):
    10m 간격 → 표고 전부 247m 동일, 경사 0%    ← 오르막이 평지로 둔갑 (같은 격자 재독)
    30m 간격 → 0%, 0%, 76.7%, 0%, -83.3% ...  ← 격자 경계에서만 튀는 가짜 절벽
    90m 간격 → 25.6%, -27.8%, -38.9% ...      ← 지형을 실제로 반영
Tmap 폴리라인 꼭짓점은 10~20m 간격이라 꼭짓점마다 표고를 찍으면 위의 거짓값을 얻는다.
반드시 재표본(_resample)을 거친다.

조회 실패 시엔 None을 돌려 경사를 난이도 판정에서 **빼버린다**. "정보 없음"을 "어려움"으로
올리면 Open-Meteo가 죽는 순간 전 경로가 어려움이 되어 앱이 못 쓰게 된다 (ARCHITECTURE §8).
계단·육교처럼 "존재는 확인됐지만 정도를 모르는 것"만 위험한 쪽으로 판정한다.
"""
import math

import httpx

URL = "https://api.open-meteo.com/v1/elevation"
SAMPLE_STEP = 90    # m — DEM 해상도. 위 실측 근거로 이 아래로 내리지 않는다.
MAX_COORDS = 100    # Open-Meteo 1회 요청 좌표 상한 (101개부터 400 에러)

# 경사 임계 — 국내 기준을 그대로 쓴다
GRADE_MODERATE = 5.0   # % 보도 종단경사 권장 상한 (도로의 구조·시설 기준에 관한 규칙)
GRADE_STEEP = 8.33     # % 1/12 — 장애인등편의법 경사로 최대 기울기. 초과 시 휠체어 자력 주행 한계

_cache: dict[tuple, float] = {}


def _haversine(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    p = math.pi / 180
    a = (math.sin((lat2 - lat1) * p / 2) ** 2
         + math.cos(lat1 * p) * math.cos(lat2 * p) * math.sin((lng2 - lng1) * p / 2) ** 2)
    return 2 * 6371000 * math.asin(math.sqrt(a))


def length(polyline: list[list[float]]) -> float:
    return sum(_haversine(a[0], a[1], b[0], b[1]) for a, b in zip(polyline, polyline[1:]))


def _resample(polyline: list[list[float]], step: float) -> list[tuple[float, float, float]]:
    """폴리라인 위를 step(m) 간격으로 걸으며 표본점 생성 → [(lat, lng, 누적거리m)]."""
    pts = [(polyline[0][0], polyline[0][1], 0.0)]
    cum, nxt = 0.0, step
    for (lat1, lng1), (lat2, lng2) in zip(polyline, polyline[1:]):
        seg = _haversine(lat1, lng1, lat2, lng2)
        if seg <= 0:
            continue
        while nxt <= cum + seg:
            t = (nxt - cum) / seg
            pts.append((lat1 + (lat2 - lat1) * t, lng1 + (lng2 - lng1) * t, nxt))
            nxt += step
        cum += seg
    if cum - pts[-1][2] > step * 0.3:  # 끝자락이 충분히 길면 도착점도 표본에
        pts.append((polyline[-1][0], polyline[-1][1], cum))
    return pts


def fetch(coords: list[tuple[float, float]]) -> list[float] | None:
    """표고 조회 — 캐시 우선, 미조회분만 100개씩 배치. 하나라도 실패하면 None.

    캐시 키는 소수 4자리(약 11m). DEM 격자가 90m라 그 이하 차이는 어차피 같은 값이다.
    """
    keys = [(round(lat, 4), round(lng, 4)) for lat, lng in coords]
    miss = [k for k in dict.fromkeys(keys) if k not in _cache]
    for i in range(0, len(miss), MAX_COORDS):
        chunk = miss[i:i + MAX_COORDS]
        try:
            r = httpx.get(URL, params={
                "latitude": ",".join(str(k[0]) for k in chunk),
                "longitude": ",".join(str(k[1]) for k in chunk),
            }, timeout=5.0)
            vals = r.json().get("elevation") if r.status_code == 200 else None
            if not vals or len(vals) != len(chunk) or any(v is None for v in vals):
                return None
            _cache.update(zip(chunk, vals))
        except Exception:
            return None
    return [_cache[k] for k in keys]


def profile(polyline: list[list[float]]) -> dict | None:
    """경로의 표고 프로파일 → 경사 지표. 조회 실패·구간 과단(<90m) 시 None.

    오르막/내리막을 절댓값으로 함께 본다. 휠체어에겐 8% 내리막도 제동 부담이라 위험하다.
    """
    if not polyline or len(polyline) < 2:
        return None
    total = length(polyline)
    if total < SAMPLE_STEP:
        return None  # DEM 격자 하나 안 — 경사를 말할 근거가 없다
    step = max(SAMPLE_STEP, total / (MAX_COORDS - 1))  # 긴 경로는 간격을 넓혀 100좌표 안에
    pts = _resample(polyline, step)
    elevs = fetch([(p[0], p[1]) for p in pts])
    if not elevs:
        return None

    ascent = descent = steep = moderate = 0.0
    max_grade = 0.0
    for (_, _, d1), (_, _, d2), e1, e2 in zip(pts, pts[1:], elevs, elevs[1:]):
        run = d2 - d1
        if run < 1:
            continue
        rise = e2 - e1
        grade = abs(rise) / run * 100
        ascent += max(rise, 0)
        descent += max(-rise, 0)
        if grade >= GRADE_STEEP:
            steep += run
        elif grade >= GRADE_MODERATE:
            moderate += run
        max_grade = max(max_grade, grade)

    return {"maxGrade": round(max_grade, 1), "ascent": round(ascent), "descent": round(descent),
            "steepDist": round(steep), "moderateDist": round(moderate),
            "sampleStep": round(step),
            "samples": [[round(d), e] for (_, _, d), e in zip(pts, elevs)]}


def cost(prof: dict | None, distance: int) -> float:
    """경사 회피 후보 비교용 비용(가상 거리 m). 낮을수록 좋다.

    급경사 1m = 평지 7m, 완경사 1m = 평지 3m, 누적 상승 1m = 평지 10m,
    최대 기울기 1% = 평지 15m로 환산했다. 즉 "급경사 100m를 없앨 수 있으면 평지 600m까지
    더 걸어도 이득" — 사용자가 원한 '좀 더 돌아가더라도 경사가 덜한 경로'를 수치로 옮긴 것이다.

    maxGrade가 비용에 들어가는 이유: 총량(steepDist)만 보면 '짧지만 더 가파른' 경로가
    이길 수 있는데, 휠체어에겐 35% 구간은 10m라도 통과 불가다. 프로젝트 제1원칙인
    worst-element와 맞추려면 최고점도 값을 매겨야 한다. 여기에 더해 tmap._less_slope가
    '최대 기울기 악화'를 아예 채택 금지로 막는다(비용만으론 상쇄될 수 있어서).
    실제 채택은 거리 상한(tmap.DETOUR_*)도 반드시 통과해야 한다.
    """
    if not prof:
        return float(distance)  # 경사를 모르면 거리로만 비교 (모름을 이득으로 치지 않는다)
    return (distance + prof["steepDist"] * 6 + prof["moderateDist"] * 2
            + prof["ascent"] * 10 + prof["maxGrade"] * 15)
