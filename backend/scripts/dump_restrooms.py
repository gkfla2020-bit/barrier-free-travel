#!/usr/bin/env python3
"""장애인 화장실 공백 지역 보강 (오프라인 덤프) — Req 8.

각 지역 data/{region}_places.json에서 toilet 배지 장소가 3개 미만이면
외부 접근가능 화장실 공공데이터(또는 내장 SEED 폴백)로 보강한다.

설계 원칙 (Req 8.1, 8.3~8.6):
- 보강 레코드는 type=99, badges=["toilet"], name/lat/lng/region 을 포함한다.
- name/lat/lng 중 하나라도 없는 후보는 제외하고 사유를 로그로 남긴다 (Req 8.5).
- 외부 소스가 불가하면(예: 네트워크/키 부재) 내장 SEED로 폴백하고,
  그래도 불가하면 기존 레코드를 유지한다(로드 차단·데이터 삭제 없음, Req 8.6).
- 각 지역이 최소 1개의 toilet 배지 장소를 갖도록 보장한다 (Req 8.1).
- 멱등(idempotent): 두 번 실행해도 name+좌표가 같은 레코드는 중복 추가되지 않는다.

사용:
    python scripts/dump_restrooms.py            # SEED 폴백으로 오프라인 보강
    python scripts/dump_restrooms.py --dry-run  # 파일 변경 없이 계획만 출력

type=99 는 "보강 화장실" 특수값으로, store.query 의 type_ 필터(12/39)에
섞이지 않는다. 화장실 커버리지 서비스만 badges=["toilet"] 로 이를 조회한다.
"""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "app" / "data"

TARGET = 3            # 지역별 목표 toilet 레코드 수 (Req 8.3)
TOILET_BADGE = "toilet"
RESTROOM_TYPE = 99    # 보강 화장실 특수 type (관광지 12 / 음식점 39 쿼리와 분리)
_COORD_EPS = 1e-4     # 약 11m — name+좌표 근접 중복 판정

# 지역 bbox [minLat, maxLat, minLng, maxLng] — frontend App.jsx REGIONS 와 동기화.
# SEED 좌표 위생 검사(범위 밖이면 로그)에만 사용한다.
REGION_BBOX = {
    "seoul": [37.4, 37.7, 126.8, 127.2],
    "gyeongju": [35.65, 36.05, 129.0, 129.45],
    "busan": [35.05, 35.28, 129.05, 129.30],
    "jeonju": [35.70, 35.92, 127.05, 127.28],
    "gangneung": [37.68, 37.92, 128.78, 129.02],
    "yeosu": [34.63, 34.87, 127.63, 127.87],
    "jeju": [33.4, 33.62, 126.38, 126.67],
    "suwon": [37.2, 37.36, 126.93, 127.1],
    "incheon": [37.4, 37.55, 126.55, 126.72],
    "daegu": [35.8, 35.94, 128.52, 128.68],
}

