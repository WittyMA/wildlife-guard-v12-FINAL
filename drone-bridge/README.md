# DJI Phantom 3 Advanced Bridge Service

A Flask-based middleware service that provides bidirectional communication and live video streaming between the Wildlife Guard Web Application and the **DJI Phantom 3 Advanced** drone.

This bridge is a **drop-in replacement** for the previous LYZRC L200 ProMax bridge. It maintains the identical HTTP API contract, allowing the existing Wildlife Guard server and frontend client to interact with the drone seamlessly.

## Quick Start

### Installation

1. Install system dependencies (ffmpeg is required to decode and transcode the drone's RTSP/RTMP video stream):
   ```bash
   # Ubuntu/Debian
   sudo apt-get update && sudo apt-get install -y ffmpeg gcc python3-pip
   ```

2. Install Python dependencies:
   ```bash
   cd drone-bridge
   pip install -r requirements.txt
   ```

### Run Locally

Start the bridge with your desired backend (default is `sim` software simulator):

```bash
# To run the simulator (perfect for offline testing and demos)
export DRONE_BACKEND=sim
python dji_bridge.py

# To run with a MAVLink-capable craft / proxy over USB serial or UDP
export DRONE_BACKEND=mavlink
export MAVLINK_CONNECTION=/dev/ttyACM0
python dji_bridge.py

# To run with a stock Phantom 3 + DJI GO RTMP relay
export DRONE_BACKEND=rtmp_relay
export DRONE_VIDEO_SOURCE=rtsp://localhost:8554/live/drone
python dji_bridge.py
```

The service will start on `http://localhost:5000`.

### Run with Docker

```bash
docker build -t dji-drone-bridge:latest .
docker run -d -p 5000:5000 --name dji-bridge dji-drone-bridge:latest
```

## Features

✅ **Multi-Backend Support** - Swap between Software Simulator, MAVLink/DroneKit, and RTMP-relay backends.  
✅ **Live RTSP/RTMP Video Transcoding** - Automatically grabs the drone's video stream and transcodes it into high-speed MJPEG/JPEGs for browser rendering.  
✅ **Autonomous Flight Control** - Full support for autonomous takeoff, landing, hover, return-to-home, and waypoint navigation.  
✅ **Gimbal Target Tracking** - Receives normalized object coordinates and directs the gimbal/heading to follow moving targets.  
✅ **Robust Telemetry** - Exposes battery, GPS coordinates, signal strength, altitude, heading, and speed to the Node.js server.  

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Service information |
| GET | `/health` | Health check |
| GET | `/telemetry` | All flat telemetry data (Monitor.tsx compatible) |
| GET | `/telemetry/gps` | GPS coordinates and accuracy only |
| GET | `/status` | Comprehensive bridge + drone status |
| GET | `/config` | Active bridge configuration |
| GET | `/snapshot` | Latest single JPEG frame (Monitor.tsx polls this) |
| GET | `/video_feed` | Continuous MJPEG stream |
| POST | `/command` | Send flight/camera command (takeoff, land, RTL, follow) |
| POST | `/gps/set` | Update reference operator GPS |

## Documentation

- **[DJI_PHANTOM_INTEGRATION.md](DJI_PHANTOM_INTEGRATION.md)** - Comprehensive DJI integration, data flows, and setup guide.
- **[BRIDGE_SETUP_GUIDE.md](BRIDGE_SETUP_GUIDE.md)** - General bridge configuration.

## License

Part of the Wildlife Guard Security System.
