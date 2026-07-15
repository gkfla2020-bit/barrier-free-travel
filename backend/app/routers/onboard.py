"""출발지 우선 온보딩 — 첫 질문의 자유 텍스트에서 출발지를 잡아 프리셋 코스를 돌려준다."""
from fastapi import APIRouter

from ..schemas import CourseItem, DepartureOut, OnboardOut, OnboardRequest
from ..services import matcher, presets

router = APIRouter(prefix="/api", tags=["onboard"])


@router.post("/onboard", response_model=OnboardOut)
def post_onboard(req: OnboardRequest) -> OnboardOut:
    dep, region = matcher.match(req.text)

    # 1) 출발지까지 매칭 — 프리셋 코스 구성
    if dep:
        rname = matcher.region_name(region)
        course = presets.preset_course(dep)
        if course:
            reply = (f"{dep['name']}에서 출발하는 {rname} 무장애 코스를 준비했어요. "
                     f"휠체어 접근 정보가 확인된 곳 위주로 도보권({presets.MAX_LEG_KM}km 이내)만 골랐습니다.")
        else:
            reply = (f"{dep['name']} 출발로 잡았어요. 다만 도보권에서 접근성 확인 장소를 "
                     "충분히 찾지 못해 코스는 채우지 못했어요. 다른 출발지도 시도해 보세요.")
        return OnboardOut(
            reply=reply,
            matched=True,
            departure=DepartureOut(id=dep["id"], name=dep["name"], lat=dep["lat"],
                                   lng=dep["lng"], region=dep["region"]),
            region=region or "",
            course=[CourseItem(**c) for c in course],
        )

    # 2) 지역만 매칭 — 그 지역 출발지 예시 안내 (departure/course는 비움)
    if region:
        rname = matcher.region_name(region)
        examples = "·".join(d["name"] for d in matcher.region_departures(region)[:3])
        return OnboardOut(
            reply=f"{rname} 여행이시군요! 출발지를 정해주시면 코스를 짜드릴게요. 예) {examples}",
            matched=True,
            region=region,
        )

    # 3) 매칭 실패
    return OnboardOut(reply="출발지를 못 알아들었어요. 예) 광화문, 해운대역, 팔달문", matched=False)
