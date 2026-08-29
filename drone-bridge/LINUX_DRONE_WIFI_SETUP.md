# L200 ProMax Drone WiFi Setup - Linux Specific Guide

This guide is specifically for **Linux users** (Ubuntu, Debian, Fedora, etc.) who need to connect to the L200 ProMax drone's WiFi network.

---

## Current Linux Network Status

From your diagnostic output, here's what we know:

```
IN-USE  BSSID              SSID                        MODE   CHAN  RATE        SIGNAL  BARS  SECURITY  
        98:A9:42:34:C0:A0  YesulikplimIT_Services      Infra  1     270 Mbit/s  100     ▂▄▆█  WPA1 WPA2 
        9C:B1:DC:16:41:8F  VS-GPS-BY-16418f            Infra  44    130 Mbit/s  89      ▂▄▆█  --        
*       98:A9:42:74:C0:A0  YesulikplimIT_MLS_Engineer  Infra  36    270 Mbit/s  84      ▂▄▆█  WPA2 WPA3
```

**Analysis**:
- ✓ Your computer is on **Channel 36** (5 GHz band)
- ✓ Your WiFi card supports 5 GHz (802.11ac)
- ✗ **Drone network is NOT visible** in the scan

---

## Why Drone Network is Not Appearing

The drone should broadcast on 5 GHz channels (typically 36, 40, 44, 48, 149, 153, 157, 161, 165). Since it's not appearing, one of these is true:

1. **Drone is powered OFF** ← Most likely
2. **Drone WiFi module is not initialized** ← Likely
3. **Drone is out of range** ← Less likely
4. **Drone WiFi module is broken** ← Least likely

---

## Solution: Linux WiFi Connection Steps

### Step 1: Power On the Drone (60 seconds)

1. **Locate the drone's power button**
   - Usually on the side or bottom of the fuselage
   - Press and hold for **3 seconds**
   - Listen for startup chime

2. **Wait for WiFi initialization**
   - Wait **60 seconds** for the WiFi module to boot
   - The drone's WiFi LED should start blinking (blue)
   - Check the drone's display (if equipped) for status

### Step 2: Scan for Drone Network (30 seconds)

Run this command to scan for the drone's WiFi network:

```bash
sudo nmcli dev wifi rescan
sleep 5
sudo nmcli dev wifi list
```

**Look for a network named**: `L200_ProMax_XXXXXX` (where XXXXXX is a unique ID)

**Expected output**:
```
IN-USE  BSSID              SSID                        MODE   CHAN  RATE        SIGNAL  BARS  SECURITY  
        XX:XX:XX:XX:XX:XX  L200_ProMax_XXXXXX          Infra  44    270 Mbit/s  Good    ▂▄▆█  WPA2
```

### Step 3: Connect to Drone WiFi (30 seconds)

If you see the drone network, connect to it using NetworkManager:

```bash
# Replace L200_ProMax_XXXXXX with the actual network name
sudo nmcli dev wifi connect L200_ProMax_XXXXXX password 12345678

# Or if no password:
sudo nmcli dev wifi connect L200_ProMax_XXXXXX
```

**Expected output**:
```
Device 'wlan0' successfully activated with 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'.
```

### Step 4: Verify Connection (30 seconds)

Verify you're connected to the drone's network:

```bash
# Check current connection
nmcli dev show wlan0 | grep -E "CONNECTION|IP4"

# Check IP address
ip addr show wlan0

# Ping the drone
ping -c 4 192.168.0.1
```

**Expected output for ping**:
```
PING 192.168.0.1 (192.168.0.1) 56(84) bytes of data.
64 bytes from 192.168.0.1: icmp_seq=1 ttl=64 time=5.2 ms
64 bytes from 192.168.0.1: icmp_seq=2 ttl=64 time=4.8 ms
64 bytes from 192.168.0.1: icmp_seq=3 ttl=64 time=5.1 ms
64 bytes from 192.168.0.1: icmp_seq=4 ttl=64 time=4.9 ms
```

---

## Troubleshooting for Linux

### Issue 1: Drone Network Still Not Appearing

**Solution**:

1. **Verify drone is powered on**
   ```bash
   # Check if you can see any new networks
   sudo nmcli dev wifi rescan
   sleep 10
   sudo nmcli dev wifi list | head -20
   ```

2. **Check for WiFi module issues**
   ```bash
   # Check if WiFi is enabled
   nmcli radio wifi
   
   # If off, turn it on
   nmcli radio wifi on
   ```

3. **Restart NetworkManager**
   ```bash
   sudo systemctl restart NetworkManager
   sleep 5
   sudo nmcli dev wifi rescan
   ```

4. **Check system logs for WiFi errors**
   ```bash
   journalctl -u NetworkManager -n 50 --no-pager
   ```

### Issue 2: Cannot Connect to Drone Network

**Solution**:

