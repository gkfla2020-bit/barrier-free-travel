from fastapi import APIRouter

from ..schemas import RouteOut, RouteRequest
from ..services import tmap, transit

router = APIRouter(prefix="/api", tags=["route"])


@router.post("/route", response_model=RouteOut)
def get_route(req: RouteRequest):
    waypoints = [w.model_dump() for w in req.waypoints]
    if req.mode == "transit":
        return transit.route(waypoints)
    return tmap.route(waypoints)
