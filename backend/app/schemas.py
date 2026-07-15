"""API 계약 Pydantic 모델 — T+0 확정, 이후 변경 금지."""
from pydantic import BaseModel, Field


class PlaceOut(BaseModel):
    contentId: str
    title: str
    lat: float
    lng: float
    type: int
    badges: list[str]


class PlaceDetail(BaseModel):
    contentId: str
    title: str
    addr: str = ""
    image: str = ""
    overview: str = ""
    tel: str = ""
    type: int
    lat: float
    lng: float
    badges: list[str]
    accessibilityRaw: dict[str, str]


class Waypoint(BaseModel):
    lat: float
    lng: float
    name: str = ""


class RouteRequest(BaseModel):
    waypoints: list[Waypoint] = Field(min_length=2)


class RouteLeg(BaseModel):
    polyline: list[list[float]]  # [[lat, lng], ...]
    distance: int  # m
    duration: int  # 초
    guides: list[str]
    stairsPossible: bool = False
    fallback: bool = False
    difficulty: str = "쉬움"  # 쉬움 | 중간 | 어려움 (worst-element 방식)
    reasons: list[str] = []


class RouteOut(BaseModel):
    legs: list[RouteLeg]
    totalDistance: int
    totalDuration: int
    difficulty: str = "쉬움"
    reasons: list[str] = []


class ChatRequest(BaseModel):
    message: str
    region: str = "seoul"
    history: list[dict] | None = None


class CourseItem(BaseModel):
    contentId: str
    order: int
    reason: str


class ChatOut(BaseModel):
    reply: str
    course: list[CourseItem] = []