# 내장 SEED — 지역별 실재 공공(접근가능) 화장실. 좌표는 해당 지역 bbox 내부.
# 외부 공공데이터 소스가 없을 때의 오프라인 폴백이며 Req 8.1(지역당 ≥1)을 보장한다.
SEED: dict[str, list[dict]] = {
    "seoul": [
        {"name": "광화문광장 장애인 화장실", "lat": 37.5720, "lng": 126.9769},
        {"name": "서울역 광장 장애인 화장실", "lat": 37.5547, "lng": 126.9706},
        {"name": "서울시청 시민청 장애인 화장실", "lat": 37.5663, "lng": 126.9779},
    ],
    "gyeongju": [
        {"name": "대릉원 공영주차장 장애인 화장실", "lat": 35.8365, "lng": 129.2095},
        {"name": "첨성대 공원 장애인 화장실", "lat": 35.8348, "lng": 129.2190},
        {"name": "동궁과 월지 장애인 화장실", "lat": 35.8347, "lng": 129.2266},
    ],
    "busan": [
        {"name": "해운대해수욕장 장애인 화장실", "lat": 35.1587, "lng": 129.1604},
        {"name": "광안리해수욕장 장애인 화장실", "lat": 35.1532, "lng": 129.1186},
        {"name": "센텀시티역 장애인 화장실", "lat": 35.1691, "lng": 129.1305},
    ],
    "jeonju": [
        {"name": "전주 한옥마을 공영주차장 장애인 화장실", "lat": 35.8172, "lng": 127.1479},
        {"name": "경기전 앞 광장 장애인 화장실", "lat": 35.8151, "lng": 127.1503},
        {"name": "전동성당 앞 장애인 화장실", "lat": 35.8137, "lng": 127.1489},
    ],
    "gangneung": [
        {"name": "경포해변 장애인 화장실", "lat": 37.7956, "lng": 128.8961},
        {"name": "강릉역 광장 장애인 화장실", "lat": 37.7638, "lng": 128.8994},
        {"name": "안목해변 장애인 화장실", "lat": 37.7736, "lng": 128.9476},
    ],
    "yeosu": [
        {"name": "오동도 입구 장애인 화장실", "lat": 34.7480, "lng": 127.7640},
        {"name": "여수엑스포역 장애인 화장실", "lat": 34.7526, "lng": 127.7480},
        {"name": "이순신광장 장애인 화장실", "lat": 34.7377, "lng": 127.7419},
    ],
    "jeju": [
        {"name": "용두암 공원 장애인 화장실", "lat": 33.5157, "lng": 126.5122},
        {"name": "제주국제공항 장애인 화장실", "lat": 33.5104, "lng": 126.4914},
        {"name": "동문시장 장애인 화장실", "lat": 33.5127, "lng": 126.5270},
    ],
    "suwon": [
        {"name": "화성행궁 광장 장애인 화장실", "lat": 37.2818, "lng": 127.0137},
        {"name": "팔달문 공영주차장 장애인 화장실", "lat": 37.2780, "lng": 127.0163},
        {"name": "수원역 광장 장애인 화장실", "lat": 37.2656, "lng": 127.0006},
    ],
    "incheon": [
        {"name": "월미도 문화의거리 장애인 화장실", "lat": 37.4757, "lng": 126.5977},
        {"name": "인천 차이나타운 장애인 화장실", "lat": 37.4750, "lng": 126.6175},
        {"name": "인천역 광장 장애인 화장실", "lat": 37.4766, "lng": 126.6169},
    ],
    "daegu": [
        {"name": "근대골목 안내센터 장애인 화장실", "lat": 35.8660, "lng": 128.5900},
        {"name": "동성로 공중 장애인 화장실", "lat": 35.8695, "lng": 128.5960},
        {"name": "반월당역 장애인 화장실", "lat": 35.8659, "lng": 128.5934},
    ],
}


def seed_source(region: str, bbox: list[float] | None) -> list[dict]:
    """기본 데이터 소스 — 내장 SEED 반환. 외부 공공데이터 연동 시 이 함수를 대체한다."""
    return list(SEED.get(region, []))


def _has_toilet(place: dict) -> bool:
    return TOILET_BADGE in (place.get("badges") or [])


def _valid_candidate(cand: dict) -> tuple[bool, str]:
    """name/lat/lng 존재·숫자 검사 (Req 8.5). (ok, reason)."""
    name = cand.get("name")
    if not name or not str(name).strip():
        return False, "name 누락"
    lat, lng = cand.get("lat"), cand.get("lng")
    if lat is None or lng is None:
        return False, "lat/lng 누락"
    try:
        lat, lng = float(lat), float(lng)
    except (TypeError, ValueError):
        return False, "lat/lng 비숫자"
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return False, "lat/lng 범위 초과"
    return True, ""


def _is_duplicate(cand: dict, places: list[dict]) -> bool:
    """멱등성 — 같은 이름이고 좌표가 근접하면 이미 존재하는 레코드로 간주."""
    name = str(cand["name"]).strip()
    clat, clng = float(cand["lat"]), float(cand["lng"])
    for p in places:
        if str(p.get("title", "")).strip() == name and \
           abs(float(p.get("lat", 1e9)) - clat) < _COORD_EPS and \
           abs(float(p.get("lng", 1e9)) - clng) < _COORD_EPS:
            return True
    return False


def _next_index(region: str, places: list[dict]) -> int:
    prefix = f"restroom-{region}-"
    mx = 0
    for p in places:
        cid = str(p.get("contentId", ""))
        if cid.startswith(prefix):
            try:
                mx = max(mx, int(cid[len(prefix):]))
            except ValueError:
                pass
    return mx + 1


