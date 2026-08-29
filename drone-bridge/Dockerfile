FROM python:3.9-slim

WORKDIR /app

# System dependencies: ffmpeg is required to decode the RTSP/RTMP video stream.
RUN apt-get update && apt-get install -y \
    gcc \
    curl \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application (new DJI bridge + legacy bridge kept for reference)
COPY dji_bridge.py .
COPY bridge.py .

# Default backend can be overridden at runtime: -e DRONE_BACKEND=mavlink|rtmp_relay|sim
ENV DRONE_BACKEND=sim
ENV BRIDGE_PORT=5000

# Expose the bridge HTTP API
EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:5000/health || exit 1

# Run the DJI Phantom 3 Advanced bridge
CMD ["python", "dji_bridge.py"]
