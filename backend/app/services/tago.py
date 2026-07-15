"""TAGO(국토교통부) 버스 실시간 정보 — 다음 버스의 저상버스 여부.

ODsay 정류장과 TAGO 정류소는 ID 체계가 달라 좌표 근접 검색으로 매칭한다.
1) getCrdntPrxmtSttnList  : 승차 정류장 좌표 → (cityCode, nodeId) 매칭
2) getSttnAcctoArvlPrearngeInfoList : 도착 예정 버스의 vehicletp(저상버스/일반차량)

원칙: 실시간 부가정보일 뿐이므로 어떤 실패(미신청 403, 타임아웃, 매칭 실패)도
경로 응답을 막지 않는다 — (None, "")로 조용히 빠진다.
* 두 오퍼레이션은 data.go.kr에서 각각 활용신청 필요(자동승인):
  버스정류소정보(15098534), 버스도착정보(15098530)
"""
import os
import re
import time

import httpx

BASE = "http://apis.data.go.kr/1613000"
ARRIVAL_TTL = 30.0  # 도착정보 캐시(초) — 실시간성 유지하면서 중복 호출 방지

_stop_cache: dict[tuple, tuple | None] = {}   # 좌표 → (cityCode, nodeId) | None
_arrival_cache: dict[tuple, tuple[float, list]] = {}


def _rows(path: str, **params) -> list | None:
    """TAGO 공통 호출 — 실패는 None (items 없음은 빈 리스트).
    공공 API 특성상 간헐 지연·오류가 잦아 1회 재시도한다."""
    key = os.environ.get("TAGO_API_KEY", "")
    if not key:
        return None
    for attempt in range(2):
        try:
            r = httpx.get(f"{BASE}/{path}",
                          params={"serviceKey": key, "_type": "json",
                                  "numOfRows": 50, **params},
                          timeout=8.0)
            body = r.json()["response"]["body"]
            items = body.get("items") or {}
            rows = items.get("item") if isinstance(items, dict) else None
            if rows is None:
                return []
            return rows if isinstance(rows, list) else [rows]
        except Exception:
            if attempt == 0:
                time.sleep(0.4)
    return None


def _norm(s) -> str:
    return re.sub(r"[^0-9A-Za-z가-힣]", "", str(s)).upper()


def _find_stops(lat: float, lng: float, name: str = "") -> list[tuple]:
    """좌표 근접 정류소 후보 목록 → [(cityCode, nodeId), ...] 최대 4개.
    같은 이름 정류소가 방향·승강장별로 여러 개라(예: 해운대도시철도역 3개)
    하나만 고르면 도착정보가 비어있을 수 있다 — 후보를 모두 반환해 순회한다."""
    ck = (round(lat, 4), round(lng, 4))  # ~11m 격자
    if ck in _stop_cache:
        return _stop_cache[ck]
    rows = _rows("BusSttnInfoInqireService/getCrdntPrxmtSttnList",
                 gpsLati=lat, gpsLong=lng, numOfRows=10)
    result: list[tuple] = []
    if rows:
        target = _norm(name)

        def score(r):
            d = (float(r.get("gpslati", 0)) - lat) ** 2 + (float(r.get("gpslong", 0)) - lng) ** 2
            nm = _norm(r.get("nodenm", ""))
            similar = target and nm and (nm in target or target in nm)
            return (0 if similar else 1, d)  # 이름 유사 우선, 그다음 거리

        result = [(r["citycode"], r["nodeid"])
                  for r in sorted(rows, key=score)
                  if r.get("citycode") and r.get("nodeid")][:4]
    _stop_cache[ck] = result
    return result


def _arrivals(city, node) -> list:
    ck, now = (city, node), time.time()
    cached = _arrival_cache.get(ck)
    if cached and now - cached[0] < ARRIVAL_TTL:
        return cached[1]
    rows = _rows("ArvlInfoInqireService/getSttnAcctoArvlPrearngeInfoList",
                 cityCode=city, nodeId=node) or []
    _arrival_cache[ck] = (now, rows)
    return rows


def next_bus(lat: float, lng: float, bus_no: str, stop_name: str = "") -> tuple[bool | None, str]:
    """승차 정류장의 해당 노선 다음 버스 → (저상 여부, 안내문). 정보 없으면 (None, '').
    후보 정류소를 순회하며 해당 노선이 잡히는 곳을 찾는다."""
    tno = _norm(bus_no)
    if not tno:
        return None, ""
    matches: list = []
    for city, node in _find_stops(lat, lng, stop_name):
        rows = _arrivals(city, node)
        matches = [r for r in rows if _norm(r.get("routeno", "")) == tno] \
            or [r for r in rows if tno in _norm(r.get("routeno", ""))]
        if matches:
            break
    if not matches:
        return None, ""

    nxt = min(matches, key=lambda r: int(r.get("arrtime", 10 ** 9)))
    low = "저상" in str(nxt.get("vehicletp", ""))
    mins = max(1, int(nxt.get("arrtime", 0)) // 60)
    if low:
        note = f"다음 {nxt.get('routeno')}번은 저상버스입니다 · 약 {mins}분 후 도착"
    else:
        note = f"다음 {nxt.get('routeno')}번은 일반차량(저상 아님) · 약 {mins}분 후 — 다음 차를 기다리는 것을 권합니다"
    return low, note
