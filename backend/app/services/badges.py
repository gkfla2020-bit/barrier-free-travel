"""detailWithTour2 서술형 필드 → 배지 4종 판정 + 국문 라벨 원문 추출.

보수적 판정: 부정 키워드가 하나라도 있으면 무조건 탈락, 빈 값은 배지 없음.
(잘못된 "접근 가능" 표시가 치명적인 도메인 — 애매하면 배지를 안 다는 쪽으로만 틀린다)
"""

# 배지 소스는 4종 계약 고정 (exit/route 등은 원문 노출만)
FIELD_TO_BADGE = {
    "wheelchair": "wheelchair",
    "elevator": "elevator",
    "restroom": "toilet",
    "parking": "parking",
}

POSITIVE = ["있음", "가능", "대여", "설치", "완비", "운영"]
NEGATIVE = ["없음", "불가", "어려움", "곤란", "미설치"]

# detailWithTour2 전체 필드의 국문 라벨 (활용매뉴얼 v4.3 기준)
KOREAN_LABELS = {
    "parking": "장애인 주차",
    "route": "접근로",
    "publictransport": "대중교통",
    "ticketoffice": "매표소",
    "promotion": "홍보물",
    "wheelchair": "휠체어",
    "exit": "출입통로",
    "elevator": "엘리베이터",
    "restroom": "화장실",
    "auditorium": "관람석",
    "room": "객실",
    "handicapetc": "지체장애 기타",
    "braileblock": "점자블록",
    "helpdog": "보조견 동반",
    "guidehuman": "안내요원",
    "audioguide": "오디오가이드",
    "bigprint": "큰활자 홍보물",
    "brailepromotion": "점자 홍보물",
    "guidesystem": "유도안내설비",
    "blindhandicapetc": "시각장애 기타",
    "signguide": "수화안내",
    "videoguide": "자막 영상안내",
    "hearingroom": "청각장애 객실",
    "hearinghandicapetc": "청각장애 기타",
    "stroller": "유모차",
    "lactationroom": "수유실",
    "babysparechair": "유아 보조의자",
    "infantsfamilyetc": "영유아가족 기타",
}


def parse_badges(withtour: dict) -> list[str]:
    badges = []
    for field, badge in FIELD_TO_BADGE.items():
        value = str(withtour.get(field) or "").strip()
        if not value:
            continue
        if any(neg in value for neg in NEGATIVE):
            continue
        if any(pos in value for pos in POSITIVE):
            badges.append(badge)
    return badges


def raw_korean(withtour: dict) -> dict:
    """값이 있는 필드만 국문 라벨 키로 반환 (FE가 그대로 렌더)."""
    out = {}
    for field, label in KOREAN_LABELS.items():
        value = str(withtour.get(field) or "").strip()
        if value:
            out[label] = value
    return out
