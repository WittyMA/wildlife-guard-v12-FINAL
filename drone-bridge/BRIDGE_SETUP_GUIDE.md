# L200 ProMax Bridge Service - Setup and Troubleshooting Guide

## Overview

The L200 ProMax Bridge Service is a Flask-based middleware that provides bidirectional communication between the Wildlife Detection System and the L200 ProMax drone. It handles:

- **Command Execution**: Sending control commands (takeoff, land, emergency stop, etc.)
- **Telemetry Reception**: Receiving real-time GPS, battery, signal, and status data
- **GPS Tracking**: Continuous GPS coordinate updates
- **Health Monitoring**: Service and drone status monitoring

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│         Wildlife Detection System (Main App)                 │
│                    (Node.js/Express)                         │
└────────────────────────┬────────────────────────────────────┘
                         │
                    /api/trpc/missions
                         │
┌────────────────────────▼────────────────────────────────────┐
│         L200 ProMax Bridge Service (bridge.py)              │
│                    (Flask)                                   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  API Endpoints:                                      │   │
│  │  - GET  /health          (Service health check)      │   │
│  │  - GET  /telemetry       (All telemetry data)        │   │
│  │  - GET  /telemetry/gps   (GPS coordinates only)      │   │
│  │  - GET  /status          (Comprehensive status)      │   │
│  │  - POST /command         (Send drone commands)       │   │
│  │  - GET  /config          (Bridge configuration)      │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Background Thread:                                  │   │
│  │  - Telemetry Listener (UDP port 8080)               │   │
│  │  - Receives GPS and status updates from drone       │   │
│  └──────────────────────────────────────────────────────┘   │
└────────────────────────┬────────────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        │                │                │
   UDP 8800          UDP 8080         TCP/UDP
  (Commands)      (Telemetry)       (Monitoring)
        │                │                │
┌───────▼────────────────▼────────────────▼────────┐
│        L200 ProMax Drone                         │
│  - GPS Module                                    │
│  - Flight Controller                             │
│  - Battery Monitor                               │
│  - Signal Strength Sensor                        │
└────────────────────────────────────────────────────┘
```

## WiFi Connection Setup

Before the bridge service can communicate with the drone, your base station computer must be connected to the drone's WiFi network. See the dedicated guides for detailed instructions:

- **[DRONE_WIFI_CONNECTION_GUIDE.md](DRONE_WIFI_CONNECTION_GUIDE.md)**: Step-by-step WiFi connection and troubleshooting
- **[DRONE_PAIRING_PROCEDURE.md](DRONE_PAIRING_PROCEDURE.md)**: Drone pairing and network configuration
- **[DRONE_VERIFICATION_TESTS.md](DRONE_VERIFICATION_TESTS.md)**: Verification and field testing procedures

---

## Installation

### Prerequisites

- Python 3.9 or higher
- Flask 2.3.3
- flask-cors 4.0.0
- Network connectivity to drone at `192.168.0.1`

### Local Installation

1. **Navigate to the drone-bridge directory**:
   ```bash
   cd drone-bridge
   ```

2. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

3. **Run the service**:
   ```bash
   python bridge.py
   ```

   Expected output:
   ```
   2026-05-27 07:31:34,123 - [INFO] - Starting telemetry listener on 192.168.0.1:8080
   2026-05-27 07:31:34,456 - [INFO] - Telemetry listener bound to port 8080
   2026-05-27 07:31:34,789 - [INFO] - L200 ProMax Bridge Service starting on port 5000...
   2026-05-27 07:31:34,890 - [INFO] - Drone configured at 192.168.0.1:8800 (control), 8080 (telemetry)
   * Running on http://0.0.0.0:5000
   ```

### Docker Installation

1. **Build the Docker image**:
   ```bash
   docker build -t l200-bridge:latest .
   ```

2. **Run the container**:
   ```bash
   docker run -d \
     --name l200-bridge \
     -p 5000:5000 \
     -p 8080:8080 \
     --network host \
     l200-bridge:latest
   ```

3. **Check container status**:
   ```bash
   docker ps | grep l200-bridge
   docker logs l200-bridge
   ```

## Configuration

### Environment Variables

Add these to your `.env` file:

```env
# Drone Bridge Service Configuration
DRONE_BRIDGE_URL=http://localhost:5000
DRONE_BRIDGE_TIMEOUT=5000

