"""
L200 ProMax Bridge Service v4.0
===============================
Implements the Vison/Macrochip drone protocol for LYZRC L200 ProMax.

Protocol Reference (reverse-engineered from VS GPS PRO app / TurboDrone project):
- UDP 8080: Command & Control (handshake, heartbeat, GPS, flight commands)
- TCP 8888: Video stream (H.264, custom frame headers)
- UDP 8088: Camera/sensor commands (HiSi protocol)

Connection Sequence:
1. Send 0x0F → receive resolution string ("1080P")
2. Send 0x28 0x42 0x47 0x2C → receive firmware version
3. Send 29-byte time sync → receive "timeok"
4. Send 0x27 → receive "forceI" (keyframe request)
5. Start heartbeat at 1Hz (0x09 + IP bytes) → expects "ok" ACK
6. Send GPS packets at 5Hz (19-byte 5A 55 0F 01 format)

Drone: LYZRC L200 ProMax
WiFi Network: VS-GPS-BY-16418f (open, no password)
Drone IP: 172.16.10.1
Protocol Family: Vison/Macrochip "Hy" variant
"""

import socket
import struct
import threading
import time
import json
import logging
import os
from datetime import datetime
from flask import Flask, request, jsonify, Response
from flask_cors import CORS

# ============================================================
# Configuration
# ============================================================

DRONE_IP = os.environ.get('DRONE_IP', '172.16.10.1')
DRONE_NETWORK = os.environ.get('DRONE_NETWORK', 'VS-GPS-BY-16418f')

# Protocol Ports (from reverse-engineered Vison/Macrochip protocol)
CMD_PORT = int(os.environ.get('DRONE_CONTROL_PORT', '8080'))       # UDP: Command & Control
VIDEO_PORT = int(os.environ.get('DRONE_VIDEO_PORT', '8888'))       # TCP: Video stream (H.264)
CAMERA_PORT = int(os.environ.get('DRONE_CAMERA_PORT', '8088'))     # UDP: HiSi camera commands
BRIDGE_PORT = int(os.environ.get('BRIDGE_PORT', '5000'))

# Timing
HEARTBEAT_INTERVAL = 1.0    # 1Hz heartbeat required
GPS_SEND_INTERVAL = 0.2     # 5Hz GPS packets
HANDSHAKE_TIMEOUT = 3.0     # Per-step timeout
CONNECTION_CHECK_INTERVAL = 5.0  # Discovery check interval

# ============================================================
# Logging
# ============================================================

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - [%(levelname)s] %(message)s'
)
logger = logging.getLogger(__name__)

# ============================================================
# Flask App
# ============================================================

app = Flask(__name__)
CORS(app)

# ============================================================
# Global State
# ============================================================

telemetry_lock = threading.Lock()

drone_state = {
    "connected": False,
    "connecting": False,
    "firmware_version": None,
    "video_resolution": None,
    "handshake_complete": False,
    "heartbeat_active": False,
    "last_ack_time": 0,
    "last_response": None,
    "local_ip": None,
    "connection_time": None,
    "error": None,
    # Telemetry
    "lat": 0.0,
    "lng": 0.0,
    "altitude": 0.0,
    "height": 0.0,
    "distance": 0.0,
    "speed": 0.0,
    "heading": 0.0,
    "battery": 0,
    "signal": 100,
    "gps_satellites": 0,
    "gps_accuracy": 99,
    "gps_mode": "searching",
    "mode": 1,
    "status": "disconnected",
    "last_update": None,
}

# Thread control
running = True
cmd_socket = None


# ============================================================
# Network Utilities
# ============================================================

