# syntax=docker/dockerfile:1.7
FROM node:22.20.0-bookworm-slim AS ui
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12.8-slim-bookworm
ARG EXTRAS=all
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg curl tini \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --home /data echosentinel \
    && install -d -o echosentinel -g echosentinel -m 750 /data
WORKDIR /app
COPY backend/ /app/backend/
RUN pip install --no-cache-dir "/app/backend[${EXTRAS}]"
COPY --from=ui /src/frontend/dist /app/frontend/dist
COPY scripts/fetch-models.sh /app/scripts/
ENV ES_DATA_DIR=/data ES_HOST=0.0.0.0 ES_PORT=8640 ES_FRONTEND_DIST=/app/frontend/dist PYTHONUNBUFFERED=1
VOLUME ["/data"]
USER echosentinel
EXPOSE 8640
HEALTHCHECK --interval=30s --timeout=5s CMD curl -fsS http://127.0.0.1:8640/healthz || exit 1
ENTRYPOINT ["tini", "--"]
CMD ["echosentinel", "serve"]