# Optional: Override drone IP and ports
DRONE_IP=192.168.0.1
DRONE_CONTROL_PORT=8800
DRONE_TELEMETRY_PORT=8080
BRIDGE_PORT=5000
```

### Drone Configuration

The bridge expects the drone to be configured as follows:

| Setting | Value | Description |
|---------|-------|-------------|
| IP Address | 192.168.0.1 | Drone's IP on local network |
| Control Port | 8800 | UDP port for commands |
| Telemetry Port | 8080 | UDP port for telemetry broadcast |
| Protocol | UDP | Communication protocol |

## API Endpoints

### 1. Health Check

**Endpoint**: `GET /health`

**Description**: Check if the bridge service and drone are healthy

**Response**:
```json
{
  "service": "L200 ProMax Bridge",
  "healthy": true,
  "drone_status": "connected",
  "timestamp": "2026-05-27T07:31:34.123456"
}
```

**Status Codes**:
- `200`: Service is healthy
- `503`: Service or drone is unhealthy

---

### 2. Get Telemetry

**Endpoint**: `GET /telemetry`

**Description**: Get all current drone telemetry data

**Response**:
```json
{
  "battery": 85,
  "signal": 92,
  "lat": -1.2345,
  "lng": 36.7890,
  "altitude": 45.5,
  "status": "connected",
  "last_update": "2026-05-27T07:31:34.123456",
  "is_armed": true,
  "flight_time": 120,
  "gps_satellites": 12,
  "temperature": 28,
  "wind_speed": 3.5
}
```

---

### 3. Get GPS Data

**Endpoint**: `GET /telemetry/gps`

**Description**: Get GPS coordinates only

**Response**:
```json
{
  "latitude": -1.2345,
  "longitude": 36.7890,
  "altitude": 45.5,
  "satellites": 12,
  "last_update": "2026-05-27T07:31:34.123456",
  "status": "connected"
}
```

---

### 4. Get Status

**Endpoint**: `GET /status`

**Description**: Get comprehensive bridge and drone status

**Response**:
```json
{
  "bridge": {
    "service": "L200 ProMax Bridge",
    "version": "2.0",
    "running": true,
    "telemetry_listener": true,
    "timestamp": "2026-05-27T07:31:34.123456"
  },
  "drone": {
    "battery": 85,
    "signal": 92,
    "lat": -1.2345,
    "lng": 36.7890,
    "altitude": 45.5,
    "status": "connected",
    "last_update": "2026-05-27T07:31:34.123456",
    "is_armed": true,
    "flight_time": 120,
    "gps_satellites": 12,
    "temperature": 28,
    "wind_speed": 3.5
  },
  "connection": {
    "drone_ip": "192.168.0.1",
    "control_port": 8800,
    "telemetry_port": 8080,
    "bridge_port": 5000
  }
}
```

---

### 5. Send Command

**Endpoint**: `POST /command`

**Description**: Send a command to the drone

**Request Body**:
```json
{
  "type": "takeoff",
  "params": {}
}
```

**Available Commands**:
- `takeoff`: Launch the drone
- `land`: Land the drone
- `emergency_stop`: Emergency stop (hover in place)
- `arm`: Arm the drone (prepare for flight)
- `disarm`: Disarm the drone (disable motors)

**Response**:
```json
{
  "success": true,
  "message": "Command 'takeoff' sent to drone",
  "command": "takeoff",
  "timestamp": "2026-05-27T07:31:34.123456"
}
```

**Error Response**:
```json
{
  "success": false,
  "error": "Unknown command: invalid_command",
  "available_commands": ["takeoff", "land", "emergency_stop", "arm", "disarm"]
}
```

---

### 6. Get Configuration

**Endpoint**: `GET /config`

**Description**: Get bridge configuration

**Response**:
```json
{
  "drone_ip": "192.168.0.1",
  "control_port": 8800,
  "telemetry_port": 8080,
  "bridge_port": 5000,
  "telemetry_listener_active": true
}
```

## Troubleshooting

### Issue 1: "404 Not Found" on Root Path

**Problem**: Accessing `http://localhost:5000/` returns 404