def get_local_ip():
    """Get local IP address on the drone's network."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(2)
        s.connect((DRONE_IP, CMD_PORT))
        local_ip = s.getsockname()[0]
        s.close()
        return local_ip
    except Exception:
        return '172.16.10.20'


def check_drone_reachable():
    """Check if drone is reachable on the network."""
    try:
        # Try TCP port 80 (known to respond on this drone)
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(2)
        result = sock.connect_ex((DRONE_IP, 80))
        sock.close()
        if result == 0:
            return True
    except:
        pass

    try:
        # Try UDP on command port
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(2)
        sock.sendto(bytes([0x0F]), (DRONE_IP, CMD_PORT))
        try:
            data, _ = sock.recvfrom(1024)
            sock.close()
            return True
        except socket.timeout:
            sock.close()
    except:
        pass

    # Check if we're on the same subnet
    try:
        local_ip = get_local_ip()
        if local_ip.startswith("172.16.10."):
            return True
    except:
        pass

    return False


# ============================================================
# Vison/Macrochip Protocol Implementation
# ============================================================

def create_cmd_socket():
    """Create or recreate the UDP command socket."""
    global cmd_socket
    if cmd_socket:
        try:
            cmd_socket.close()
        except:
            pass
    cmd_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    cmd_socket.settimeout(HANDSHAKE_TIMEOUT)
    return cmd_socket


def send_cmd(data):
    """Send raw bytes to drone on UDP 8080."""
    global cmd_socket
    if not cmd_socket:
        create_cmd_socket()
    try:
        cmd_socket.sendto(data, (DRONE_IP, CMD_PORT))
        return True
    except Exception as e:
        logger.error(f"Send error: {e}")
        return False


def recv_response(timeout=HANDSHAKE_TIMEOUT):
    """Receive response from drone."""
    global cmd_socket
    if not cmd_socket:
        return None
    try:
        cmd_socket.settimeout(timeout)
        data, addr = cmd_socket.recvfrom(4096)
        return data
    except socket.timeout:
        return None
    except Exception as e:
        logger.debug(f"Recv error: {e}")
        return None


def send_and_recv(data, timeout=HANDSHAKE_TIMEOUT):
    """Send command and wait for response."""
    send_cmd(data)
    return recv_response(timeout)


# === Handshake Steps ===

def handshake_step1_resolution():
    """Step 1: Query video resolution (send 0x0F → expect resolution string)."""
    logger.info("  Step 1: Querying resolution...")
    response = send_and_recv(bytes([0x0F]), timeout=3.0)
    if response:
        res_str = response.decode('utf-8', errors='ignore').strip()
        logger.info(f"    → Resolution: {res_str}")
        return res_str
    logger.warning("    → No response")
    return None


def handshake_step2_firmware():
    """Step 2: Query firmware version (send 0x28 0x42 0x47 0x2C → expect version)."""
    logger.info("  Step 2: Querying firmware...")
    response = send_and_recv(bytes([0x28, 0x42, 0x47, 0x2C]), timeout=3.0)
    if response:
        fw_str = response.decode('utf-8', errors='ignore').strip()
        logger.info(f"    → Firmware: {fw_str}")
        return fw_str
    logger.warning("    → No response")
    return None


def handshake_step3_timesync():
    """Step 3: Send 29-byte time sync packet (→ expect 'timeok')."""
    logger.info("  Step 3: Syncing time...")
    now = datetime.now()
    # Weekday: protocol uses 0=Sun, Python uses 0=Mon
    weekday = (now.weekday() + 1) % 7  # Convert Python weekday to protocol weekday
    packet = struct.pack('<B7I',
        0x26,           # Command ID
        now.year,
        now.month,
        now.day,
        weekday,
        now.hour,
        now.minute,
        now.second
    )
    response = send_and_recv(packet, timeout=3.0)
    if response:
        resp_str = response.decode('utf-8', errors='ignore').strip()
        logger.info(f"    → Response: {resp_str}")
        return 'timeok' in resp_str.lower() or 'ok' in resp_str.lower()
    logger.warning("    → No response")
    return False


def handshake_step4_keyframe():
    """Step 4: Request video keyframe (send 0x27 → expect 'forceI')."""
    logger.info("  Step 4: Requesting keyframe...")
    response = send_and_recv(bytes([0x27]), timeout=3.0)
    if response:
        resp_str = response.decode('utf-8', errors='ignore').strip()
        logger.info(f"    → Response: {resp_str}")
        return True
    logger.warning("    → No response")
    return False


def perform_handshake():
    """Perform full Vison/Macrochip connection handshake."""
    global drone_state

    with telemetry_lock:
        drone_state["connecting"] = True
        drone_state["error"] = None
        drone_state["status"] = "connecting"

    logger.info("=" * 50)
    logger.info("PERFORMING PROTOCOL HANDSHAKE")
    logger.info("=" * 50)

    try:
        create_cmd_socket()
        local_ip = get_local_ip()
        with telemetry_lock:
            drone_state["local_ip"] = local_ip
        logger.info(f"  Local IP: {local_ip}")

        # Step 1: Resolution query
        resolution = handshake_step1_resolution()
        if resolution:
            with telemetry_lock:
                drone_state["video_resolution"] = resolution

        # Step 2: Firmware query
        firmware = handshake_step2_firmware()
        if firmware:
            with telemetry_lock:
                drone_state["firmware_version"] = firmware

        # Step 3: Time sync
        time_synced = handshake_step3_timesync()

        # Step 4: Keyframe request
        handshake_step4_keyframe()

        # Evaluate handshake result
        got_response = resolution or firmware or time_synced
        drone_reachable = check_drone_reachable()

        if got_response:
            with telemetry_lock:
                drone_state["connected"] = True
                drone_state["connecting"] = False
                drone_state["handshake_complete"] = True
                drone_state["status"] = "connected"
                drone_state["connection_time"] = datetime.now().isoformat()
                drone_state["last_update"] = datetime.now().isoformat()
            logger.info("=" * 50)
            logger.info("HANDSHAKE COMPLETE - DRONE CONNECTED")
            logger.info("=" * 50)
            return True
        elif drone_reachable:
            with telemetry_lock:
                drone_state["connected"] = True
                drone_state["connecting"] = False
                drone_state["handshake_complete"] = False
                drone_state["status"] = "connected"
                drone_state["connection_time"] = datetime.now().isoformat()
                drone_state["last_update"] = datetime.now().isoformat()
                drone_state["error"] = "Drone reachable but protocol responses pending"
            logger.info("Drone reachable - connected (protocol handshake partial)")
            return True
        else:
            with telemetry_lock:
                drone_state["connected"] = False
                drone_state["connecting"] = False
                drone_state["status"] = "disconnected"
                drone_state["error"] = "Drone not responding"
            logger.warning("Handshake failed - drone not responding")
            return False

    except Exception as e:
        logger.error(f"Handshake error: {e}")
        with telemetry_lock:
            drone_state["connected"] = False
            drone_state["connecting"] = False
            drone_state["status"] = "disconnected"
            drone_state["error"] = str(e)
        return False


# === Heartbeat (1Hz) ===

def build_heartbeat():
    """Build 5-byte heartbeat: 0x09 + 4 IP bytes."""
    local_ip = drone_state.get("local_ip") or get_local_ip()
    ip_parts = [int(x) for x in local_ip.split('.')]
    return bytes([0x09] + ip_parts)


def heartbeat_loop():
    """Send heartbeat every 1 second. Drone responds with 'ok'."""
    global running, drone_state

    logger.info("Heartbeat thread started (1Hz)")
    with telemetry_lock:
        drone_state["heartbeat_active"] = True

    while running:
        try:
            if drone_state.get("connected") or drone_state.get("connecting"):
                heartbeat = build_heartbeat()
                send_cmd(heartbeat)

                # Try to receive ACK
                response = recv_response(timeout=1.0)
                if response:
                    resp_str = response.decode('utf-8', errors='ignore').strip()
                    with telemetry_lock:
                        drone_state["last_response"] = resp_str
                        drone_state["last_ack_time"] = time.time()
                        drone_state["last_update"] = datetime.now().isoformat()
                        if 'ok' in resp_str.lower():
                            drone_state["connected"] = True
                            drone_state["status"] = "connected"

                # Check for connection timeout (no ACK for 15 seconds)
                with telemetry_lock:
                    last_ack = drone_state.get("last_ack_time", 0)
                    if last_ack > 0 and (time.time() - last_ack) > 15:
                        if drone_state["status"] == "connected":
                            drone_state["status"] = "stale"
                            logger.warning("Heartbeat ACK timeout (>15s)")

        except Exception as e:
            logger.debug(f"Heartbeat error: {e}")

        time.sleep(HEARTBEAT_INTERVAL)

    with telemetry_lock:
        drone_state["heartbeat_active"] = False
    logger.info("Heartbeat thread stopped")


# === GPS Sender (5Hz) ===

def build_gps_packet(lat, lng, accuracy=3, heading=0, follow=False):
    """
    Build 19-byte GPS/status packet.
    Format: 5A 55 0F 01 [LAT:4] [LNG:4] [ACC:2] [HDG:2] [FOL:2] [XOR:1]
    """
    lat_int = int(lat * 1e7)
    lng_int = int(lng * 1e7)
    acc_int = min(max(int(accuracy), 0), 65535)
    hdg_int = int(heading) % 360
    fol_val = 0xFFFF if follow else 0x0000

    packet = struct.pack('>BBBBiiHHH',
        0x5A, 0x55,      # Frame header
        0x0F, 0x01,      # Packet type: GPS
        lat_int,         # Latitude * 10^7 (signed int32 BE)
        lng_int,         # Longitude * 10^7 (signed int32 BE)
        acc_int,         # GPS accuracy (meters, uint16 BE)
        hdg_int,         # Compass heading (degrees, uint16 BE)  
        fol_val,         # Follow mode (0xFFFF=follow, 0x0000=normal)
    )

    # XOR checksum of bytes 2 through 17
    checksum = 0
    for b in packet[2:18]:
        checksum ^= b

    return packet + bytes([checksum])


def gps_sender_loop():
    """Send GPS packets at 5Hz to maintain flight readiness."""
    global running

    logger.info("GPS sender thread started (5Hz)")

    while running:
        try:
            if drone_state.get("connected"):
                with telemetry_lock:
                    lat = drone_state.get("lat", 0.0)
                    lng = drone_state.get("lng", 0.0)
                    heading = drone_state.get("heading", 0.0)

                # Send GPS with accuracy=3 (required for flight readiness)
                gps_packet = build_gps_packet(lat, lng, accuracy=3, heading=heading)
                send_cmd(gps_packet)

        except Exception as e:
            logger.debug(f"GPS sender error: {e}")

        time.sleep(GPS_SEND_INTERVAL)

    logger.info("GPS sender thread stopped")


# === Discovery Service ===

def discovery_loop():
    """Periodically check drone connectivity and attempt reconnection."""
    global running

    logger.info("Discovery service started")

    while running:
        try:
            with telemetry_lock:
                is_connected = drone_state.get("connected", False)
                current_status = drone_state.get("status", "disconnected")

            if not is_connected or current_status == "disconnected":
                reachable = check_drone_reachable()
                if reachable:
                    logger.info(f"Drone detected at {DRONE_IP}, attempting handshake...")
                    perform_handshake()
                else:
                    with telemetry_lock:
                        if drone_state["status"] not in ["disconnected"]:
                            drone_state["status"] = "disconnected"
                            drone_state["connected"] = False
                            logger.warning("Drone connection lost")

        except Exception as e:
            logger.debug(f"Discovery error: {e}")

        time.sleep(CONNECTION_CHECK_INTERVAL)

    logger.info("Discovery service stopped")


# === Flight Commands ===

def build_flight_command(flags=0x00, pitch=0x7F, roll=0x7F, throttle=0x80, yaw=0x80):
    """
    Build 12-byte flight control packet.
    Format: 5A 55 08 02 [FLAGS] [PITCH] [ROLL] [THROTTLE] [YAW] [TRIM1] [TRIM2] [XOR]
    """
    packet = bytes([
        0x5A, 0x55,      # Frame header
        0x08, 0x02,      # Packet type: flight control
        flags,           # Flags (0x01=takeoff, 0x02=land, 0x04=RTH, 0x80=emergency)
        pitch,           # Pitch (0-255, center=127)
        roll,            # Roll (0-255, center=127)
        throttle,        # Throttle (0-255, center=128)
        yaw,             # Yaw (0-255, center=128)
        0x20,            # Trim 1
        0x20,            # Trim 2
    ])

    # XOR checksum of bytes 2 through 10
    checksum = 0
    for b in packet[2:11]:
        checksum ^= b

    return packet + bytes([checksum])


def send_flight_burst(flags, count=50, burst_count=None, yaw_override=None, pitch_override=None):
    """Send flight command burst (50 packets at 20ms intervals, then 25 idle).
    
    Args:
        flags: Flight command flags byte
        count: Number of command packets to send
        burst_count: Override for count (used by investigate command)
        yaw_override: Override yaw value (0x00=left, 0x80=center, 0xFF=right)
        pitch_override: Override pitch value (0x00=forward, 0x7F=center, 0xFF=back)
    """
    actual_count = burst_count if burst_count is not None else count
    pitch = pitch_override if pitch_override is not None else 0x7F
    yaw = yaw_override if yaw_override is not None else 0x80
    
    for _ in range(actual_count):
        cmd = build_flight_command(flags=flags, pitch=pitch, yaw=yaw)
        send_cmd(cmd)
        time.sleep(0.02)

    # Follow with idle packets
    for _ in range(25):
        idle = build_flight_command(flags=0x00)
        send_cmd(idle)
        time.sleep(0.02)


def send_camera_command(cmd_id):
    """Send HiSi camera command on UDP 8088 (stateless, fire-and-forget)."""
    packet = bytes([0xFF, 0x35, 0x19, 0x0A, cmd_id])
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.sendto(packet, (DRONE_IP, CAMERA_PORT))
        s.settimeout(0.5)
        try:
            response, _ = s.recvfrom(1024)
            return response
        except socket.timeout:
            return None
        finally:
            s.close()
    except Exception as e:
        logger.error(f"Camera command error: {e}")
        return None


# ============================================================
# Flask API Routes
# ============================================================

@app.route('/', methods=['GET'])
def root():
    """Service information and available endpoints."""
    return jsonify({
        "service": "L200 ProMax Bridge Service",
        "version": "4.0",
        "protocol": "Vison/Macrochip (VS GPS PRO)",
        "drone_model": "LYZRC L200 ProMax",
        "drone_ip": DRONE_IP,
        "drone_network": DRONE_NETWORK,
        "ports": {
            "command_control_udp": CMD_PORT,
            "video_stream_tcp": VIDEO_PORT,
            "camera_commands_udp": CAMERA_PORT,
            "bridge_api_http": BRIDGE_PORT,
        },
        "status": "running",
        "endpoints": {
            "health": "GET /health",
            "telemetry": "GET /telemetry",
            "gps": "GET /telemetry/gps",
            "status": "GET /status",
            "config": "GET /config",
            "command": "POST /command",
            "connect": "POST /connect",
            "gps_set": "POST /gps/set",
        }
    }), 200


@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint."""
    with telemetry_lock:
        connected = drone_state.get("connected", False)
        status = drone_state.get("status", "disconnected")
        heartbeat = drone_state.get("heartbeat_active", False)

    return jsonify({
        "healthy": connected or status == "connecting",
        "service": "L200 ProMax Bridge",
        "version": "4.0",
        "drone_status": status,
        "drone_ip": DRONE_IP,
        "drone_network": DRONE_NETWORK,
        "protocol": "Vison/Macrochip",
        "heartbeat_active": heartbeat,
        "timestamp": datetime.now().isoformat(),
    }), 200


