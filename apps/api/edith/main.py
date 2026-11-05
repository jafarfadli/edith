import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from edith.errors import install_error_handlers
from edith.routes import documents
from edith.settings import Settings
from edith.storage import Storage


logger = logging.getLogger("edith")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    storage = Storage(settings.data_dir, ttl=settings.ttl_seconds, tombstone_ttl=settings.tombstone_seconds)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        async def loop():
            while True:
                await asyncio.sleep(settings.cleanup_interval_seconds)
                try:
                    await asyncio.to_thread(storage.cleanup)
                except Exception:  # noqa: BLE001 - the loop must survive any cleanup failure
                    logger.exception("storage cleanup failed")

        task = asyncio.create_task(loop())
        yield
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task

    app = FastAPI(title="Edith API", lifespan=lifespan)
    app.state.settings = settings
    app.state.storage = storage
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Content-Disposition"],
    )
    install_error_handlers(app)
    app.include_router(documents.router)

    @app.get("/health")
    def health() -> dict:
        return {"ok": True}

    return app


app = create_app()
