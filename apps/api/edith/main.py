from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from edith.settings import Settings


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    app = FastAPI(title="Edith API")
    app.state.settings = settings
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Content-Disposition"],
    )

    @app.get("/health")
    def health() -> dict:
        return {"ok": True}

    return app


app = create_app()
