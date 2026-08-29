# L200 ProMax Connection Verification & Field Testing Procedures

This guide provides field engineers and drone operators with standard operating procedures (SOP) to verify and test the communication link between the **L200 ProMax Drone** and the **Bridge Service** before deployment.

---

## 1. Pre-Flight Verification Checklist

Before taking off, complete this verification checklist to ensure all systems are communicating properly:

| Check Item | Command / Action | Expected Result | Status |
| :--- | :--- | :--- | :---: |
| **1. Physical Connection** | Connect base station to drone WiFi | Connected to `L200_ProMax_XXXXXX` | [ ] |
| **2. Network Ping** | `ping -c 4 192.168.0.1` | 0% packet loss, latency < 10ms | [ ] |
| **3. Bridge Service** | `curl http://localhost:5000/health` | `{"healthy": true, "drone_status": "connected"}` | [ ] |
| **4. Telemetry Stream** | `curl http://localhost:5000/telemetry` | Valid battery, signal, and GPS coordinates | [ ] |
| **5. GPS Lock** | `curl http://localhost:5000/telemetry/gps` | Satellites ≥ 6, coordinates != `0.0, 0.0` | [ ] |
| **6. Automated Tests** | `python test_bridge.py` | `8/8 tests passed` | [ ] |

---

## 2. Real-Time Telemetry Monitoring

To monitor the connection quality in real-time during a mission, use the following tools:

### 2.1: Watch Telemetry Updates
You can continuously poll the bridge telemetry endpoint to monitor battery and GPS status:
```bash
# Poll telemetry every 1 second
watch -n 1 curl -s http://localhost:5000/telemetry
```

### 2.2: Analyze Network Traffic
Use `tcpdump` to verify that raw UDP telemetry packets are arriving on port `8080`:
```bash
# Monitor UDP traffic on port 8080
sudo tcpdump -i any -n udp port 8080 -X
```
*Note*: You should see a stream of hex data arriving approximately every 100ms (10 Hz).

---

## 3. Automated Test Execution

The bridge service includes a comprehensive automated test suite (`test_bridge.py`) that simulates various network conditions and commands.

### Running the Test Suite:
1. Ensure the bridge service is running (`python bridge.py`).
2. Run the test suite:
   ```bash
   python test_bridge.py
   ```
3. *Expected Output*:
   ```
   ============================================================
     Test Summary
   ============================================================
   ✓ Connectivity: PASS
   ✓ Health Check: PASS
   ✓ Telemetry: PASS
   ✓ GPS: PASS
   ✓ Status: PASS
   ✓ Configuration: PASS
   ✓ Invalid Command: PASS
   ✓ 404 Handling: PASS

   Total: 8/8 tests passed
   ✓ All tests passed!
   ```

---

## 4. Field Range Testing

Before conducting autonomous missions, perform a range test to determine the reliable communication boundaries of your base station WiFi antenna:

1. Place the drone on a landing pad.
2. Walk away with the base station computer in 50-meter increments.
3. At each increment, check the signal strength and telemetry packet rate:
   ```bash
   curl -s http://localhost:5000/telemetry | grep signal
   ```
4. Note the distance where signal strength drops below **30%** or packet loss begins. This is your maximum safe operating range for the current environment.
