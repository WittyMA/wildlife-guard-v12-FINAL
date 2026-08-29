# L200 ProMax WiFi Connection & Pairing Guide

This guide provides step-by-step instructions for establishing a reliable wireless connection between the physical **L200 ProMax Drone** and the local **Bridge Service** (running on your base station computer, Raspberry Pi, or laptop).

---

## 1. Understanding the L200 ProMax Network Architecture

The L200 ProMax drone acts as a **wireless access point (AP)**. When powered on, it broadcasts its own WiFi network. The base station computer running the Bridge Service must connect to this WiFi network as a **client** to send commands and receive telemetry data.

```
┌─────────────────────────────────┐                 ┌─────────────────────────────────┐
│        L200 ProMax Drone        │                 │      Base Station Computer      │
│     (Wireless Access Point)     │                 │        (Wireless Client)        │
│                                 │                 │                                 │
│  - Broadcasts SSID:             │  ◄─── WiFi ──── │  - Connects to Drone SSID       │
│    L200_ProMax_XXXXXX           │      5 GHz      │  - Runs Bridge Service          │
│  - Static IP: 192.168.0.1       │                 │  - Receives Telemetry (Port 8080)│
│  - Command Port: 8800 (UDP)     │                 │  - Sends Commands (Port 8800)   │
└─────────────────────────────────┘                 └─────────────────────────────────┘
```

---

## 2. Step-by-Step Connection Procedure

Follow these steps to connect your base station computer to the drone:

### Step 2.1: Power On the Drone
1. Insert a fully charged battery into the L200 ProMax drone.
2. Press and hold the power button on the drone for **3 seconds** until the LEDs flash and the startup chime plays.
3. Wait **30 seconds** for the drone's internal flight controller and WiFi module to fully boot up.

### Step 2.2: Scan and Connect to Drone WiFi
1. On your base station computer, open your operating system's WiFi connection settings.
2. Scan for available networks and locate the drone's network. It will typically be named:
   `L200_ProMax_XXXXXX` (where `XXXXXX` is a unique identifier).
3. Connect to this network. 
   - *Note*: If prompted for a password, refer to your drone's manual (commonly `12345678` or passwordless).
   - *Important*: Since the drone's WiFi does not provide internet access, your operating system may show a warning like *"Connected, no internet"*. This is **expected and correct**. Do not disconnect.

### Step 2.3: Verify IP Assignment
1. Open a terminal or command prompt on your base station computer.
2. Check your assigned IP address to ensure you are on the same subnet (`192.168.0.X`):
   - **Linux/macOS**: `ifconfig` or `ip a`
   - **Windows**: `ipconfig`
3. Your computer should be assigned an IP address like `192.168.0.2` or `192.168.0.100`.

### Step 2.4: Ping the Drone
1. Verify network connectivity by pinging the drone's static IP (`192.168.0.1`):
   ```bash
   ping 192.168.0.1
   ```
2. If you receive responses, your network connection is successfully established.

---

## 3. Troubleshooting Connection Failures

If your bridge service still reports `drone_status: disconnected`, use the table below to diagnose and resolve the issue:

| Symptom | Potential Cause | Solution |
| :--- | :--- | :--- |
| **Drone SSID does not appear in WiFi list** | Drone is still booting | Wait 30-45 seconds after powering on the drone. |
| | Low battery | Replace the drone battery with a fully charged one. |
| | 5 GHz WiFi incompatibility | Ensure your computer's wireless card supports **5 GHz (802.11ac)** networks. |
| **WiFi connects but disconnects immediately** | OS "Auto-Switch" feature | Disable "Auto-Switch" or "Smart Network Switch" in your OS WiFi settings. This feature disconnects from networks without internet. |
| **Ping to 192.168.0.1 fails** | IP address conflict | Ensure no other network interface (like Ethernet) is using the `192.168.0.X` subnet. |
| | Firewall blocking traffic | Temporarily disable your firewall or add rules to allow UDP traffic on ports `8800` and `8080`. |
| **Ping succeeds but telemetry is disconnected** | Telemetry port blocked | Ensure UDP port `8080` is open and not being used by another application on your computer. |

---

## 4. Advanced: Dual-Network Configuration (Internet + Drone)

If your base station needs to connect to the drone **and** maintain an internet connection to sync with the cloud web application, you have two options:

### Option 4.1: Two Network Interfaces (Recommended)
1. Use your computer's **Ethernet port** or a **second USB WiFi adapter** to connect to your local office/field router for internet access.
2. Use your computer's **primary built-in WiFi** to connect directly to the drone's `L200_ProMax_XXXXXX` network.
3. The operating system will automatically route internet traffic through the default gateway (router) and drone traffic through the WiFi interface.

### Option 4.2: Field Router Bridging
1. Configure a portable field router (e.g., GL.iNet travel router) to act as a **repeater/bridge**.
2. Connect the field router to the drone's WiFi.
3. Connect your base station computer and your internet gateway to the field router.
4. This allows all devices to be on a single unified network with both internet and drone access.

---

## 5. Verification Checklist

Once connected, run these quick commands to verify the system is fully operational:

```bash
# 1. Test network connectivity to drone
ping -c 4 192.168.0.1

# 2. Check if bridge service is receiving telemetry
curl http://localhost:5000/health

# 3. View live telemetry data stream
curl http://localhost:5000/telemetry

# 4. Run the automated integration test suite
python drone-bridge/test_bridge.py
```

# 5. Check if UDP telemetry packets are arriving
sudo tcpdump -i any -n udp port 8080
```
