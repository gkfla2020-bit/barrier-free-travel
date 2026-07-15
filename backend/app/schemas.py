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
    avoidSlope: bool = False  # 켜면 더 돌더라도 경사가 완만한 경로를 찾는다


# Open-Meteo 표고 기반. 값은 전부 90m 평균 지형 경사 — 한계는 elevation.py 상단 참조.
class SlopeProfile(BaseModel):
    maxGrade: float       # % 최대 기울기 (오르막·내리막 절댓값)
    ascent: int           # m 누적 상승
    descent: int          # m 누적 하강
    steepDist: int        # m 기울기 8.33%(1/12) 이상 구간 길이
    moderateDist: int     # m 기울기 5~8.33% 구간 길이
    sampleStep: int       # m 표본 간격 (해상도 명시 — 이 값보다 짧은 경사는 못 본다)
    samples: list[list[float]] = []  # [[누적거리m, 표고m], ...] 고도 그래프용


class SlopeTotal(BaseModel):
    maxGrade: float
    ascent: int
    descent: int
    steepDist: int
    moderateDist: int
    covered: bool = True  # False = 일부 구간은 표고를 못 재 경사 집계에서 빠짐


class RouteBaseline(BaseModel):
    """avoidSlope 적용 전 코스 — 우회가 실제로 이득이었는지 사용자가 직접 보게 한다."""
    totalDistance: int
    difficulty: str
    maxGrade: float
    steepDist: int
    detourLegs: int  # 실제로 우회로 바뀐 구간 수


class LegBaseline(BaseModel):
    """우회로 교체된 구간의 원래 경로 — 지도에 회색 점선(고스트)으로 겹쳐 보여준다."""
    distance: int
    difficulty: str
    maxGrade: float
    steepDist: int
    polyline: list[list[float]] = []


class RouteLeg(BaseModel):
    polyline: list[list[float]]  # [[lat, lng], ...]
    distance: int  # m
    duration: int  # 초
    guides: list[str]
    stairsPossible: bool = False
    fallback: bool = False
    difficulty: str = "쉬움"  # 쉬움 | 중간 | 어려움 (worst-element 방식)
    reasons: list[str] = []
    slope: SlopeProfile | None = None  # null = 표고 조회 실패 또는 90m 미만 구간
    detour: bool = False               # 경사 회피로 교체된 구간
    baseline: LegBaseline | None = None  # detour=true일 때만


class RouteOut(BaseModel):
    legs: list[RouteLeg]
    totalDistance: int
    totalDuration: int
    difficulty: str = "쉬움"
    reasons: list[str] = []
    avoidSlope: bool = False
    slope: SlopeTotal | None = None
    baseline: RouteBaseline | None = None
    fallback: bool = False  # True = 요청 경로가 아니라 데모 픽스처(광화문 경로) 응답


class ChatRequest(BaseModel):
    message: str
    region: str = "seoul"
    history: list[dict] | None = None


class CourseItem(BaseModel):
    contentId: str
    order: int
    reason: str


class AnchorOut(BaseModel):
    """검색어가 가리킨다고 판단한 장소 — 느슨하게 매칭하므로 반드시 화면에 드러내
    사용자가 오인식을 알아챌 수 있게 한다."""
    contentId: str
    title: str
    region: str


class ChatOut(BaseModel):
    reply: str
    course: list[CourseItem] = []
    region: str = ""            # 실제로 후보를 뽑은 지역 (검색어에 따라 바뀔 수 있음)
    anchor: AnchorOut | None = None
    fallback: bool = False      # True = LLM 실패로 데모 픽스처(서울 광화문 코스) 응답


class ResolveOut(BaseModel):
    """채팅 전에 '이 검색어가 어느 지역/장소인가'만 싸게 물어보는 용도 (LLM 호출 없음)."""
    region: str
    anchor: AnchorOut | None = None