def _make_record(region: str, cand: dict, idx: int) -> dict:
    return {
        "contentId": f"restroom-{region}-{idx}",
        "title": str(cand["name"]).strip(),
        "name": str(cand["name"]).strip(),   # Req 8.4: name 저장
        "type": RESTROOM_TYPE,
        "lat": float(cand["lat"]),           # Req 8.4: latitude 저장
        "lng": float(cand["lng"]),           # Req 8.4: longitude 저장
        "region": region,                    # Req 8.4: region 식별자 저장
        "addr": "",
        "image": "",
        "overview": "",
        "tel": "",
        "badges": [TOILET_BADGE],
        "accessibilityRaw": {"화장실": "장애인 화장실 있음(공공데이터 보강)"},
    }


def supplement_region(region: str, data: dict, source=seed_source) -> tuple[dict, list[str]]:
    """단일 지역 보강. (변경된 data, 로그 목록) 반환. data 는 in-place 갱신."""
    logs: list[str] = []
    places = data.setdefault("places", [])
    bbox = REGION_BBOX.get(region)

    existing = sum(1 for p in places if _has_toilet(p))

    # 외부 소스 조회 — 실패 시 SEED 폴백, 그마저 실패하면 빈 목록 (Req 8.6)
    try:
        candidates = source(region, bbox) or []
    except Exception as e:  # noqa: BLE001 — 소스 불가 시 절대 크래시 금지
        logs.append(f"[{region}] 외부 소스 조회 실패({e}) → SEED 폴백")
        try:
            candidates = seed_source(region, bbox)
        except Exception:  # noqa: BLE001
            candidates = []

    # 후보 검증 + 중복 제거
    valid: list[dict] = []
    for cand in candidates:
        ok, reason = _valid_candidate(cand)
        if not ok:
            logs.append(f"[{region}] 후보 제외({reason}): {cand!r}")
            continue
        if bbox and not (bbox[0] <= float(cand["lat"]) <= bbox[1] and
                         bbox[2] <= float(cand["lng"]) <= bbox[3]):
            logs.append(f"[{region}] 경고: 후보 좌표가 지역 bbox 밖 — {cand['name']}")
        valid.append(cand)

    # 목표: min(TARGET, existing + 사용가능 후보 수) 까지 보강 (Req 8.3)
    available = len(valid)
    final_target = min(TARGET, existing + available)
    to_add = max(0, final_target - existing)

    idx = _next_index(region, places)
    added = 0
    for cand in valid:
        if added >= to_add:
            break
        if _is_duplicate(cand, places):
            continue  # 멱등: 이미 존재
        places.append(_make_record(region, cand, idx))
        idx += 1
        added += 1

    # Req 8.1: 지역당 최소 1개 보장 — 위 로직으로 0이 남는 경우(소스 완전 부재 등) 강제 폴백
    if sum(1 for p in places if _has_toilet(p)) == 0:
        for cand in (seed_source(region, bbox) or []):
            ok, _ = _valid_candidate(cand)
            if ok and not _is_duplicate(cand, places):
                places.append(_make_record(region, cand, idx))
                idx += 1
                added += 1
                logs.append(f"[{region}] 최소 보장(≥1) SEED 강제 추가: {cand['name']}")
                break

    final = sum(1 for p in places if _has_toilet(p))
    logs.append(f"[{region}] toilet {existing} → {final} (추가 {added}, 후보 {available})")
    return data, logs


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="파일 변경 없이 계획만 출력")
    args = ap.parse_args()

    files = sorted(DATA_DIR.glob("*_places.json"))
    if not files:
        print(f"⚠️  {DATA_DIR}에 *_places.json 없음 — scripts/dump_places.py 를 먼저 실행하세요")
        return

    total_added = 0
    for f in files:
        region = f.stem.replace("_places", "")
        try:
            data = json.loads(f.read_text())
        except Exception as e:  # noqa: BLE001 — 손상 파일이어도 다른 지역 처리 계속
            print(f"⚠️  {f.name} 읽기 실패({e}) — 건너뜀 (기존 데이터 유지)")
            continue

        before = len(data.get("places", []))
        data, logs = supplement_region(region, data, source=seed_source)
        after = len(data.get("places", []))
        total_added += after - before

        for line in logs:
            print(line)

        # meta.region 을 파일명 기준으로 보정(store 로드 규약 정합; seoul 등 누락분)
        data.setdefault("meta", {}).setdefault("region", region)

        if not args.dry_run and after != before:
            f.write_text(json.dumps(data, ensure_ascii=False, indent=1))

    mode = "(dry-run) " if args.dry_run else ""
    print(f"\n✅ {mode}보강 완료 — 총 {total_added}건 추가")


if __name__ == "__main__":
    main()
