from fastapi import APIRouter, HTTPException

from ..schemas import PlaceDetail, PlaceOut
from ..services import store

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
