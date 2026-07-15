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
    mode: str = "walk"  # walk | transit


class TransitSegment(BaseModel):
    mode: str  # walk | bus | subway
    name: str = ""  # 노선명 (예: 수도권 3호선, 272번 버스)
    polyline: list[list[float]]
    distance: int = 0  # m
    duration: int = 0  # 초
    stations: list[str] = []
    color: str = ""  # 지하철 노선색 / 버스 녹색 (지도 렌더용)
    lowFloor: bool | None = None  # 다음 버스 저상 여부 (None = 실시간 정보 없음)
    lowFloorNote: str = ""


class RouteLeg(BaseModel):
    polyline: list[list[float]]  # [[lat, lng], ...]
    distance: int  # m — 대중교통 leg에서는 '도보' 거리만 (이동약자 핵심 지표)
    duration: int  # 초 — 탑승 시간 포함 전체
    guides: list[str]
    stairsPossible: bool = False
    fallback: bool = False
    difficulty: str = "쉬움"  # 쉬움 | 중간 | 어려움 (worst-element 방식)
    reasons: list[str] = []
    mode: str = "walk"  # walk | transit
    segments: list[TransitSegment] = []  # transit leg의 구간 분해


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
