# L200 ProMax Drone Pairing & Network Configuration Guide

This guide details the network pairing procedure to configure and register the **L200 ProMax Drone** with your local base station. This ensures secure, authorized, and reliable communication.

---

## 1. Pre-Pairing Requirements

Before starting the pairing process, ensure you have the following:

- **L200 ProMax Drone** with a fully charged battery.
- **Base Station Computer** (Laptop/Raspberry Pi) with WiFi capability.
- **Micro-USB / USB-C Cable** (for initial configuration, if wireless pairing fails).
- **Bridge Service** installed and running on port `5000`.

---

## 2. Wireless Pairing Procedure (Standard)

The wireless pairing procedure uses the drone's default access point mode to configure the secure pairing keys.

```
┌─────────────────┐                      ┌─────────────────┐
│   Base Station  │                      │   L200 ProMax   │
│  Bridge Service │                      │      Drone      │
└────────┬────────┘                      └────────┬────────┘
         │                                        │
         │ ─── 1. Connect to Drone WiFi ────────► │
         │                                        │
         │ ─── 2. POST /command (arm) ──────────► │
         │                                        │
         │ ◄─── 3. Telemetry Stream (UDP 8080) ── │
         │                                        │
         │ ─── 4. Pairing Confirmed ────────────► │
```

### Step 2.1: Establish Network Link
1. Power on the drone and wait for the status LED to flash blue (indicating pairing mode).
2. Connect your base station's WiFi to the `L200_ProMax_XXXXXX` network.
3. Verify connection by pinging the drone's gateway IP:
   ```bash
   ping 192.168.0.1
   ```

### Step 2.2: Send Pairing Initialization Command
1. Send an initial `arm` command via the bridge API to establish the session handshake:
   ```bash
   curl -X POST http://localhost:5000/command \
        -H "Content-Type: application/json" \
        -d '{"command": "arm"}'
   ```
2. *Expected Response*:
   ```json
   {
     "success": true,
     "message": "Command 'arm' sent successfully to drone"
   }
   ```

### Step 2.3: Verify Telemetry Stream
1. Once the handshake is complete, the drone will begin broadcasting telemetry packets to UDP port `8080`.
2. Check the bridge status to verify telemetry reception:
   ```bash
   curl http://localhost:5000/status
   ```
3. Confirm that `drone_status` is `connected` and the telemetry timestamp is updating.

---

## 3. Wired Configuration & Pairing (Fallback)

If wireless pairing fails or if you need to configure a custom static IP address on the drone, use the wired connection interface.

### Step 3.1: Connect Hardware
1. Connect the drone to your computer using a high-quality USB data cable.
2. The drone will mount as a virtual network interface (CDC-ECM/RNDIS).
3. The drone's default IP address over the wired interface is `192.168.1.1`.

### Step 3.2: Configure Network Interface
1. Set a static IP on your computer's virtual network interface:
   - **IP Address**: `192.168.1.2`
   - **Subnet Mask**: `255.255.255.0`
   - **Gateway**: `192.168.1.1`
2. Test connection:
   ```bash
   ping 192.168.1.1
   ```

### Step 3.3: Apply Custom Configuration
If you need to change the drone's WiFi channel, SSID, or password, you can upload a custom configuration file via the bridge service or use the serial command interface.

---

## 4. Security & Access Control

To prevent unauthorized access to the drone in the field, implement the following security measures:

### 4.1: Change Default WiFi SSID and Password
By default, the drone's WiFi network is open. To secure it:
1. Access the drone's web configuration portal (if available) at `http://192.168.0.1`.
2. Navigate to **Network Settings**.
3. Set a secure WPA2 password and change the SSID to a custom identifier (e.g., `Wildlife_Guard_Drone_01`).
4. Update your base station connection settings with the new credentials.

### 4.2: Firewall Rules
Configure your base station's firewall to only allow communication from the drone's IP address:
```bash
# Allow incoming UDP telemetry from drone
sudo ufw allow proto udp from 192.168.0.1 to any port 8080

# Block all other incoming traffic on telemetry port
sudo ufw deny proto udp from any to any port 8080
```
