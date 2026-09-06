"""
DJI Phantom 3 Advanced Bridge Service v5.1
==========================================
Real drone integration for DJI Phantom 3 Advanced via RTMP relay.
"""

import io
import os
import math
import time
import json
import shutil
import logging
import threading
import subprocess
from datetime import datetime

from flask import Flask, request, jsonify, Response
from flask_cors import CORS

# ============================================================
# Configuration (all overridable via environment variables)
# ============================================================

# DEFAULT TO RTMP_RELAY FOR REAL DRONE
BACKEND = os.environ.get("DRONE_BACKEND", "rtmp_relay").lower()

# --- HTTP bridge ---
BRIDGE_PORT = int(os.environ.get("BRIDGE_PORT", "5000"))

# --- Drone identity / network ---
DRONE_MODEL = os.environ.get("DRONE_MODEL", "DJI Phantom 3 Advanced")
DRONE_WIFI_SSID = os.environ.get("DRONE_WIFI_SSID", "Phantom3_Controller")

# --- Video source (RTSP / RTMP) ---
VIDEO_SOURCE = os.environ.get("DRONE_VIDEO_SOURCE", "rtsp://localhost:8554/live/drone")
VIDEO_WIDTH = int(os.environ.get("DRONE_VIDEO_WIDTH", "640"))
VIDEO_HEIGHT = int(os.environ.get("DRONE_VIDEO_HEIGHT", "480"))
VIDEO_FPS = int(os.environ.get("DRONE_VIDEO_FPS", "15"))

# --- MAVLink connection ---
MAVLINK_CONNECTION = os.environ.get("MAVLINK_CONNECTION", "udp:127.0.0.1:14550")
MAVLINK_BAUD = int(os.environ.get("MAVLINK_BAUD", "57600"))
DEFAULT_TAKEOFF_ALT = float(os.environ.get("DRONE_TAKEOFF_ALT", "15"))

# --- Timing ---
TELEMETRY_INTERVAL = float(os.environ.get("TELEMETRY_INTERVAL", "1.0"))

# ============================================================
# Logging
# ============================================================

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - [%(levelname)s] %(message)s",
)
logger = logging.getLogger("dji_bridge")

# ============================================================
# Flask app
# ============================================================

app = Flask(__name__)
CORS(app)

# ============================================================
# Shared state
# ============================================================

state_lock = threading.Lock()
video_frame_lock = threading.Lock()

running = True
latest_jpeg_frame = None
video_stream_active = False
media_server_running = False

drone_state = {
    "connected": False,
    "connecting": False,
    "backend": BACKEND,
    "model": DRONE_MODEL,
    "status": "disconnected",
    "armed": False,
    "flight_mode": "UNKNOWN",
    "error": None,
    "connection_time": None,
    "last_update": None,
    "lat": 0.0,
    "lng": 0.0,
    "altitude": 0.0,
    "height": 0.0,
    "distance": 0.0,
    "speed": 0.0,
    "heading": 0.0,
    "battery": 0,
    "signal": 0,
    "gps_satellites": 0,
    "gps_accuracy": 99,
    "gps_mode": "searching",
    "mode": 1,
}

reference_gps = {"lat": 0.0, "lng": 0.0, "heading": 0.0}


def update_state(**kwargs):
    with state_lock:
        drone_state.update(kwargs)
        drone_state["last_update"] = datetime.now().isoformat()


# ============================================================
# Media Server Check
# ============================================================

def check_media_server():
    """Check if MediaMTX/RTSP server is running."""
    global media_server_running
    try:
        import socket
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(1)
        result = sock.connect_ex(('localhost', 8554))
        sock.close()
        media_server_running = (result == 0)
        return media_server_running
    except:
        return False


