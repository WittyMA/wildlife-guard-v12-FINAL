# DJI Phantom 3 Advanced — Autonomous Integration and Setup Guide

This guide details the integration of the **DJI Phantom 3 Advanced** aircraft into the **Wildlife Guard** autonomous wildlife security system. By replacing the previous LYZRC L200 ProMax proprietary UDP bridge with a robust, backend-abstracted bridge, the system can now handle real-world DJI OcuSync/Lightbridge video feeds and MAVLink/DroneKit flight controls, while retaining a full software simulator for offline demonstration and testing.

---

## 1. System Architecture & Data Flow

The integration bridges the closed DJI ecosystem with the open Wildlife Guard web application. When the web application's AI vision pipeline detects an anomaly (such as an anonymous intruder, dark environment, or blurry object), it automatically triggers an autonomous drone verification mission.

```
[Webcam] → [Browser Monitor] → detects anonymous object
                                      ↓
                              [Node.js Server]
                                      ↓
                          [Python Bridge (DroneKit)]
                                      ↓
                    [USB Cable to DJI Controller] → [Phantom 3]
                                      ↑
                          [RTSP Video Stream back]
                                      ↓
                          [Browser shows drone camera]
```

### 1.1 Data Flow Pipeline
1. **Detection**: A stationary camera station uploads an image. The browser-based AI monitor detects a critical event (e.g., an unauthorized vehicle or human).
2. **Auto-Trigger**: The Node.js backend registers the detection, creates a `drone_mission` record, and issues a POST request to the local Drone Bridge.
3. **Flight Command**: The Drone Bridge translates the command (e.g., `takeoff` or `follow_target`) and transmits it via the selected backend.
4. **Telemetry Feedback**: The drone streams telemetry (GPS coordinates, battery percentage, altitude, heading) back to the bridge. The Node.js server polls the bridge and updates the database, allowing the Ranger Dashboard to render the drone's position on the live map in real time.
5. **Live Video Feed**: The drone camera's RTSP video stream is captured by the bridge, decoded into JPEG frames using `ffmpeg`, and served to the browser via MJPEG streaming or high-speed snapshot polling (200ms intervals).

---

## 2. Bridge Backend Abstraction Layer

Because a stock DJI Phantom 3 Advanced does not natively expose a raw MAVLink serial interface or a direct RTSP endpoint without developer-level tools, the bridge implements a **three-tier backend architecture**. This ensures the system remains fully functional in any environment:

| Backend | Selected Via | Hardware Requirements | Primary Use Case |
| :--- | :--- | :--- | :--- |
| **`sim`** (Default) | `DRONE_BACKEND=sim` | None (pure software simulation) | Development, testing, and academic defense demonstrations. |
| **`mavlink`** | `DRONE_BACKEND=mavlink` | MAVLink-compatible flight stack or companion computer | Direct autonomous control via DroneKit over USB serial or UDP. |
| **`rtmp_relay`** | `DRONE_BACKEND=rtmp_relay` | Stock Phantom 3, DJI GO App, local RTMP relay | Real-world streaming and telemetry capture for stock DJI aircraft. |

### 2.1 Backend Details

#### 1. Software Simulator (`sim`)
The simulator runs a local mathematical flight model. When a `takeoff` command is received, the virtual drone arms, climbs to the target altitude, updates its GPS position relative to the camera station, and generates a dynamic video stream displaying real-time telemetry overlays.

#### 2. MAVLink / DroneKit (`mavlink`)
This backend connects to MAVLink-enabled aircraft using the `dronekit-python` SDK. It can communicate over USB serial (`/dev/ttyACM0`) or UDP (`127.0.0.1:14550`).
* **Telemetry**: Parsed directly from MAVLink messages (e.g., `GLOBAL_POSITION_INT`, `SYS_STATUS`).
* **Flight Commands**: Issued using DroneKit's `simple_takeoff()`, `simple_goto()`, and custom yaw override messages.

#### 3. RTMP Video Relay (`rtmp_relay`)
For stock Phantom 3 aircraft, live video is pushed from the DJI GO app (running on a mobile device connected to the controller) to a local RTMP relay (e.g., **MediaMTX**).
* **DJI GO RTMP Target**: `rtmp://[YOUR_LAPTOP_IP]:1935/live/drone`
* **Bridge RTSP Source**: `rtsp://localhost:8554/live/drone`
* The bridge uses `ffmpeg` to subscribe to this relay, downscale the video to 640x480 at 15 FPS, and stream it to the Wildlife Guard interface.

---

## 3. Configuration & Environment Variables

All configuration is managed through the central `.env` file in the project root. The following keys configure the DJI Phantom 3 integration:

```ini
# ============================================================
# Drone Bridge Service Configuration (DJI Phantom 3 Advanced)
# ============================================================
DRONE_BRIDGE_URL=http://localhost:5000
DRONE_BRIDGE_TIMEOUT=5000

# Backend selector: sim | mavlink | rtmp_relay
DRONE_BACKEND=sim

# Drone Identity
DRONE_MODEL=DJI Phantom 3 Advanced
DRONE_WIFI_SSID=Phantom3_Controller

# Video Configuration (used by mavlink/rtmp_relay; ignored in sim)
DRONE_VIDEO_SOURCE=rtsp://192.168.1.1:554/live
DRONE_VIDEO_WIDTH=640
DRONE_VIDEO_HEIGHT=480
DRONE_VIDEO_FPS=15

# MAVLink Configuration (used only when DRONE_BACKEND=mavlink)
MAVLINK_CONNECTION=udp:127.0.0.1:14550
MAVLINK_BAUD=57600
DRONE_TAKEOFF_ALT=15
```

---

## 4. API Contract & Endpoints

The bridge exposes a lightweight HTTP REST API on port `5000`. The Node.js server and React frontend interact with the drone exclusively through these endpoints:

### 4.1 Telemetry & Status
* **`GET /health`**: Returns the health of the bridge service and connection status.
  ```json
  {
    "healthy": true,
    "drone_status": "connected",
    "backend": "sim",
    "drone_model": "DJI Phantom 3 Advanced"
  }
  ```
* **`GET /telemetry`**: Returns flat telemetry data for backward compatibility with the frontend.
  ```json
  {
    "connected": true,
    "armed": true,
    "flight_mode": "GUIDED",
    "lat": 5.6037,
    "lng": -0.1870,
    "altitude": 15.0,
    "battery": 98,
    "signal": 95,
    "speed": 0.0,
    "heading": 180.0
  }
  ```
* **`GET /status`**: Returns detailed system diagnostic information, including network parameters.

### 4.2 Video Streaming
* **`GET /snapshot`**: Returns the latest single JPEG frame. Polled by the frontend monitor page (`Monitor.tsx`) every 200ms.
* **`GET /video_feed`**: Serves a continuous multipart MJPEG stream (`multipart/x-mixed-replace`) for direct embedding in `<img>` tags.

### 4.3 Control Commands
* **`POST /command`**: Dispatches flight and payload commands.
  * **Takeoff**: `{"command": "takeoff", "altitude": 15}`
  * **Land**: `{"command": "land"}`
  * **Return Home**: `{"command": "return_home"}`
  * **Hover**: `{"command": "hover"}`
  * **Follow Target**: Centers the camera gimbal on an object.
    ```json
    {
      "command": "follow_target",
      "target_x": 0.65,
      "target_y": 0.45,
      "track_id": "t1",
      "confidence": 0.92
    }
    ```
  * **Investigate**: Coordinates a compound mission (repositions, centers gimbal, captures verification snapshot).

---

## 5. Step-by-Step Setup Guide

### 5.1 System Dependencies
The bridge requires `ffmpeg` to decode and transcode H.264 video streams.
* **Ubuntu / Debian**:
  ```bash
  sudo apt-get update && sudo apt-get install -y ffmpeg gcc python3-pip
  ```
* **macOS** (via Homebrew):
  ```bash
  brew install ffmpeg
  ```

### 5.2 Python Environment Setup
Navigate to the `drone-bridge` directory and install the required Python packages:
```bash
cd drone-bridge
pip install -r requirements.txt
```

### 5.3 Running the Bridge
Start the bridge service with your desired backend.

#### Option A: Running the Simulator (Recommended for testing)
```bash
export DRONE_BACKEND=sim
python dji_bridge.py
```

#### Option B: Running with a MAVLink Connection
```bash
export DRONE_BACKEND=mavlink
export MAVLINK_CONNECTION=/dev/ttyACM0  # Or COM3 on Windows
python dji_bridge.py
```

#### Option C: Running with RTMP Video Relay (Stock DJI GO Setup)
1. Download and run [MediaMTX](https://github.com/bluenviron/mediamtx/releases) to start a local RTMP/RTSP server.
2. Connect your mobile device (running DJI GO) to the Phantom 3 controller.
3. In DJI GO, set the live streaming target to: `rtmp://[YOUR_LAPTOP_IP]:1935/live/drone`.
4. Configure and run the bridge:
   ```bash
   export DRONE_BACKEND=rtmp_relay
   export DRONE_VIDEO_SOURCE=rtsp://localhost:8554/live/drone
   python dji_bridge.py
   ```

---

## 6. Verification and Testing

A comprehensive diagnostic test script is included to verify the bridge's health and functionality. Run the following command to perform an automated endpoint and command sequence test:

```bash
# Start the bridge in sim mode in the background
DRONE_BACKEND=sim BRIDGE_PORT=5000 python dji_bridge.py &
BRIDGE_PID=$!
sleep 2

# Run the verification checks
curl -f http://localhost:5000/health
curl -f http://localhost:5000/telemetry
curl -d '{"command":"takeoff","altitude":10}' -H "Content-Type: application/json" http://localhost:5000/command

# Clean up
kill $BRIDGE_PID
```

By completing this integration, the **Wildlife Guard** system is fully equipped to deploy the **DJI Phantom 3 Advanced** for real-time aerial verification of ground threats, providing rangers with critical situational awareness.