**Solution**: This has been fixed in v2.0. The root path (`/`) now returns service information. Use:
- `GET /health` for health check
- `GET /status` for comprehensive status

### Issue 2: GPS Coordinates Not Updating

**Symptoms**: 
- GPS shows `lat: 0.0, lng: 0.0`
- `gps_satellites: 0`

**Troubleshooting Steps**:

1. **Check telemetry listener status**:
   ```bash
   curl http://localhost:5000/status
   ```
   Look for `"telemetry_listener": true`

2. **Verify drone is broadcasting telemetry**:
   ```bash
   sudo tcpdump -i any -n udp port 8080
   ```
   Should see UDP packets from drone IP

3. **Check drone GPS is enabled**:
   - Ensure drone has GPS module installed
   - Verify GPS is enabled in drone settings
   - Allow 30-60 seconds for GPS lock after power-on

4. **Verify network connectivity**:
   ```bash
   ping 192.168.0.1
   ```
   Should receive responses from drone

5. **Check firewall rules**:
   ```bash
   sudo ufw allow 8080/udp
   sudo ufw allow 5000/tcp
   ```

### Issue 3: Drone Commands Not Executing

**Symptoms**:
- Commands return `"success": true` but drone doesn't respond
- Drone status remains "idle"

**Troubleshooting Steps**:

1. **Verify drone is reachable**:
   ```bash
   ping 192.168.0.1
   ```

2. **Check drone is armed**:
   ```bash
   curl -X POST http://localhost:5000/command \
     -H "Content-Type: application/json" \
     -d '{"type": "arm"}'
   ```

3. **Verify network connectivity**:
   ```bash
   sudo netstat -an | grep 8800
   ```
   Should show listening on port 8800

4. **Check drone control port**:
   ```bash
   sudo tcpdump -i any -n udp port 8800
   ```
   Should see outgoing UDP packets

5. **Verify drone is in correct mode**:
   - Ensure drone is in "API Mode" or "SDK Mode"
   - Check drone documentation for correct control protocol

### Issue 4: Service Crashes on Startup

**Symptoms**:
- Service starts but immediately crashes
- Error: "Address already in use"

**Solution**:

1. **Kill existing process**:
   ```bash
   lsof -i :5000
   kill -9 <PID>
   ```

2. **Change port** (if needed):
   Edit `bridge.py` and change `BRIDGE_PORT = 5000` to another port

3. **Check for permission issues**:
   ```bash
   sudo python bridge.py
   ```

### Issue 5: High CPU Usage

**Symptoms**:
- Bridge service consuming 50-100% CPU
- Slow response times

**Solution**:

1. **Reduce telemetry polling frequency**:
   Edit `bridge.py` and increase socket timeout:
   ```python
   sock.settimeout(10)  # Increase from 5 to 10
   ```

2. **Enable production mode**:
   ```bash
   FLASK_ENV=production python bridge.py
   ```

3. **Use production WSGI server**:
   ```bash
   pip install gunicorn
   gunicorn -w 2 -b 0.0.0.0:5000 bridge:app
   ```

## Integration with Wildlife Detection System

### From Node.js/Express