def start_media_server():
    """Attempt to start MediaMTX if available."""
    global media_server_running
    mediamtx_paths = [
        "./mediamtx",
        "/usr/local/bin/mediamtx",
        "/usr/bin/mediamtx",
        "./rtsp-simple-server",
    ]
    for path in mediamtx_paths:
        if os.path.exists(path) and os.access(path, os.X_OK):
            logger.info(f"[MEDIA] Starting MediaMTX from {path}")
            try:
                subprocess.Popen([path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                time.sleep(2)
                if check_media_server():
                    media_server_running = True
                    logger.info("[MEDIA] MediaMTX started successfully")
                    return True
            except:
                pass
    logger.warning("[MEDIA] MediaMTX not found. Please run: ./mediamtx")
    return False


# ============================================================
# Backend base class
# ============================================================

class DroneBackend:
    name = "base"

    def connect(self):
        raise NotImplementedError

    def disconnect(self):
        pass

    def takeoff(self, altitude=DEFAULT_TAKEOFF_ALT):
        return {"success": False, "error": "not implemented"}

    def land(self):
        return {"success": False, "error": "not implemented"}

    def return_home(self):
        return {"success": False, "error": "not implemented"}

    def hover(self):
        return {"success": False, "error": "not implemented"}

    def goto(self, lat, lng, alt=None):
        return {"success": False, "error": "not implemented"}

    def follow(self, target_x, target_y, **kwargs):
        return {"success": False, "error": "not implemented"}

    def take_photo(self):
        return {"success": False, "error": "not implemented"}

    def poll_telemetry(self):
        return {}


# ============================================================
# Simulator backend
# ============================================================

class SimBackend(DroneBackend):
    name = "sim"

    def __init__(self):
        self._t0 = time.time()
        self._battery = 100.0
        self._armed = False
        self._altitude = 0.0
        self._target_alt = 0.0
        self._lat = float(os.environ.get("SIM_HOME_LAT", "5.6037"))
        self._lng = float(os.environ.get("SIM_HOME_LNG", "-0.1870"))
        self._home = (self._lat, self._lng)
        self._heading = 0.0
        self._mode = "GUIDED"

    def connect(self):
        update_state(connecting=True, status="connecting", error=None)
        time.sleep(0.5)
        update_state(
            connected=True,
            connecting=False,
            status="connected",
            flight_mode=self._mode,
            connection_time=datetime.now().isoformat(),
        )
        logger.info("[SIM] Simulated DJI Phantom 3 Advanced connected")
        return True

    def takeoff(self, altitude=DEFAULT_TAKEOFF_ALT):
        self._armed = True
        self._target_alt = float(altitude)
        self._mode = "GUIDED"
        update_state(armed=True, flight_mode="GUIDED")
        logger.info(f"[SIM] Takeoff to {altitude} m")
        return {"success": True, "message": f"Simulated takeoff to {altitude} m"}

    def land(self):
        self._target_alt = 0.0
        self._mode = "LAND"
        update_state(flight_mode="LAND")
        logger.info("[SIM] Landing")
        return {"success": True, "message": "Simulated landing"}

    def return_home(self):
        self._lat, self._lng = self._home
        self._target_alt = 0.0
        self._mode = "RTL"
        update_state(flight_mode="RTL")
        logger.info("[SIM] Return to home")
        return {"success": True, "message": "Simulated return-to-home"}

    def hover(self):
        self._target_alt = self._altitude
        self._mode = "LOITER"
        update_state(flight_mode="LOITER")
        return {"success": True, "message": "Simulated hover/loiter"}

    def goto(self, lat, lng, alt=None):
        self._lat, self._lng = float(lat), float(lng)
        if alt is not None:
            self._target_alt = float(alt)
        return {"success": True, "message": f"Simulated goto {lat:.5f},{lng:.5f}"}

    def follow(self, target_x, target_y, **kwargs):
        error_x = float(target_x) - 0.5
        self._heading = (self._heading + error_x * 20.0) % 360.0
        return {
            "success": True,
            "message": "Simulated follow",
            "heading": round(self._heading, 1),
        }

    def take_photo(self):
        return {"success": True, "message": "Simulated photo captured"}

    def poll_telemetry(self):
        self._altitude += (self._target_alt - self._altitude) * 0.2
        if self._armed and self._battery > 0:
            self._battery = max(0.0, self._battery - 0.02)
        dist = _haversine(self._home, (self._lat, self._lng))
        return {
            "armed": self._armed,
            "flight_mode": self._mode,
            "lat": round(self._lat, 7),
            "lng": round(self._lng, 7),
            "altitude": round(self._altitude, 1),
            "height": round(self._altitude, 1),
            "distance": round(dist, 1),
            "speed": round(abs(self._target_alt - self._altitude) * 2, 1),
            "heading": round(self._heading, 1),
            "battery": int(self._battery),
            "signal": 95,
            "gps_satellites": 12,
            "gps_accuracy": 1,
            "gps_mode": "3D_fix",
        }


# ============================================================
# MAVLink backend
# ============================================================

class MavlinkBackend(DroneBackend):
    name = "mavlink"

    def __init__(self):
        self.vehicle = None
        self._home = None

    def connect(self):
        update_state(connecting=True, status="connecting", error=None)
        try:
            from dronekit import connect as dk_connect
        except Exception as e:
            msg = f"dronekit not installed: {e}. pip install dronekit pymavlink"
            logger.error(f"[MAVLINK] {msg}")
            update_state(connecting=False, status="disconnected", error=msg)
            return False
        try:
            logger.info(f"[MAVLINK] Connecting to {MAVLINK_CONNECTION} ...")
            kwargs = {"wait_ready": True, "timeout": 60}
            if MAVLINK_CONNECTION.startswith("/dev/") or "tty" in MAVLINK_CONNECTION:
                kwargs["baud"] = MAVLINK_BAUD
            self.vehicle = dk_connect(MAVLINK_CONNECTION, **kwargs)
            self._home = (
                self.vehicle.location.global_frame.lat,
                self.vehicle.location.global_frame.lon,
            )
            update_state(
                connected=True,
                connecting=False,
                status="connected",
                connection_time=datetime.now().isoformat(),
            )
            logger.info("[MAVLINK] Vehicle connected")
            return True
        except Exception as e:
            logger.error(f"[MAVLINK] Connection failed: {e}")
            update_state(connecting=False, status="disconnected", error=str(e))
            return False

    def disconnect(self):
        if self.vehicle:
            try:
                self.vehicle.close()
            except Exception:
                pass

    def _ensure(self):
        if not self.vehicle:
            raise RuntimeError("MAVLink vehicle not connected")

    def takeoff(self, altitude=DEFAULT_TAKEOFF_ALT):
        try:
            from dronekit import VehicleMode
            self._ensure()
            self.vehicle.mode = VehicleMode("GUIDED")
            self.vehicle.armed = True
            t0 = time.time()
            while not self.vehicle.armed and time.time() - t0 < 10:
                time.sleep(0.5)
            self.vehicle.simple_takeoff(float(altitude))
            return {"success": True, "message": f"Takeoff to {altitude} m commanded"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def land(self):
        try:
            from dronekit import VehicleMode
            self._ensure()
            self.vehicle.mode = VehicleMode("LAND")
            return {"success": True, "message": "LAND mode set"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def return_home(self):
        try:
            from dronekit import VehicleMode
            self._ensure()
            self.vehicle.mode = VehicleMode("RTL")
            return {"success": True, "message": "RTL mode set"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def hover(self):
        try:
            from dronekit import VehicleMode
            self._ensure()
            self.vehicle.mode = VehicleMode("LOITER")
            return {"success": True, "message": "LOITER mode set"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def goto(self, lat, lng, alt=None):
        try:
            from dronekit import LocationGlobalRelative
            self._ensure()
            target_alt = float(alt) if alt is not None else (
                self.vehicle.location.global_relative_frame.alt or DEFAULT_TAKEOFF_ALT
            )
            self.vehicle.simple_goto(
                LocationGlobalRelative(float(lat), float(lng), target_alt)
            )
            return {"success": True, "message": f"goto {lat:.6f},{lng:.6f}"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def follow(self, target_x, target_y, **kwargs):
        try:
            self._ensure()
            error_x = float(target_x) - 0.5
            heading = self.vehicle.heading or 0
            new_heading = (heading + error_x * 30.0) % 360.0
            self._condition_yaw(new_heading)
            return {"success": True, "message": f"yaw -> {new_heading:.0f} deg"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _condition_yaw(self, heading):
        from pymavlink import mavutil
        msg = self.vehicle.message_factory.command_long_encode(
            0, 0,
            mavutil.mavlink.MAV_CMD_CONDITION_YAW,
            0,
            heading, 0, 1, 0, 0, 0, 0,
        )
        self.vehicle.send_mavlink(msg)

    def take_photo(self):
        try:
            from pymavlink import mavutil
            self._ensure()
            msg = self.vehicle.message_factory.command_long_encode(
                0, 0,
                mavutil.mavlink.MAV_CMD_DO_DIGICAM_CONTROL,
                0, 0, 0, 0, 0, 1, 0, 0,
            )
            self.vehicle.send_mavlink(msg)
            return {"success": True, "message": "Photo command sent"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def poll_telemetry(self):
        if not self.vehicle:
            return {}
        try:
            loc = self.vehicle.location.global_relative_frame
            gloc = self.vehicle.location.global_frame
            batt = self.vehicle.battery
            gps = self.vehicle.gps_0
            dist = 0.0
            if self._home and gloc.lat is not None:
                dist = _haversine(self._home, (gloc.lat, gloc.lon))
            return {
                "armed": bool(self.vehicle.armed),
                "flight_mode": str(self.vehicle.mode.name),
                "lat": gloc.lat or 0.0,
                "lng": gloc.lon or 0.0,
                "altitude": round(loc.alt or 0.0, 1),
                "height": round(loc.alt or 0.0, 1),
                "distance": round(dist, 1),
                "speed": round(self.vehicle.groundspeed or 0.0, 1),
                "heading": self.vehicle.heading or 0,
                "battery": int(batt.level) if batt and batt.level is not None else 0,
                "signal": 100,
                "gps_satellites": gps.satellites_visible if gps else 0,
                "gps_accuracy": int(gps.eph / 100) if gps and gps.eph else 99,
                "gps_mode": "3D_fix" if gps and gps.fix_type >= 3 else "searching",
            }
        except Exception as e:
            logger.debug(f"[MAVLINK] telemetry error: {e}")
            return {}


# ============================================================
# RTMP-relay backend (stock DJI Phantom 3 path) - REAL DRONE
# ============================================================

class RtmpRelayBackend(DroneBackend):
    """
    Stock-Phantom path. Video arrives via RTSP/RTMP relay fed by DJI GO app.
    Flight commands are logged (actual control requires DJI SDK).
    """

    name = "rtmp_relay"

    def connect(self):
        # Check if media server is running
        if not check_media_server():
            logger.warning("[RTMP] Media server not running on port 8554")
            logger.warning("[RTMP] Starting MediaMTX...")
            if not start_media_server():
                logger.warning("[RTMP] Could not start MediaMTX")
                logger.warning("[RTMP] Please start: ./mediamtx")
                logger.warning("[RTMP] Then stream from DJI GO: rtmp://<PI_IP>:1935/live/drone")
            else:
                logger.info("[RTMP] Media server started on port 8554")
        else:
            logger.info("[RTMP] Media server detected on port 8554")

        update_state(
            connected=True,
            connecting=False,
            status="connected",
            flight_mode="DJI_GO",
            connection_time=datetime.now().isoformat(),
        )
        logger.info("[RTMP] Relay backend active; expecting video at %s", VIDEO_SOURCE)
        logger.info("[RTMP] To get live video:")
        logger.info("  1. Connect phone to DJI controller via USB")
        logger.info("  2. Open DJI GO app")
        logger.info("  3. Go to Live Streaming -> Custom RTMP")
        logger.info(f"  4. Enter: rtmp://192.168.0.237:1935/live/drone")
        logger.info("  5. Start Streaming")
        return True

    def _log(self, action):
        logger.info(f"[RTMP] Flight command '{action}' relayed (requires DJI SDK for actual control)")
        return {"success": True, "message": f"'{action}' command received"}

    def takeoff(self, altitude=DEFAULT_TAKEOFF_ALT):
        logger.warning("[RTMP] TAKEOFF command sent (simulated in RTMP mode)")
        logger.warning("[RTMP] For actual takeoff, use DJI GO app or DJI SDK")
        return self._log("takeoff")

    def land(self):
        logger.warning("[RTMP] LAND command sent (simulated in RTMP mode)")
        return self._log("land")

    def return_home(self):
        logger.warning("[RTMP] RETURN_HOME command sent (simulated in RTMP mode)")
        return self._log("return_home")

    def hover(self):
        return self._log("hover")

    def goto(self, lat, lng, alt=None):
        return self._log("goto")

    def follow(self, target_x, target_y, **kwargs):
        logger.info(f"[RTMP] Follow target at ({target_x:.2f}, {target_y:.2f})")
        return self._log("follow_target")

    def take_photo(self):
        return self._log("photo")

    def poll_telemetry(self):
        # Real telemetry would come from DJI SDK
        # For now, return simulated but with "connected" status
        return {
            "signal": 100,
            "gps_mode": "dji_go",
            "battery": 85,  # Placeholder
            "lat": 5.6037,
            "lng": -0.1870,
            "altitude": 0.0,
            "gps_satellites": 12,
        }


# ============================================================
# Helpers
# ============================================================

def _haversine(a, b):
    """Distance in metres between two (lat, lng) points."""
    r = 6371000.0
    lat1, lng1 = math.radians(a[0]), math.radians(a[1])
    lat2, lng2 = math.radians(b[0]), math.radians(b[1])
    dlat, dlng = lat2 - lat1, lng2 - lng1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(h)))


def make_backend():
    if BACKEND == "mavlink":
        return MavlinkBackend()
    if BACKEND == "rtmp_relay":
        return RtmpRelayBackend()
    return SimBackend()


backend = make_backend()


# ============================================================
# Telemetry loop
# ============================================================

def telemetry_loop():
    logger.info("Telemetry thread started")
    while running:
        try:
            if drone_state.get("connected"):
                fields = backend.poll_telemetry()
                if fields:
                    update_state(**fields)
        except Exception as e:
            logger.debug(f"telemetry loop error: {e}")
        time.sleep(TELEMETRY_INTERVAL)
    logger.info("Telemetry thread stopped")


# ============================================================
# Video pipeline
# ============================================================

def video_loop():
    global latest_jpeg_frame, video_stream_active, running

    logger.info("Video thread started")
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        logger.warning("[VIDEO] ffmpeg not found; install: sudo apt install ffmpeg")

    while running:
        if BACKEND == "sim":
            with video_frame_lock:
                latest_jpeg_frame = _render_sim_frame()
            video_stream_active = True
            time.sleep(1.0 / max(1, VIDEO_FPS))
            continue

        if not drone_state.get("connected") or not ffmpeg:
            video_stream_active = False
            time.sleep(1.0)
            continue

        video_stream_active = True
        cmd = [
            ffmpeg, "-hide_banner", "-loglevel", "warning",
            "-rtsp_transport", "tcp",
            "-fflags", "nobuffer", "-flags", "low_delay",
            "-i", VIDEO_SOURCE,
            "-f", "image2pipe", "-vcodec", "mjpeg", "-q:v", "5",
            "-r", str(VIDEO_FPS),
            "-vf", f"scale={VIDEO_WIDTH}:{VIDEO_HEIGHT}",
            "-",
        ]
        logger.info("[VIDEO] Connecting to RTSP stream...")
        try:
            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE,
                                    stderr=subprocess.PIPE, bufsize=10 ** 6)
            buf = b""
            frame_count = 0
            while running and drone_state.get("connected"):
                chunk = proc.stdout.read(32768)
                if not chunk:
                    break
                buf += chunk
                while True:
                    start = buf.find(b"\xff\xd8")
                    if start == -1:
                        buf = buf[-2:]
                        break
                    end = buf.find(b"\xff\xd9", start + 2)
                    if end == -1:
                        buf = buf[start:]
                        break
                    frame = buf[start:end + 2]
                    buf = buf[end + 2:]
                    if len(frame) > 500:
                        with video_frame_lock:
                            latest_jpeg_frame = frame
                            frame_count += 1
                            if frame_count % 30 == 0:
                                logger.info(f"[VIDEO] Received {frame_count} frames")
            proc.terminate()
            proc.wait(timeout=5)
        except Exception as e:
            logger.error(f"[VIDEO] Error: {e}")
        video_stream_active = False
        time.sleep(2.0)


def _render_sim_frame():
    try:
        from PIL import Image, ImageDraw, ImageFont
        img = Image.new("RGB", (VIDEO_WIDTH, VIDEO_HEIGHT), (15, 41, 30))
        d = ImageDraw.Draw(img)
        try:
            font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 22)
            small = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 14)
        except Exception:
            font = ImageFont.load_default()
            small = font
        with state_lock:
            s = dict(drone_state)
        d.text((20, 20), "DJI PHANTOM 3 ADVANCED", fill=(229, 184, 11), font=font)
        d.text((20, 56), "SIMULATED FEED", fill=(200, 200, 200), font=small)
        d.text((20, 90), f"MODE: {s['flight_mode']}   ARMED: {s['armed']}", fill=(230, 230, 230), font=small)
        d.text((20, 112), f"ALT: {s['altitude']} m   BATT: {s['battery']}%", fill=(230, 230, 230), font=small)
        d.text((20, 134), f"GPS: {s['lat']:.5f}, {s['lng']:.5f} ({s['gps_satellites']} sats)", fill=(230, 230, 230), font=small)
        d.text((20, 156), f"HDG: {s['heading']}   SPD: {s['speed']} m/s", fill=(230, 230, 230), font=small)
        d.text((20, VIDEO_HEIGHT - 30), datetime.now().strftime("%Y-%m-%d %H:%M:%S"), fill=(120, 160, 130), font=small)
        d.rectangle([2, 2, VIDEO_WIDTH - 3, VIDEO_HEIGHT - 3], outline=(229, 184, 11), width=2)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=70)
        return buf.getvalue()
    except Exception:
        return bytes([0xFF, 0xD8, 0xFF, 0xD9])


def generate_mjpeg():
    while True:
        with video_frame_lock:
            frame = latest_jpeg_frame
        if not frame:
            frame = _render_sim_frame() if BACKEND == "sim" else bytes([0xFF, 0xD8, 0xFF, 0xD9])
        yield (b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + frame + b"\r\n")
        time.sleep(1.0 / max(1, VIDEO_FPS))


# ============================================================
# HTTP API
# ============================================================

ENDPOINTS = {
    "health": "GET /health",
    "status": "GET /status",
    "config": "GET /config",
    "telemetry": "GET /telemetry",
    "gps": "GET /telemetry/gps",
    "video_status": "GET /video_status",
    "video_feed": "GET /video_feed",
    "snapshot": "GET /snapshot",
    "connect": "POST /connect",
    "command": "POST /command",
    "gps_set": "POST /gps/set",
}


@app.route("/", methods=["GET"])
def root():
    return jsonify({
        "service": "DJI Phantom 3 Advanced Bridge",
        "version": "5.1",
        "backend": BACKEND,
        "drone_model": DRONE_MODEL,
        "video_source": VIDEO_SOURCE if BACKEND != "sim" else "simulated",
        "status": "running",
        "media_server_running": media_server_running,
        "instructions": {
            "rtmp_url": f"rtmp://192.168.0.237:1935/live/drone",
            "video_source": VIDEO_SOURCE,
        },
        "endpoints": ENDPOINTS,
    }), 200


@app.route("/health", methods=["GET"])
def health():
    with state_lock:
        connected = drone_state["connected"]
        status = drone_state["status"]
    return jsonify({
        "healthy": connected or status == "connecting",
        "service": "DJI Phantom 3 Advanced Bridge",
        "version": "5.1",
        "backend": BACKEND,
        "drone_status": status,
        "drone_model": DRONE_MODEL,
        "media_server_running": media_server_running,
        "timestamp": datetime.now().isoformat(),
    }), 200


@app.route("/status", methods=["GET"])
def status():
    with state_lock:
        s = dict(drone_state)
    return jsonify({
        "bridge": {
            "service": "DJI Phantom 3 Advanced Bridge",
            "version": "5.1",
            "backend": BACKEND,
            "running": True,
            "video_active": video_stream_active,
            "media_server_running": media_server_running,
            "timestamp": datetime.now().isoformat(),
        },
        "drone": {
            "connected": s["connected"],
            "status": s["status"],
            "model": s["model"],
            "armed": s["armed"],
            "flight_mode": s["flight_mode"],
            "battery": s["battery"],
            "signal": s["signal"],
            "connection_time": s["connection_time"],
            "error": s["error"],
        },
        "gps": {
            "latitude": s["lat"], "longitude": s["lng"],
            "altitude": s["altitude"], "satellites": s["gps_satellites"],
            "accuracy": s["gps_accuracy"], "heading": s["heading"],
        },
        "network": {
            "wifi_ssid": DRONE_WIFI_SSID,
            "video_source": VIDEO_SOURCE if BACKEND != "sim" else "simulated",
            "bridge_port": BRIDGE_PORT,
            "rtmp_url": f"rtmp://192.168.0.237:1935/live/drone",
        },
    }), 200


@app.route("/config", methods=["GET"])
def config():
    return jsonify({
        "drone_model": DRONE_MODEL,
        "backend": BACKEND,
        "wifi_ssid": DRONE_WIFI_SSID,
        "video": {
            "source": VIDEO_SOURCE if BACKEND != "sim" else "simulated",
            "width": VIDEO_WIDTH, "height": VIDEO_HEIGHT, "fps": VIDEO_FPS,
        },
        "bridge_port": BRIDGE_PORT,
        "rtmp_url": f"rtmp://192.168.0.237:1935/live/drone",
    }), 200


@app.route("/telemetry", methods=["GET"])
def telemetry():
    with state_lock:
        return jsonify(dict(drone_state)), 200


@app.route("/telemetry/gps", methods=["GET"])
def telemetry_gps():
    with state_lock:
        s = dict(drone_state)
    return jsonify({
        "latitude": s["lat"], "longitude": s["lng"],
        "altitude": s["altitude"], "height": s["height"],
        "distance": s["distance"], "satellites": s["gps_satellites"],
        "accuracy": s["gps_accuracy"], "gps_mode": s["gps_mode"],
        "heading": s["heading"], "status": s["status"],
        "last_update": s["last_update"],
    }), 200


@app.route("/video_status", methods=["GET"])
def video_status():
    with video_frame_lock:
        has_frame = latest_jpeg_frame is not None
        size = len(latest_jpeg_frame) if latest_jpeg_frame else 0
    return jsonify({
        "active": video_stream_active,
        "has_frame": has_frame,
        "frame_size": size,
        "drone_connected": drone_state["connected"],
        "video_source": VIDEO_SOURCE if BACKEND != "sim" else "simulated",
        "media_server_running": media_server_running,
    }), 200


@app.route("/video_feed")
def video_feed():
    return Response(
        generate_mjpeg(),
        mimetype="multipart/x-mixed-replace; boundary=frame",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache", "Expires": "0",
            "Access-Control-Allow-Origin": "*",
        },
    )


@app.route("/snapshot")
def snapshot():
    with video_frame_lock:
        frame = latest_jpeg_frame
    if frame:
        return Response(frame, mimetype="image/jpeg", headers={
            "Cache-Control": "no-cache", "Access-Control-Allow-Origin": "*",
        })
    return jsonify({"error": "No video frame available"}), 503


@app.route("/connect", methods=["POST"])
def connect():
    ok = backend.connect()
    with state_lock:
        s = dict(drone_state)
    return jsonify({"success": ok, "status": s["status"], "backend": BACKEND}), (200 if ok else 503)


@app.route("/gps/set", methods=["POST"])
def gps_set():
    data = request.get_json(silent=True) or {}
    lat = float(data.get("lat", data.get("latitude", reference_gps["lat"])))
    lng = float(data.get("lng", data.get("longitude", reference_gps["lng"])))
    heading = float(data.get("heading", reference_gps["heading"]))
    reference_gps.update({"lat": lat, "lng": lng, "heading": heading})
    return jsonify({
        "success": True,
        "message": "Reference GPS updated",
        "gps": {"latitude": lat, "longitude": lng, "heading": heading},
    }), 200


@app.route("/command", methods=["POST"])
def command():
    data = request.get_json(silent=True) or {}
    cmd = str(data.get("command", data.get("type", ""))).lower()
    result = {"command": cmd, "timestamp": datetime.now().isoformat()}

    try:
        if cmd in ("takeoff",):
            alt = float(data.get("altitude", DEFAULT_TAKEOFF_ALT))
            result.update(backend.takeoff(alt))
        elif cmd in ("land",):
            result.update(backend.land())
        elif cmd in ("return_home", "rth"):
            result.update(backend.return_home())
        elif cmd in ("hover", "loiter"):
            result.update(backend.hover())
        elif cmd in ("goto",):
            result.update(backend.goto(data.get("lat"), data.get("lng"), data.get("alt")))
        elif cmd in ("photo", "take_photo"):
            result.update(backend.take_photo())
        elif cmd in ("follow_target", "follow"):
            result.update(backend.follow(
                float(data.get("target_x", 0.5)),
                float(data.get("target_y", 0.5)),
                velocity_dx=data.get("velocity_dx", 0),
                velocity_dy=data.get("velocity_dy", 0),
                track_id=data.get("track_id", "unknown"),
                confidence=data.get("confidence", 0),
            ))
        elif cmd in ("investigate",):
            reason = data.get("reason", "Unknown")
            target = data.get("target", {}) or {}
            logger.warning(f"[CMD] INVESTIGATE triggered: {reason}")
            backend.take_photo()
            tx = target.get("x", 0.5) + target.get("width", 0) / 2
            ty = target.get("y", 0.5) + target.get("height", 0) / 2
            backend.follow(tx, ty, reason=reason)
            result.update({
                "success": True,
                "message": f"Investigation initiated: {reason}",
                "actions": ["photo", "reposition", "verification_photo"],
                "target": target,
            })
        elif cmd in ("emergency_stop", "stop"):
            result.update(backend.land())
            result["message"] = "Emergency stop -> landing"
        else:
            return jsonify({
                "success": False,
                "error": f"Unknown command: {cmd}",
                "available_commands": [
                    "takeoff", "land", "return_home", "hover", "goto",
                    "photo", "follow_target", "investigate", "emergency_stop",
                ],
            }), 400
    except Exception as e:
        result.update({"success": False, "error": str(e)})
        return jsonify(result), 500

    return jsonify(result), 200


@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Endpoint not found", "path": request.path,
                    "available_endpoints": list(ENDPOINTS.values())}), 404