1. **Try without password**
   ```bash
   sudo nmcli dev wifi connect L200_ProMax_XXXXXX
   ```

2. **Try with different password**
   ```bash
   sudo nmcli dev wifi connect L200_ProMax_XXXXXX password 1234567890
   ```

3. **Forget the network and try again**
   ```bash
   sudo nmcli connection delete L200_ProMax_XXXXXX
   sudo nmcli dev wifi connect L200_ProMax_XXXXXX password 12345678
   ```

4. **Check WiFi card status**
   ```bash
   iwconfig wlan0
   ```

### Issue 3: Connected but Ping Fails

**Solution**:

1. **Check IP address**
   ```bash
   ip addr show wlan0
   ```
   You should see an IP like `192.168.0.2` or `192.168.0.100`

2. **Check routing**
   ```bash
   ip route
   ```
   You should see a route to `192.168.0.0/24`

3. **Check firewall**
   ```bash
   # Temporarily disable firewall
   sudo ufw disable
   
   # Try ping again
   ping -c 4 192.168.0.1
   
   # Re-enable firewall
   sudo ufw enable
   ```

4. **Check if another interface is interfering**
   ```bash
   # Disconnect Ethernet if connected
   sudo nmcli con down Wired\ connection\ 1
   
   # Try ping again
   ping -c 4 192.168.0.1
   ```

---

## Advanced Linux Commands

### Monitor WiFi Signal Strength

```bash
# Watch signal strength in real-time
watch -n 1 'nmcli dev wifi list | grep L200'
```

### View Detailed WiFi Information

```bash
# Show detailed info about connected network
nmcli con show

# Show detailed WiFi device info
nmcli dev show wlan0
```

### Scan for All 5 GHz Networks

```bash
# Show only 5 GHz networks
sudo nmcli dev wifi list | awk 'NR==1 || /36|40|44|48|149|153|157|161|165/'
```

### Check WiFi Driver

```bash
# Show WiFi driver info
lspci | grep -i network
lsusb | grep -i network

# Check driver module
lsmod | grep -i wifi
```

### View NetworkManager Logs

```bash
# Real-time NetworkManager logs
journalctl -u NetworkManager -f

# Last 100 lines
journalctl -u NetworkManager -n 100 --no-pager
```

---

## Linux Network Configuration Files

If you need to manually configure the connection, edit these files:

### Method 1: NetworkManager Configuration

```bash
# Edit NetworkManager connections
sudo nano /etc/NetworkManager/system-connections/L200_ProMax_XXXXXX.nmconnection
```

**Example content**:
```ini
[connection]
id=L200_ProMax_XXXXXX
type=wifi
interface-name=wlan0

[wifi]
ssid=L200_ProMax_XXXXXX
mode=infrastructure

[wifi-security]
key-mgmt=wpa-psk
psk=12345678

[ipv4]
method=auto

[ipv6]
method=auto
```

### Method 2: wpa_supplicant Configuration

```bash
# Edit wpa_supplicant config
sudo nano /etc/wpa_supplicant/wpa_supplicant.conf
```

**Add this block**:
```ini
network={
    ssid="L200_ProMax_XXXXXX"
    psk="12345678"
    key_mgmt=WPA-PSK
    priority=10
}
```

---

## After Successful Connection

Once you've successfully connected to the drone's WiFi:

1. **Start the bridge service**
   ```bash
   cd drone-bridge
   python bridge.py
   ```

2. **In another terminal, verify connection**
   ```bash
   curl http://localhost:5000/health
   ```

3. **Run automated tests**
   ```bash
   python drone-bridge/test_bridge.py
   ```

4. **Monitor telemetry**
   ```bash
   watch -n 1 'curl -s http://localhost:5000/telemetry | jq'
   ```

---

## Linux Specific Tips

1. **Use `nmcli` instead of GUI** for more reliable connections
2. **Disable IPv6** if you experience connection issues
3. **Use `wpa_cli`** for advanced WiFi troubleshooting
4. **Check `dmesg`** for hardware-level WiFi errors
5. **Use `iw`** for low-level WiFi debugging

---

## Quick Reference Commands

| Task | Command |
| :--- | :--- |
| Scan for networks | `sudo nmcli dev wifi rescan && nmcli dev wifi list` |
| Connect to network | `sudo nmcli dev wifi connect SSID password PASSWORD` |
| Disconnect | `sudo nmcli dev disconnect wlan0` |
| Show current connection | `nmcli con show --active` |
| Forget network | `sudo nmcli connection delete SSID` |
| Check IP | `ip addr show wlan0` |
| Ping drone | `ping -c 4 192.168.0.1` |
| Show WiFi info | `iwconfig wlan0` |
| Check driver | `lsmod \| grep -i wifi` |
| View logs | `journalctl -u NetworkManager -n 50` |

---

**Status**: ✅ Linux-Specific Guide Complete  
**Last Updated**: May 27, 2026
