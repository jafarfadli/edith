# The optional CJK fallback fonts (Korean/Japanese/Chinese, ~113 MB) are downloaded at build time, not committed.
# Build with --build-arg CJK_FONTS=0 to leave them out (CJK characters then stay "unsupported").
FROM node:22-slim AS fonts
ARG CJK_FONTS=1
WORKDIR /app
COPY packages/fonts packages/fonts
RUN if [ "$CJK_FONTS" = "1" ]; then node packages/fonts/scripts/fetch-cjk.mjs; fi

FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /app/apps/api
COPY apps/api/pyproject.toml apps/api/uv.lock ./
RUN uv sync --frozen --no-dev
COPY apps/api/edith ./edith
COPY --from=fonts /app/packages/fonts /app/packages/fonts
ENV EDITH_DATA_DIR=/data EDITH_FONTS_DIR=/app/packages/fonts
VOLUME /data
EXPOSE 8000
CMD ["uv", "run", "--no-dev", "uvicorn", "edith.main:app", "--host", "0.0.0.0", "--port", "8000"]
