from fastapi import APIRouter, HTTPException

from ..schemas import (
    PlaceDetail,
    PlaceOut,
    RestroomCoverageItem,
    RestroomCoverageOut,
    RestroomCoverageRequest,
    RestroomInfo,
)
from ..services import restroom, store

router = APIRouter(prefix="/api", tags=["places"])


@router.get("/places", response_model=list[PlaceOut])
def list_places(minLat: float, maxLat: float, minLng: float, maxLng: float,
                type: int | None = None):
    return store.query(minLat, maxLat, minLng, maxLng, type_=type)


@router.get("/places/{content_id}", response_model=PlaceDetail)
def place_detail(content_id: str):
    place = store.get(content_id)
    if place is None:
        raise HTTPException(404, "장소를 찾을 수 없습니다")
    return place


@router.post("/restrooms/coverage", response_model=RestroomCoverageOut)
def restroom_coverage(req: RestroomCoverageRequest):
    """코스 장소별 500m 이내 최근접 접근 화장실 커버리지 (Req 7.1, 7.4~7.6)."""
    course_places = [p.model_dump() for p in req.places]
    all_places = list(store.PLACES.values())
    results = restroom.coverage_for_course(course_places, all_places)
    items = [
        RestroomCoverageItem(
            contentId=r["contentId"],
            restroom=RestroomInfo(**r["restroom"]) if r["restroom"] else None,
        )
        for r in results
    ]
    return RestroomCoverageOut(items=items)
