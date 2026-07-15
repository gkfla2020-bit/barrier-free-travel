"""Task 1 — 버그 조건 탐색 테스트 (transit-polyline-real-path).

버그: 대중교통 구간 polyline이 정류장 좌표 직선으로만 구성되고(도로 무시),
개략 직선임을 알리는 approx 플래그/stationCoords/안내가 없다.

이 테스트는 '수정 후 기대 동작'을 인코딩한다.
- 수정 전(현재) 코드에서는 FAIL 해야 정상 (버그 존재 확인).
- 수정 후에는 PASS 한다 (Task 5.1에서 재실행).
"""
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.services import transit


# ODsay searchPubTransPathT 응답 형태를 축약한 픽스처: 버스 구간(정류장 3개, 굽은 도로).
def _bus_path_fixture():
    return {
        "info": {"mapObj": "1050:1:55:63"},
        "subPath": [
            {
                "trafficType": 2,  # 버스
                "distance": 2000,
                "sectionTime": 12,
                "stationCount": 3,
                "startName": "A정류장", "endName": "C정류장",
                "startX": 126.9769, "startY": 37.5717,
                "endX": 126.9882, "endY": 37.5512,
                "lane": [{"busNo": "402"}],
                "passStopList": {"stations": [
                    {"stationName": "A정류장", "x": "126.9769", "y": "37.5717"},
                    {"stationName": "B정류장", "x": "126.9820", "y": "37.5610"},
                    {"stationName": "C정류장", "x": "126.9882", "y": "37.5512"},
                ]},
            },
        ],
    }


def test_transit_segment_not_naive_straight_line(monkeypatch):
    """대중교통 구간은 실제 도로 형상(approx=False, 점수>=정류장수) 또는
    명시적 개략 폴백(approx=True + stationCoords + 안내)이어야 한다."""
    monkeypatch.setattr(transit, "_odsay", lambda a, b: _bus_path_fixture())
    # loadLane 실제 형상이 없다고 가정할 때조차, 최소한 approx 표시가 있어야 한다.

    start = {"lat": 37.5717, "lng": 126.9769, "name": "출발"}
    end = {"lat": 37.5512, "lng": 126.9882, "name": "도착"}
    leg = transit._leg(start, end)

    bus_segs = [s for s in leg["segments"] if s.get("mode") == "bus"]
    assert bus_segs, "버스 구간이 있어야 한다"

    for seg in bus_segs:
        n_stops = len(seg.get("stations", []))
        poly = seg.get("polyline", [])
        real_geometry = (not seg.get("approx", False)) and len(poly) >= n_stops and len(poly) > n_stops
        explicit_approx = (
            seg.get("approx", False) is True
            and len(seg.get("stationCoords", [])) > 0
        )
        # 안내(개략 직선) 문구 존재 여부
        notice = any("개략" in g for g in leg.get("guides", [])) or \
                 any("개략" in r for r in leg.get("reasons", []))

        assert real_geometry or (explicit_approx and notice), (
            f"대중교통 구간이 정류장 직선(점 {len(poly)}개=정류장 {n_stops}개)으로만 그려지고 "
            f"approx 표시가 없음. approx={seg.get('approx')}, "
            f"stationCoords={len(seg.get('stationCoords', []))}, notice={notice}"
        )