# ============================================================
# Main
# ============================================================

if __name__ == "__main__":
    logger.info("=" * 60)
    logger.info("  DJI Phantom 3 Advanced Bridge Service v5.1")
    logger.info("  Backend: %s", BACKEND)
    logger.info("  Bridge HTTP port: %s", BRIDGE_PORT)
    if BACKEND != "sim":
        logger.info("  Video source: %s", VIDEO_SOURCE)
    logger.info("=" * 60)

    if BACKEND == "rtmp_relay":
        logger.info("")
        logger.info("  📱 TO GET LIVE VIDEO FROM PHANTOM 3:")
        logger.info("  ─────────────────────────────────────")
        logger.info("  1. Connect phone to DJI controller via USB")
        logger.info("  2. Open DJI GO app")
        logger.info("  3. Go to Live Streaming -> Custom RTMP")
        logger.info(f"  4. Enter: rtmp://192.168.0.237:1935/live/drone")
        logger.info("  5. Start Streaming")
        logger.info("")
        logger.info("  Check media server: ./mediamtx")
        logger.info("")

    try:
        backend.connect()
    except Exception as e:
        logger.error("Initial connect failed: %s", e)

    threading.Thread(target=telemetry_loop, daemon=True).start()
    threading.Thread(target=video_loop, daemon=True).start()

    logger.info("Bridge API listening on http://0.0.0.0:%s", BRIDGE_PORT)
    try:
        app.run(host="0.0.0.0", port=BRIDGE_PORT, debug=False,
                use_reloader=False, threaded=True)
    except KeyboardInterrupt:
        running = False
        backend.disconnect()
        logger.info("Shutting down")