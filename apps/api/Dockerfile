FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /app/apps/api
COPY apps/api/pyproject.toml apps/api/uv.lock ./
RUN uv sync --frozen --no-dev
COPY apps/api/edith ./edith
COPY packages/fonts /app/packages/fonts
ENV EDITH_DATA_DIR=/data EDITH_FONTS_DIR=/app/packages/fonts
VOLUME /data
EXPOSE 8000
CMD ["uv", "run", "--no-dev", "uvicorn", "edith.main:app", "--host", "0.0.0.0", "--port", "8000"]
