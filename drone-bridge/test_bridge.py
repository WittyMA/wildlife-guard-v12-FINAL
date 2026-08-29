"""
L200 ProMax Bridge Service v4.0 - Test Suite
Tests the Vison/Macrochip protocol bridge endpoints and connectivity.
"""

import requests
import socket
import struct
import sys
import time

BRIDGE_URL = "http://localhost:5000"
DRONE_IP = "172.16.10.1"
CMD_PORT = 8080

passed = 0
failed = 0


def test(name, condition, detail=""):
    global passed, failed
    if condition:
        passed += 1
        print(f"  \u2705 PASS: {name}")
    else:
        failed += 1
        print(f"  \u274c FAIL: {name} {f'({detail})' if detail else ''}")


def section(title):
    print(f"\n{'='*50}")
    print(f"  {title}")
    print(f"{'='*50}")


# ============================================================
# Test 1: Bridge Connectivity
# ============================================================
section("1. Bridge Service Connectivity")

try:
    r = requests.get(f"{BRIDGE_URL}/", timeout=5)
    test("Root endpoint responds", r.status_code == 200)
    data = r.json()
    test("Service name correct", data.get("service") == "L200 ProMax Bridge Service")
    test("Version is 4.0", data.get("version") == "4.0")
    test("Protocol identified", "Vison" in data.get("protocol", ""))
    test("Drone model correct", "L200" in data.get("drone_model", ""))
    test("Drone IP configured", data.get("drone_ip") == DRONE_IP)
    test("Ports configured", data.get("ports", {}).get("command_control_udp") == CMD_PORT)
except Exception as e:
    test("Bridge reachable", False, str(e))

# ============================================================
# Test 2: Health Check
# ============================================================
section("2. Health Check")

try:
    r = requests.get(f"{BRIDGE_URL}/health", timeout=5)
    test("Health endpoint responds", r.status_code == 200)
    data = r.json()
    test("Has healthy field", "healthy" in data)
    test("Has drone_status", "drone_status" in data)
    test("Has protocol field", data.get("protocol") == "Vison/Macrochip")
    test("Has heartbeat status", "heartbeat_active" in data)
    test("Has timestamp", "timestamp" in data)
    print(f"       -> Drone status: {data.get('drone_status')}")
    print(f"       -> Healthy: {data.get('healthy')}")
    print(f"       -> Heartbeat: {data.get('heartbeat_active')}")
except Exception as e:
    test("Health check", False, str(e))

# ============================================================
# Test 3: Telemetry
# ============================================================
section("3. Telemetry Data")

try:
    r = requests.get(f"{BRIDGE_URL}/telemetry", timeout=5)
    test("Telemetry endpoint responds", r.status_code == 200)
    data = r.json()
    test("Has GPS latitude", "lat" in data)
    test("Has GPS longitude", "lng" in data)
    test("Has altitude", "altitude" in data)
    test("Has battery", "battery" in data)
    test("Has status", "status" in data)
    test("Has gps_satellites", "gps_satellites" in data)
    print(f"       -> Status: {data.get('status')}")
    print(f"       -> GPS: {data.get('lat')}, {data.get('lng')}")
    print(f"       -> Satellites: {data.get('gps_satellites')}")
except Exception as e:
    test("Telemetry", False, str(e))

# ============================================================
# Test 4: GPS Endpoint
# ============================================================
section("4. GPS Data")

try:
    r = requests.get(f"{BRIDGE_URL}/telemetry/gps", timeout=5)
    test("GPS endpoint responds", r.status_code == 200)
    data = r.json()
    test("Has latitude", "latitude" in data)
    test("Has longitude", "longitude" in data)
    test("Has satellites", "satellites" in data)
    test("Has accuracy", "accuracy" in data)
    test("Has gps_mode", "gps_mode" in data)
    print(f"       -> GPS Mode: {data.get('gps_mode')}")
    print(f"       -> Accuracy: {data.get('accuracy')}m")
except Exception as e:
    test("GPS", False, str(e))

# ============================================================
# Test 5: Status
# ============================================================
section("5. Comprehensive Status")

try:
    r = requests.get(f"{BRIDGE_URL}/status", timeout=5)
    test("Status endpoint responds", r.status_code == 200)
    data = r.json()
    test("Has bridge section", "bridge" in data)
    test("Has drone section", "drone" in data)
    test("Has gps section", "gps" in data)
    test("Has network section", "network" in data)
    test("Protocol correct", data.get("bridge", {}).get("protocol") == "Vison/Macrochip")
    print(f"       -> Handshake: {data.get('bridge', {}).get('handshake_complete')}")
    print(f"       -> Firmware: {data.get('drone', {}).get('firmware')}")
    print(f"       -> Resolution: {data.get('drone', {}).get('resolution')}")
