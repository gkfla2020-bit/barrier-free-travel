from fastapi import APIRouter

from ..schemas import RouteOut, RouteRequest
from ..services import tmap

router = APIRouter(prefix="/api", tags=["route"])


@router.post("/route", response_model=RouteOut)
def get_route(req: RouteRequest):
    return tmap.route([w.model_dump() for w in req.waypoints], req.avoidSlope)
