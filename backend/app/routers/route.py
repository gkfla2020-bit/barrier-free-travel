from fastapi import APIRouter, HTTPException

from ..schemas import RouteOut, RouteRequest
from ..services import tmap, transit

router = APIRouter(prefix="/api", tags=["route"])


@router.post("/route", response_model=RouteOut)
def get_route(req: RouteRequest):
    waypoints = [w.model_dump() for w in req.waypoints]
    if req.mode == "transit":
        # Req 3.8: 대중교통 경로는 선택된 출발지 + 최소 1개 코스 장소가 필요하다.
        # waypoints[0] = 출발지, waypoints[1:] = 코스 장소.
        # 출발지가 없거나 코스 장소가 0개(waypoints 2개 미만)이면 요청을 거부하고
        # segment 목록을 반환하지 않는다.
        if len(waypoints) < 2:
            raise HTTPException(
                status_code=400,
                detail=(
                    "대중교통 경로에는 출발지와 최소 1개의 코스 장소가 필요합니다. "
                    "출발지를 선택하고 코스에 장소를 1개 이상 추가해주세요."
                ),
            )
        return transit.route(waypoints)
    return tmap.route(waypoints)
