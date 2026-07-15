from fastapi import APIRouter

from ..schemas import ChatOut, ChatRequest, IntentOut, IntentRequest, ResolveOut
from ..services import intent, recommend

router = APIRouter(prefix="/api", tags=["chat"])


@router.post("/chat", response_model=ChatOut)
def post_chat(req: ChatRequest):
    return recommend.chat(req.message, req.history, req.region)


@router.get("/resolve", response_model=ResolveOut)
def resolve(q: str, region: str = "seoul"):
    """검색어가 어느 지역·장소를 가리키는지만 판정 (메모리 연산, LLM 호출 0).

    FE가 채팅을 보내기 전에 이걸로 확인한다. 지역을 못 정했는데 조용히 서울로
    떨어뜨리지 않고 되물으려면, LLM을 태우기 전에 알아야 한다.
    """
    r, a = recommend.resolve(q, region)
    return {"region": r, "anchor": a and {"contentId": a["contentId"], "title": a["title"],
                                          "region": a.get("region", r)}}


@router.post("/intent", response_model=IntentOut)
def post_intent(req: IntentRequest):
    """자연어 → 지역/랜드마크 의도 매칭 — 로컬 사전 우선, 실패 시 Haiku 단일 호출."""
    return intent.match(req.text)
