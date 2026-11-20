# DealPilot edgar-service. Multi-arch (linux/amd64, linux/arm64):
#   docker buildx build --platform linux/amd64,linux/arm64 -t dealpilot/edgar-service services/edgar
# Run (single worker keeps edgartools' rate limiter process-wide):
#   docker run -p 8100:8100 -e SEC_USER_AGENT="DealPilot you@example.com" \
#     -v edgar-cache:/data/cache/edgar dealpilot/edgar-service
FROM ghcr.io/astral-sh/uv:0.11.28 AS uv

FROM python:3.12-slim

COPY --from=uv /uv /uvx /usr/local/bin/

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    EDGAR_CACHE_DIR=/data/cache/edgar

RUN groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --home-dir /app --no-create-home app \
    && mkdir -p /app /data/cache/edgar \
    && chown -R app:app /app /data

WORKDIR /app

# Dependencies first (cached layer), then the project itself.
COPY --chown=app:app pyproject.toml uv.lock .python-version ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project

COPY --chown=app:app README.md ./
COPY --chown=app:app src ./src
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev \
    && chown -R app:app /app/.venv

USER app
VOLUME ["/data/cache/edgar"]
EXPOSE 8100

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8100/health', timeout=4).status == 200 else 1)"

CMD ["fastapi", "run", "src/edgar_service/main.py", "--host", "0.0.0.0", "--port", "8100", "--workers", "1"]