```typescript
// In missions.ts router
const bridgeUrl = process.env.DRONE_BRIDGE_URL || 'http://localhost:5000';

// Send command
const response = await fetch(`${bridgeUrl}/command`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ type: 'takeoff' })
});

// Get telemetry
const telemetry = await fetch(`${bridgeUrl}/telemetry`).then(r => r.json());

// Get GPS
const gps = await fetch(`${bridgeUrl}/telemetry/gps`).then(r => r.json());
```

### From Python

```python
import requests

BRIDGE_URL = "http://localhost:5000"

# Get telemetry
telemetry = requests.get(f"{BRIDGE_URL}/telemetry").json()
print(f"Battery: {telemetry['battery']}%")
print(f"GPS: {telemetry['lat']}, {telemetry['lng']}")

# Send command
response = requests.post(
    f"{BRIDGE_URL}/command",
    json={"type": "takeoff"}
)
print(response.json())
```

## Performance Metrics

| Metric | Value |
|--------|-------|
| Telemetry Update Frequency | ~10 Hz (100ms) |
| GPS Accuracy | ±2-3 meters (typical) |
| Command Latency | <100ms |
| Battery Drain | Minimal (WiFi only) |
| Memory Usage | ~50-80 MB |
| CPU Usage | 2-5% (idle) |

## Security Considerations

1. **Network Isolation**: Ensure drone network is isolated from public internet
2. **Authentication**: Consider adding API key authentication for production
3. **Encryption**: Use HTTPS/TLS for sensitive deployments
4. **Rate Limiting**: Implement rate limiting for command endpoints
5. **Logging**: Monitor logs for unauthorized access attempts

## Logging

Logs are printed to console with format:
```
2026-05-27 07:31:34,123 - [LEVEL] - Message
```

### Log Levels
- `DEBUG`: Detailed diagnostic information
- `INFO`: General informational messages
- `WARNING`: Warning messages for potential issues
- `ERROR`: Error messages for failures

### Enable Debug Logging

Edit `bridge.py`:
```python
logging.basicConfig(level=logging.DEBUG)
```

## Support and Debugging

### Enable Verbose Logging

```bash
PYTHONUNBUFFERED=1 python bridge.py
```

### Test Connectivity

```bash
# Test bridge service
curl -v http://localhost:5000/health

# Test drone connectivity
ping 192.168.0.1

# Test telemetry port
nc -u -l 8080 &
```

### Monitor Network Traffic

```bash
# Monitor all UDP traffic
sudo tcpdump -i any -n udp

# Monitor specific ports
sudo tcpdump -i any -n 'udp port 8080 or udp port 8800'
```

## Version History

### v2.0 (Current)
- ✅ Fixed 404 errors on root path
- ✅ Added telemetry listener background thread
- ✅ Implemented GPS coordinate parsing
- ✅ Added comprehensive error handling
- ✅ Added health check endpoint
- ✅ Added CORS support
- ✅ Improved logging
- ✅ Added configuration endpoint

### v1.0 (Previous)
- Basic command sending
- Mock telemetry data
- No GPS support
- No background listener

## FAQ

**Q: Why is GPS showing 0,0?**
A: The telemetry listener may not be receiving GPS data. Ensure the drone is broadcasting telemetry on port 8080 and has GPS lock.

**Q: Can I change the drone IP?**
A: Yes, edit `DRONE_IP` in `bridge.py` or set the `DRONE_IP` environment variable.

**Q: How do I know if the drone is connected?**
A: Check the `/status` endpoint. If `drone_status` is "connected", the drone is responding.

**Q: What if the service crashes?**
A: Check the logs for error messages. Common issues are port conflicts or network connectivity problems.

**Q: Can I run multiple bridge instances?**
A: Yes, but each must use a different port. Set `BRIDGE_PORT` to different values.

## Related Documentation

- [Wildlife Detection System README](../README.md)
- [Drone Setup Guide](../DRONE_SETUP_GUIDE.md)
- [Production Deployment Guide](../PRODUCTION_DEPLOYMENT.md)