except Exception as e:
    test("Status", False, str(e))

# ============================================================
# Test 6: Configuration
# ============================================================
section("6. Configuration")

try:
    r = requests.get(f"{BRIDGE_URL}/config", timeout=5)
    test("Config endpoint responds", r.status_code == 200)
    data = r.json()
    test("Has protocol_details", "protocol_details" in data)
    test("Has timing info", "timing" in data)
    test("Heartbeat format documented", "09" in data.get("protocol_details", {}).get("heartbeat_format", ""))
    test("GPS format documented", "5A 55" in data.get("protocol_details", {}).get("gps_format", ""))
    print(f"       -> Protocol: {data.get('protocol')}")
except Exception as e:
    test("Config", False, str(e))

# ============================================================
# Test 7: Command Validation
# ============================================================
section("7. Command Handling")

try:
    # Test invalid command
    r = requests.post(f"{BRIDGE_URL}/command", json={"command": "invalid_xyz"}, timeout=5)
    test("Invalid command returns 400", r.status_code == 400)
    data = r.json()
    test("Error message present", "error" in data)
    test("Available commands listed", "available_commands" in data)

    # Test valid command format (photo - safe to send)
    r = requests.post(f"{BRIDGE_URL}/command", json={"command": "photo"}, timeout=5)
    test("Photo command accepted", r.status_code == 200)
    data = r.json()
    test("Command success", data.get("success") == True)
    test("Protocol info included", "protocol" in data)
    print(f"       -> Response: {data.get('message')}")
except Exception as e:
    test("Commands", False, str(e))

# ============================================================
# Test 8: 404 Handling
# ============================================================
section("8. Error Handling")

try:
    r = requests.get(f"{BRIDGE_URL}/nonexistent", timeout=5)
    test("404 returns JSON", r.status_code == 404)
    data = r.json()
    test("Error field present", "error" in data)
    test("Available endpoints listed", "available_endpoints" in data)
except Exception as e:
    test("404 handling", False, str(e))

# ============================================================
# Test 9: Drone Network Connectivity
# ============================================================
section("9. Drone Network Connectivity")

try:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.connect((DRONE_IP, CMD_PORT))
    local_ip = s.getsockname()[0]
    s.close()
    test("On drone subnet", local_ip.startswith("172.16.10."))
    print(f"       -> Local IP: {local_ip}")
except Exception as e:
    test("Network check", False, str(e))

try:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(3)
    result = s.connect_ex((DRONE_IP, 80))
    s.close()
    test("Drone TCP:80 reachable", result == 0)
except Exception as e:
    test("Drone TCP reachable", False, str(e))

try:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.settimeout(3)
    s.sendto(bytes([0x0F]), (DRONE_IP, CMD_PORT))
    try:
        data, addr = s.recvfrom(1024)
        test("Drone UDP:8080 responds", True)
        resp = data.decode('utf-8', errors='ignore').strip()
        print(f"       -> Response: '{resp}'")
    except socket.timeout:
        test("Drone UDP:8080 responds", False, "timeout - drone may not support this command variant")
    s.close()
except Exception as e:
    test("Drone UDP protocol", False, str(e))

# ============================================================
# Test 10: Connect Endpoint
# ============================================================
section("10. Manual Connect")

try:
    r = requests.post(f"{BRIDGE_URL}/connect", timeout=10)
    test("Connect endpoint responds", r.status_code in [200, 503])
    data = r.json()
    if r.status_code == 200:
        test("Connection initiated", data.get("success") == True)
        print(f"       -> {data.get('message')}")
    else:
        test("Proper error returned", "error" in data)
        print(f"       -> {data.get('error')}")
except Exception as e:
    test("Connect endpoint", False, str(e))


# ============================================================
# Summary
# ============================================================
print(f"\n{'='*50}")
print(f"  TEST RESULTS")
print(f"{'='*50}")
print(f"  Passed: {passed}")
print(f"  Failed: {failed}")
print(f"  Total:  {passed + failed}")
print(f"{'='*50}")

if failed == 0:
    print(f"\n  ALL TESTS PASSED!")
else:
    print(f"\n  {failed} test(s) failed")

print(f"\n  Bridge: {BRIDGE_URL}")
print(f"  Drone:  {DRONE_IP}:{CMD_PORT}")
print(f"  Protocol: Vison/Macrochip (VS GPS PRO)")
print()

sys.exit(0 if failed == 0 else 1)