@app.route('/telemetry', methods=['GET'])
def get_telemetry():
    """Full telemetry data."""
    with telemetry_lock:
        data = drone_state.copy()
    return jsonify(data), 200


@app.route('/telemetry/gps', methods=['GET'])
def get_gps():
    """GPS coordinates only."""
    with telemetry_lock:
        return jsonify({
            "latitude": drone_state.get("lat", 0.0),
            "longitude": drone_state.get("lng", 0.0),
            "altitude": drone_state.get("altitude", 0.0),
            "height": drone_state.get("height", 0.0),
            "distance": drone_state.get("distance", 0.0),
            "satellites": drone_state.get("gps_satellites", 0),
            "accuracy": drone_state.get("gps_accuracy", 99),
            "gps_mode": drone_state.get("gps_mode", "searching"),
            "heading": drone_state.get("heading", 0.0),
            "status": drone_state.get("status"),
            "last_update": drone_state.get("last_update"),
        }), 200


@app.route('/status', methods=['GET'])
def get_status():
    """Comprehensive system status."""
    with telemetry_lock:
        return jsonify({
            "bridge": {
                "service": "L200 ProMax Bridge",
                "version": "4.0",
                "protocol": "Vison/Macrochip",
                "running": True,
                "heartbeat_active": drone_state.get("heartbeat_active", False),
                "handshake_complete": drone_state.get("handshake_complete", False),
                "local_ip": drone_state.get("local_ip"),
                "timestamp": datetime.now().isoformat(),
            },
            "drone": {
                "connected": drone_state.get("connected", False),
                "status": drone_state.get("status"),
                "firmware": drone_state.get("firmware_version"),
                "resolution": drone_state.get("video_resolution"),
                "battery": drone_state.get("battery", 0),
                "signal": drone_state.get("signal", 0),
                "mode": drone_state.get("mode", 1),
                "connection_time": drone_state.get("connection_time"),
                "last_response": drone_state.get("last_response"),
                "error": drone_state.get("error"),
            },
            "gps": {
                "latitude": drone_state.get("lat", 0.0),
                "longitude": drone_state.get("lng", 0.0),
                "altitude": drone_state.get("altitude", 0.0),
                "satellites": drone_state.get("gps_satellites", 0),
                "accuracy": drone_state.get("gps_accuracy", 99),
                "heading": drone_state.get("heading", 0.0),
            },
            "network": {
                "drone_ip": DRONE_IP,
                "drone_network": DRONE_NETWORK,
                "cmd_port": CMD_PORT,
                "video_port": VIDEO_PORT,
                "camera_port": CAMERA_PORT,
                "bridge_port": BRIDGE_PORT,
            },
        }), 200


