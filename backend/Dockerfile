FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8000

# Install ffmpeg and ca-certificates for streaming, transcoding and HTTPS
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend application source
COPY . .

# Create unprivileged streamx user and secure runtime data directory
RUN useradd -m -u 1000 -s /bin/bash streamx \
    && mkdir -p /data /app \
    && chown -R streamx:streamx /app /data

USER streamx

EXPOSE 7860
EXPOSE 8000

# Run uvicorn with dynamic $PORT support (defaults to 7860 for HF Spaces, or 8000)
CMD sh -c "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-7860}"

