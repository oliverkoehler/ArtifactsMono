FROM node:20-alpine AS base
WORKDIR /app

# Orchestrator
FROM base AS orchestrator
WORKDIR /app/apps/orchestrator
COPY apps/orchestrator/package*.json ./
RUN npm install
COPY apps/orchestrator .
COPY shared /app/shared
RUN npm run build
CMD ["npm", "start"]

# Worker
FROM base AS worker
WORKDIR /app/apps/worker
COPY apps/worker/package*.json ./
RUN npm install
COPY apps/worker .
COPY shared /app/shared
RUN npm run build
CMD ["npm", "start"]

# Docker metrics exporter
FROM base AS docker-metrics-exporter
WORKDIR /app/apps/docker-metrics-exporter
COPY apps/docker-metrics-exporter ./
CMD ["node", "src/index.js"]

# Python app
FROM python:3.12-slim AS python-app
WORKDIR /app/apps/python
ENV PYTHONUNBUFFERED=1
COPY apps/python/pyproject.toml ./
COPY apps/python/src ./src
RUN pip install --no-cache-dir .
CMD ["python", "-m", "artifactsmmo_python"]
