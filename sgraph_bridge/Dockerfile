FROM python:3.12-slim

WORKDIR /app

# Install dependencies first for layer caching.
COPY pyproject.toml ./
RUN pip install --no-cache-dir -e "."

# Copy source.
COPY src/ src/

# Workspace mount-point — created at runtime by docker-compose.
RUN mkdir -p /workspace

ENV SGRAPH_WORKSPACE=/workspace

EXPOSE 8000

CMD ["uvicorn", "sgraph_bridge.main:app", "--host", "0.0.0.0", "--port", "8000"]
