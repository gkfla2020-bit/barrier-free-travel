"""앱 조립 — 이 파일은 T+0 이후 건드리지 않는다."""
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import chat, places, route

app = FastAPI(title="무장애 여행 API")
app.add_middleware(CORSMiddleware, allow_origins=["*"],
                   allow_methods=["*"], allow_headers=["*"])
app.include_router(places.router)
app.include_router(route.router)
app.include_router(chat.router)


@app.get("/health")
def health():
    from .services import store
    return {"ok": True, "places": len(store.PLACES)}