@app.route('/config', methods=['GET'])
def get_config():
    """Bridge configuration."""
    return jsonify({
        "drone_model": "LYZRC L200 ProMax",
        "drone_network": DRONE_NETWORK,
        "drone_ip": DRONE_IP,
        "protocol": "Vison/Macrochip (VS GPS PRO)",
        "ports": {
            "command_control": CMD_PORT,
            "video_stream": VIDEO_PORT,
            "camera_commands": CAMERA_PORT,
            "bridge_api": BRIDGE_PORT,
        },
        "timing": {
            "heartbeat": "1Hz (0x09 + IP bytes)",
            "gps_send": "5Hz (19-byte packets)",
            "handshake_timeout": f"{HANDSHAKE_TIMEOUT}s",
        },
        "protocol_details": {
            "handshake": "0x0F → res, (BG, → fw, time_sync → timeok, 0x27 → forceI",
            "heartbeat_format": "09 [IP_B1] [IP_B2] [IP_B3] [IP_B4]",
            "gps_format": "5A 55 0F 01 [LAT:4] [LNG:4] [ACC:2] [HDG:2] [FOL:2] [XOR:1]",
            "flight_format": "5A 55 08 02 [FLAGS] [PITCH] [ROLL] [THR] [YAW] [T1] [T2] [XOR]",
            "camera_format": "FF 35 19 0A [CMD_ID]",
        },
    }), 200


