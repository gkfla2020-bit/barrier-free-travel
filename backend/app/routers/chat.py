from fastapi import APIRouter

from ..schemas import ChatOut, ChatRequest
from ..services import recommend

router = APIRouter(prefix="/api", tags=["chat"])


@router.post("/chat", response_model=ChatOut)
def post_chat(req: ChatRequest):
    return recommend.chat(req.message, req.history, req.region)
