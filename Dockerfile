# Dockerfile for deploying Joeku (the academic agent web server) to cloud
# This allows running the backend on a public URL so users don't need to run locally.
#
# Usage:
#   docker build -t joeku .
#   docker run -p 8000:8000 joeku
#
# In production (Render, Railway, Fly.io, etc.):
#   Set PORT env var (most platforms do this automatically)
#   Command: python -m academic_agent.cli web --host 0.0.0.0 --port $PORT
#
# Important notes:
# - This is the SERVER only. Users will still enter their own LLM API keys in the UI.
# - Uploaded files and projects will be stored on the container's filesystem.
# - For a real multi-user public service you will likely want:
#     * User authentication
#     * Per-user storage (database + object storage like S3)
#     * Rate limiting / auth
# - For personal use or small team, this works fine.

FROM python:3.11-slim

WORKDIR /app

# Install system deps if needed (for some packages like pillow, pypdf)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy dependency files first for better layer caching
COPY pyproject.toml uv.lock* ./

# Install uv for fast install (optional but recommended)
RUN pip install --no-cache-dir uv

# Install the project (including runtime dependencies)
# Using pip install . for simplicity and compatibility
RUN uv pip install --system --no-cache -e .

# Copy the rest of the source
COPY src ./src

# Expose default port (platforms often override via $PORT)
EXPOSE 8000

# Default command: start the web server on 0.0.0.0 so it's reachable from outside
# IMPORTANT for cloud: set DEFAULT_DATA_ROOT env + mount a persistent volume
CMD python -m academic_agent.cli web --host 0.0.0.0 --port ${PORT:-8000}