@app.route('/command', methods=['POST'])
def handle_command():
    """Send flight/camera commands to drone."""
    data = request.get_json()
    if not data:
        return jsonify({"success": False, "error": "No JSON data provided"}), 400

    cmd = data.get('command', data.get('type', '')).lower()
    result = {"command": cmd, "timestamp": datetime.now().isoformat()}

    # Flight commands (burst protocol)
    flight_commands = {
        'takeoff': 0x01,
        'land': 0x02,
        'return_home': 0x04,
        'rth': 0x04,
        'emergency_stop': 0x80,
        'stop': 0x80,
    }

    # Camera commands (HiSi protocol)
    camera_commands = {
        'photo': 61,
        'take_photo': 61,
        'record_start': 34,
        'video_start': 34,
        'record_stop': 35,
        'video_stop': 35,
    }

    # Single-byte commands
    single_commands = {
        'keyframe': bytes([0x27]),
        'resolution': bytes([0x0F]),
    }

    try:
        if cmd in flight_commands:
            flags = flight_commands[cmd]
            # Takeoff needs more packets (80) for reliable motor spin-up and lift
            # Emergency stop needs fewer but immediate (10)
            # Other flight commands use 50
            if cmd in ['emergency_stop', 'stop']:
                burst_count = 10
            elif cmd == 'takeoff':
                burst_count = 80  # Sustained burst for reliable takeoff
                logger.warning(f"DRONE TAKEOFF: Sending {burst_count} takeoff packets (flags=0x{flags:02X})")
            else:
                burst_count = 50
            threading.Thread(
                target=send_flight_burst,
                args=(flags, burst_count),
                daemon=True
            ).start()
            result["success"] = True
            result["message"] = f"Flight command '{cmd}' burst sent ({burst_count} packets)"
            result["protocol"] = f"5A 55 08 02 {flags:02X} ... (burst x{burst_count})"

        elif cmd in camera_commands:
            cmd_id = camera_commands[cmd]
            response = send_camera_command(cmd_id)
            result["success"] = True
            result["message"] = f"Camera command '{cmd}' sent (HiSi cmd {cmd_id})"
            result["protocol"] = f"FF 35 19 0A {cmd_id:02X} → UDP {CAMERA_PORT}"
            if response:
                result["response"] = response.hex()

        elif cmd in single_commands:
            send_cmd(single_commands[cmd])
            result["success"] = True
            result["message"] = f"Command '{cmd}' sent"

        elif cmd == 'follow_target':
            # Continuous follow mode - called every 2 seconds with updated target position
            target_x = data.get('target_x', 0.5)  # 0-1 normalized X center
            target_y = data.get('target_y', 0.5)  # 0-1 normalized Y center
            velocity_dx = data.get('velocity_dx', 0)
            velocity_dy = data.get('velocity_dy', 0)
            track_id = data.get('track_id', 'unknown')
            confidence = data.get('confidence', 0)
            reason = data.get('reason', 'Following target')
            direction = data.get('direction', 'forward')

            logger.info(f"DRONE FOLLOW: track={track_id} pos=({target_x:.2f},{target_y:.2f}) vel=({velocity_dx:.3f},{velocity_dy:.3f}) conf={confidence:.0%} dir={direction}")

            # Calculate yaw: proportional control based on how far off-center the target is
            # target_x: 0=far left, 0.5=center, 1=far right
            # yaw: 0x00=full left, 0x80=center, 0xFF=full right
            error_x = target_x - 0.5  # -0.5 to +0.5
            yaw = int(0x80 + error_x * 160)  # Proportional: ±80 from center
            yaw = max(0x20, min(0xE0, yaw))  # Clamp to safe range

            # Calculate pitch: move forward toward target (object at top = far away)
            # target_y: 0=top (far away), 1=bottom (close)
            # pitch: 0x00=full forward, 0x7F=center, 0xFF=full backward
            error_y = 0.5 - target_y  # positive = need to move forward
            pitch = int(0x7F - error_y * 120)  # Proportional: ±60 from center
            pitch = max(0x30, min(0xC0, pitch))  # Clamp to safe range

            # Sustained burst: 30 packets at 20ms = 600ms of continuous movement
            # This is called every 2 seconds, so the drone moves for 600ms then coasts for 1400ms
            burst_count = 30
            if abs(error_x) > 0.3 or abs(error_y) > 0.3:
                burst_count = 45  # Stronger correction if far off-center

            # Also predict where target is going using velocity
            if abs(velocity_dx) > 0.01:
                yaw = int(yaw + velocity_dx * 40)  # Anticipate movement
                yaw = max(0x20, min(0xE0, yaw))

            threading.Thread(
                target=send_flight_burst,
                args=(0x00,),
                kwargs={'yaw_override': yaw, 'pitch_override': pitch, 'burst_count': burst_count},
                daemon=True
            ).start()

            result["success"] = True
            result["message"] = f"Following target {track_id}: yaw={yaw:#04x} pitch={pitch:#04x} burst={burst_count}"
            result["target_position"] = {"x": target_x, "y": target_y}
            result["adjustments"] = {"yaw": f"0x{yaw:02X}", "pitch": f"0x{pitch:02X}", "burst": burst_count}
            result["velocity_compensation"] = {"dx": velocity_dx, "dy": velocity_dy}

        elif cmd == 'hover':
            # Stop all movement - hover in place
            logger.info("DRONE HOVER: Stopping follow, holding position")
            # Send idle packets to stop movement
            threading.Thread(
                target=send_flight_burst,
                args=(0x00,),
                kwargs={'burst_count': 5},
                daemon=True
            ).start()
            result["success"] = True
            result["message"] = "Drone hovering in place"

        elif cmd == 'investigate':
            # Auto-triggered by detection system for anonymous/blurry objects
            reason = data.get('reason', 'Unknown')
            target = data.get('target', {})
            det_type = data.get('detection_type', 'anonymous')
            confidence = data.get('confidence', 0)
            
            logger.warning(f"DRONE INVESTIGATION TRIGGERED: {reason}")
            logger.info(f"  Target: {target}, Type: {det_type}, Confidence: {confidence:.1%}")
            
            # Step 1: Take a photo for verification
            send_camera_command(61)  # take_photo
            time.sleep(0.5)
            
            # Step 2: If target has bounding box, calculate direction
            if target:
                tx = target.get('x', 0.5) + target.get('width', 0) / 2  # center X (0-1)
                ty = target.get('y', 0.5) + target.get('height', 0) / 2  # center Y (0-1)
                
                # Determine movement direction based on object position
                # Object on left (tx < 0.4) → yaw left
                # Object on right (tx > 0.6) → yaw right
                # Object on top (ty < 0.3) → pitch forward (move closer)
                # Object on bottom (ty > 0.7) → pitch back
                
                if tx < 0.35:
                    # Yaw left to center object
                    threading.Thread(target=send_flight_burst, args=(0x00,), 
                        kwargs={'yaw_override': 0x40}, daemon=True).start()
                    logger.info("  → Yawing LEFT to center object")
                elif tx > 0.65:
                    # Yaw right to center object
                    threading.Thread(target=send_flight_burst, args=(0x00,),
                        kwargs={'yaw_override': 0xC0}, daemon=True).start()
                    logger.info("  → Yawing RIGHT to center object")
                
                # Move forward slightly to get closer
                if det_type in ['anonymous', 'blurry_image']:
                    time.sleep(1)
                    threading.Thread(target=send_flight_burst, args=(0x00,),
                        kwargs={'pitch_override': 0x60, 'burst_count': 20}, daemon=True).start()
                    logger.info("  → Moving FORWARD to verify object")
            
            # Step 3: Take another photo after movement
            time.sleep(3)
            send_camera_command(61)  # take_photo again
            
            result["success"] = True
            result["message"] = f"Investigation initiated: {reason}"
            result["actions"] = ["photo_taken", "repositioning", "verification_photo"]
            result["target"] = target
            result["detection_type"] = det_type

        else:
            return jsonify({
                "success": False,
                "error": f"Unknown command: {cmd}",
                "available_commands": {
                    "flight": list(flight_commands.keys()),
                    "camera": list(camera_commands.keys()),
                    "other": list(single_commands.keys()) + ['investigate', 'follow_target', 'hover'],
                }
            }), 400

    except Exception as e:
        result["success"] = False
        result["error"] = str(e)
        return jsonify(result), 500

    return jsonify(result), 200


@app.route('/connect', methods=['POST'])
def connect_drone():
    """Manually trigger drone connection/reconnection."""
    reachable = check_drone_reachable()

    if reachable:
        # Perform handshake in background
        threading.Thread(target=perform_handshake, daemon=True).start()
        return jsonify({
            "success": True,
            "message": f"Drone detected at {DRONE_IP}. Handshake initiated.",
            "drone_ip": DRONE_IP,
            "network": DRONE_NETWORK,
        }), 200
    else:
        return jsonify({
            "success": False,
            "error": "Drone not reachable",
            "drone_ip": DRONE_IP,
            "troubleshooting": [
                "1. Power on the drone and wait 60 seconds",
                "2. Connect WiFi to 'VS-GPS-BY-16418f' (no password)",
                "3. Verify: ping 172.16.10.1",
                "4. Try again: curl -X POST http://localhost:5000/connect",
            ]
        }), 503


@app.route('/gps/set', methods=['POST'])
def set_gps():
    """Set base station GPS coordinates (sent to drone for RTH)."""
    data = request.get_json()
    if not data:
        return jsonify({"error": "Missing JSON body"}), 400

    with telemetry_lock:
        if 'latitude' in data:
            drone_state["lat"] = float(data['latitude'])
        if 'longitude' in data:
            drone_state["lng"] = float(data['longitude'])
        if 'heading' in data:
            drone_state["heading"] = float(data['heading'])

    return jsonify({
        "success": True,
        "message": "GPS coordinates updated",
        "gps": {
            "latitude": drone_state["lat"],
            "longitude": drone_state["lng"],
            "heading": drone_state["heading"],
        }
    }), 200


@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors."""
    return jsonify({
        "error": "Endpoint not found",
        "path": request.path,
        "available_endpoints": [
            "GET /", "GET /health", "GET /telemetry", "GET /telemetry/gps",
            "GET /status", "GET /config", "POST /command", "POST /connect",
            "POST /gps/set"
        ]
    }), 404


@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors."""
    return jsonify({"error": "Internal server error", "message": str(error)}), 500


# ============================================================
# Video Stream Proxy (MJPEG over HTTP)
# ============================================================

video_frame_lock = threading.Lock()
latest_jpeg_frame = None
video_stream_active = False


def video_receiver_loop():
    """
    Connect to the drone's TCP video port (8888) and receive H.264 video stream.
    Uses ffmpeg subprocess to decode H.264 → raw RGB frames → JPEG for MJPEG streaming.
    Falls back to raw JPEG marker scanning if ffmpeg is not available.
    """
    global latest_jpeg_frame, video_stream_active, running
    
    logger.info("[VIDEO] Video receiver thread started")
    
    while running:
        if not drone_state.get("connected", False):
            time.sleep(1)
            continue
        
        video_stream_active = True
        logger.info(f"[VIDEO] Attempting to connect to drone video at {DRONE_IP}:{VIDEO_PORT}")
        
        # Method 1: Use ffmpeg to decode H.264 stream from TCP
        try:
            import subprocess
            import struct
            
            # ffmpeg reads from TCP and outputs raw MJPEG frames to stdout
            ffmpeg_cmd = [
                'ffmpeg',
                '-hide_banner', '-loglevel', 'warning',
                '-fflags', 'nobuffer',
                '-flags', 'low_delay',
                '-analyzeduration', '500000',
                '-probesize', '500000',
                '-i', f'tcp://{DRONE_IP}:{VIDEO_PORT}',
                '-f', 'image2pipe',
                '-vcodec', 'mjpeg',
                '-q:v', '5',
                '-r', '15',
                '-vf', 'scale=640:480',
                '-'
            ]
            
            logger.info(f"[VIDEO] Starting ffmpeg decoder: {' '.join(ffmpeg_cmd)}")
            
            proc = subprocess.Popen(
                ffmpeg_cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                bufsize=10**6
            )
            
            logger.info("[VIDEO] ffmpeg process started, reading JPEG frames...")
            
            buffer = b''
            frame_count = 0
            
            while running and drone_state.get("connected", False):
                # Read chunks from ffmpeg stdout (MJPEG output)
                chunk = proc.stdout.read(32768)
                if not chunk:
                    logger.warning("[VIDEO] ffmpeg output ended")
                    break
                
                buffer += chunk
                
                # Extract JPEG frames from ffmpeg MJPEG output
                while True:
                    start = buffer.find(b'\xff\xd8')
                    if start == -1:
                        buffer = buffer[-2:] if len(buffer) > 2 else buffer
                        break
                    
                    end = buffer.find(b'\xff\xd9', start + 2)
                    if end == -1:
                        buffer = buffer[start:]
                        break
                    
                    # Complete JPEG frame from ffmpeg
                    frame = buffer[start:end + 2]
                    buffer = buffer[end + 2:]
                    
                    if len(frame) > 500:  # Valid frame (not corrupt)
                        with video_frame_lock:
                            latest_jpeg_frame = frame
                        frame_count += 1
                        if frame_count % 100 == 1:
                            logger.info(f"[VIDEO] Decoded frame #{frame_count} ({len(frame)} bytes)")
            
            proc.terminate()
            proc.wait(timeout=5)
            logger.info(f"[VIDEO] ffmpeg session ended. Total frames decoded: {frame_count}")
            
        except FileNotFoundError:
            logger.warning("[VIDEO] ffmpeg not found. Trying raw TCP stream with JPEG marker scanning...")
            
            # Method 2: Raw TCP with JPEG marker scanning (works if drone sends MJPEG)
            try:
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                sock.settimeout(5.0)
                sock.connect((DRONE_IP, VIDEO_PORT))
                logger.info("[VIDEO] Connected to drone video stream (raw TCP)")
                
                buffer = b''
                while running and drone_state.get("connected", False):
                    try:
                        chunk = sock.recv(65536)
                        if not chunk:
                            break
                        
                        buffer += chunk
                        
                        while True:
                            start = buffer.find(b'\xff\xd8')
                            if start == -1:
                                buffer = buffer[-2:] if len(buffer) > 2 else buffer
                                break
                            
                            end = buffer.find(b'\xff\xd9', start + 2)
                            if end == -1:
                                buffer = buffer[start:]
                                break
                            
                            frame = buffer[start:end + 2]
                            buffer = buffer[end + 2:]
                            
                            if len(frame) > 500:
                                with video_frame_lock:
                                    latest_jpeg_frame = frame
                    
                    except socket.timeout:
                        continue
                    except Exception as e:
                        logger.error(f"[VIDEO] Read error: {e}")
                        break
                
                sock.close()
                
            except (socket.timeout, ConnectionRefusedError, OSError) as e:
                logger.warning(f"[VIDEO] Raw TCP failed: {e}")
        
        except Exception as e:
            logger.error(f"[VIDEO] ffmpeg error: {e}")
            # Read stderr for diagnostics
            try:
                if 'proc' in dir() and proc and proc.stderr:
                    err_output = proc.stderr.read(2000).decode('utf-8', errors='ignore')
                    if err_output:
                        logger.error(f"[VIDEO] ffmpeg stderr: {err_output[:500]}")
            except:
                pass
        
        # Fallback: Try HTTP snapshot from common drone endpoints
        if latest_jpeg_frame is None:
            try:
                import urllib.request
                snapshot_urls = [
                    f"http://{DRONE_IP}:80/snapshot.jpg",
                    f"http://{DRONE_IP}:80/capture",
                    f"http://{DRONE_IP}:8080/snapshot.jpg",
                    f"http://{DRONE_IP}/cgi-bin/snapshot.cgi",
                ]
                
                for url in snapshot_urls:
                    try:
                        req = urllib.request.Request(url, headers={'User-Agent': 'Bridge/4.0'})
                        resp = urllib.request.urlopen(req, timeout=3)
                        if resp.status == 200:
                            frame_data = resp.read()
                            if len(frame_data) > 100:
                                with video_frame_lock:
                                    latest_jpeg_frame = frame_data
                                logger.info(f"[VIDEO] Got snapshot from {url}")
                                break
                    except Exception:
                        continue
            except Exception as e:
                logger.debug(f"[VIDEO] HTTP snapshot fallback failed: {e}")
        
        video_stream_active = False
        time.sleep(2)  # Wait before retry


def generate_mjpeg():
    """Generator that yields MJPEG frames for HTTP streaming."""
    global latest_jpeg_frame
    
    while True:
        with video_frame_lock:
            frame = latest_jpeg_frame
        
        if frame:
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')
        else:
            # Generate a placeholder frame when no video is available
            placeholder = generate_placeholder_frame()
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + placeholder + b'\r\n')
        
        time.sleep(0.04)  # ~25 FPS


def generate_placeholder_frame():
    """Generate a simple placeholder JPEG when no video is available."""
    try:
        from PIL import Image, ImageDraw, ImageFont
        import io
        
        img = Image.new('RGB', (640, 480), color=(30, 30, 40))
        draw = ImageDraw.Draw(img)
        
        # Draw status text
        status = "CONNECTING TO DRONE..." if drone_state.get("connecting") else "WAITING FOR VIDEO STREAM"
        if drone_state.get("connected"):
            status = "DRONE CONNECTED - WAITING FOR VIDEO"
        
        # Center text
        try:
            font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 20)
            small_font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 14)
        except Exception:
            font = ImageFont.load_default()
            small_font = font
        
        # Draw drone icon area
        draw.text((220, 180), "L200 ProMax", fill=(100, 200, 100), font=font)
        draw.text((230, 220), status, fill=(200, 200, 200), font=small_font)
        draw.text((230, 250), f"Drone IP: {DRONE_IP}", fill=(150, 150, 150), font=small_font)
        draw.text((230, 275), f"Video Port: {VIDEO_PORT}", fill=(150, 150, 150), font=small_font)
        draw.text((230, 300), datetime.now().strftime("%H:%M:%S"), fill=(100, 100, 200), font=small_font)
        
        # Draw border
        draw.rectangle([2, 2, 637, 477], outline=(80, 80, 100), width=2)
        
        buf = io.BytesIO()
        img.save(buf, format='JPEG', quality=70)
        return buf.getvalue()
        
    except ImportError:
        # Minimal 1x1 JPEG if PIL not available
        return bytes([
            0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
            0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43,
            0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
            0x09, 0x08, 0x0A, 0x0C, 0x14, 0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12,
            0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A, 0x1C, 0x1C, 0x20,
            0x24, 0x2E, 0x27, 0x20, 0x22, 0x2C, 0x23, 0x1C, 0x1C, 0x28, 0x37, 0x29,
            0x2C, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27, 0x39, 0x3D, 0x38, 0x32,
            0x3C, 0x2E, 0x33, 0x34, 0x32, 0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x01,
            0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xFF, 0xC4, 0x00, 0x1F, 0x00, 0x00,
            0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
            0x09, 0x0A, 0x0B, 0xFF, 0xC4, 0x00, 0xB5, 0x10, 0x00, 0x02, 0x01, 0x03,
            0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7D,
            0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00, 0x7B, 0x40,
            0x1B, 0xFF, 0xD9
        ])


@app.route('/video_feed')
def video_feed():
    """MJPEG video stream endpoint for the web browser."""
    return Response(
        generate_mjpeg(),
        mimetype='multipart/x-mixed-replace; boundary=frame',
        headers={
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
            'Access-Control-Allow-Origin': '*',
        }
    )


@app.route('/video_status')
def video_status():
    """Check video stream status."""
    with video_frame_lock:
        has_frame = latest_jpeg_frame is not None
        frame_size = len(latest_jpeg_frame) if latest_jpeg_frame else 0
    
    return jsonify({
        "active": video_stream_active,
        "has_frame": has_frame,
        "frame_size": frame_size,
        "drone_connected": drone_state.get("connected", False),
        "video_port": VIDEO_PORT,
        "drone_ip": DRONE_IP,
    }), 200


@app.route('/snapshot')
def snapshot():
    """Return the latest video frame as a single JPEG image."""
    with video_frame_lock:
        frame = latest_jpeg_frame
    
    if frame:
        return Response(frame, mimetype='image/jpeg', headers={
            'Cache-Control': 'no-cache',
            'Access-Control-Allow-Origin': '*',
        })
    else:
        return jsonify({"error": "No video frame available"}), 503


# ============================================================
# Main Entry Point
# ============================================================

if __name__ == '__main__':
    logger.info("=" * 60)
    logger.info("  LYZRC L200 ProMax Bridge Service v4.0")
    logger.info("  Protocol: Vison/Macrochip (VS GPS PRO)")
    logger.info("=" * 60)
    logger.info(f"  Drone WiFi Network: {DRONE_NETWORK}")
    logger.info(f"  Drone IP Address:   {DRONE_IP}")
    logger.info(f"  Command Port (UDP): {CMD_PORT}")
    logger.info(f"  Video Port (TCP):   {VIDEO_PORT}")
    logger.info(f"  Camera Port (UDP):  {CAMERA_PORT}")
    logger.info(f"  Bridge Port (HTTP): {BRIDGE_PORT}")
    logger.info(f"  Video Feed URL:     http://localhost:{BRIDGE_PORT}/video_feed")
    logger.info("=" * 60)
    logger.info("")
    logger.info("  PROTOCOL SEQUENCE:")
    logger.info("  1. Handshake: 0x0F→res, (BG,→fw, time_sync→timeok, 0x27→forceI")
    logger.info("  2. Heartbeat: 0x09+IP every 1s → expects 'ok' ACK")
    logger.info("  3. GPS: 5A 55 0F 01 + lat/lng/acc/hdg at 5Hz")
    logger.info("  4. Flight: 5A 55 08 02 + flags/axes in 50-pkt bursts")
    logger.info("  5. Camera: FF 35 19 0A + cmd_id on UDP 8088")
    logger.info("")
    logger.info("=" * 60)

    # Start background threads
    heartbeat_thread = threading.Thread(target=heartbeat_loop, daemon=True)
    heartbeat_thread.start()

    gps_thread = threading.Thread(target=gps_sender_loop, daemon=True)
    gps_thread.start()

    discovery_thread = threading.Thread(target=discovery_loop, daemon=True)
    discovery_thread.start()

    video_thread = threading.Thread(target=video_receiver_loop, daemon=True)
    video_thread.start()
    logger.info("[VIDEO] Video receiver thread launched")

    # Give threads time to initialize and attempt first connection
    time.sleep(2)

    # Start Flask server
    logger.info(f"Bridge API starting on port {BRIDGE_PORT}...")
    try:
        app.run(
            host='0.0.0.0',
            port=BRIDGE_PORT,
            debug=False,
            use_reloader=False,
            threaded=True
        )
    except KeyboardInterrupt:
        logger.info("Shutting down...")
        running = False
