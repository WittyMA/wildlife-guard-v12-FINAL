#!/bin/bash

################################################################################
# L200 ProMax Drone - Quick Connect Diagnostic Script
# Purpose: Identify the drone's WiFi network and verify connection
# Usage: bash QUICK_CONNECT_DIAGNOSTIC.sh
################################################################################

echo "╔════════════════════════════════════════════════════════════════════════════╗"
echo "║         L200 ProMax Drone - WiFi Connection Diagnostic Tool              ║"
echo "╚════════════════════════════════════════════════════════════════════════════╝"
echo ""

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Step 1: Check current WiFi connection
echo -e "${BLUE}[STEP 1] Checking current WiFi connection...${NC}"
echo ""

if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    CURRENT_SSID=$(/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport -I | grep SSID | awk '{print $2}')
    echo -e "Current SSID: ${YELLOW}$CURRENT_SSID${NC}"
    echo -e "Current IP: $(ifconfig | grep -A 1 'inet ' | grep -v 127.0.0.1 | awk '{print $2}')"
    echo ""
    
    # Step 2: Scan for available networks
    echo -e "${BLUE}[STEP 2] Scanning for available WiFi networks...${NC}"
    echo ""
    /System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport -s | grep -E "L200|ProMax|192|5GHz" || /System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport -s
    
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux
    CURRENT_SSID=$(nmcli -t -f active,ssid dev wifi | grep '^yes' | cut -d: -f2)
    echo -e "Current SSID: ${YELLOW}$CURRENT_SSID${NC}"
    CURRENT_IP=$(hostname -I | awk '{print $1}')
    echo -e "Current IP: $CURRENT_IP"
    echo ""
    
    # Step 2: Scan for available networks
    echo -e "${BLUE}[STEP 2] Scanning for available WiFi networks...${NC}"
    echo ""
    sudo nmcli dev wifi list | grep -E "L200|ProMax" || sudo nmcli dev wifi list
    
elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
    # Windows
    echo -e "Current SSID: ${YELLOW}$(netsh wlan show interfaces | grep SSID | awk '{print $NF}')${NC}"
    echo ""
    
    # Step 2: Scan for available networks
    echo -e "${BLUE}[STEP 2] Scanning for available WiFi networks...${NC}"
    echo ""
    netsh wlan show networks
fi

echo ""
echo "╔════════════════════════════════════════════════════════════════════════════╗"
echo "║                         IMPORTANT INSTRUCTIONS                            ║"
echo "╚════════════════════════════════════════════════════════════════════════════╝"
echo ""
echo -e "${YELLOW}ACTION REQUIRED:${NC}"
echo ""
echo "1. Look for a network named: ${GREEN}L200_ProMax_XXXXXX${NC} (where XXXXXX is a unique ID)"
echo "   - This network should support 5 GHz (802.11ac)"
echo "   - Signal strength should be 'Good' or better"
echo ""
echo "2. If you see the drone network:"
echo "   - Disconnect from your current network (${YELLOW}$CURRENT_SSID${NC})"
echo "   - Connect to the drone's WiFi network"
echo "   - Password is usually: ${GREEN}12345678${NC} or leave blank"
echo ""
echo "3. After connecting to the drone WiFi:"
echo "   - Run this command to verify: ${GREEN}ping 192.168.0.1${NC}"
echo "   - You should see responses with latency < 10ms"
echo ""
echo "4. If you see the drone network but cannot connect:"
echo "   - Check if your WiFi card supports 5 GHz"
echo "   - Try moving closer to the drone"
echo "   - Power cycle the drone (turn off, wait 10 seconds, turn on)"
echo ""
echo "5. If you don't see the drone network:"
echo "   - Power on the drone and wait 45-60 seconds for WiFi to initialize"
echo "   - Check if the drone battery is fully charged"
echo "   - Verify the drone's WiFi module is enabled"
echo ""

# Step 3: Check if already on drone network
echo ""
echo -e "${BLUE}[STEP 3] Checking if connected to drone network...${NC}"
echo ""

if [[ "$CURRENT_SSID" == *"L200"* ]] || [[ "$CURRENT_SSID" == *"ProMax"* ]]; then
    echo -e "${GREEN}✓ SUCCESS: You are connected to the drone network!${NC}"
    echo ""
    echo "Testing connection to drone..."
    if ping -c 1 192.168.0.1 &> /dev/null; then
        echo -e "${GREEN}✓ Drone is reachable at 192.168.0.1${NC}"
        echo ""
        echo "Next steps:"
        echo "  1. Start the bridge service: cd drone-bridge && python bridge.py"
        echo "  2. In another terminal, check status: curl http://localhost:5000/health"
        echo "  3. Run tests: python drone-bridge/test_bridge.py"
    else
        echo -e "${RED}✗ Drone is NOT reachable at 192.168.0.1${NC}"
        echo "  - Check if you're on the correct subnet (should be 192.168.0.X)"
        echo "  - Try pinging again: ping 192.168.0.1"
    fi
else
    echo -e "${RED}✗ You are NOT connected to the drone network${NC}"
    echo ""
    echo "Current network: ${YELLOW}$CURRENT_SSID${NC}"
    echo "Current IP subnet: ${YELLOW}$(echo $CURRENT_IP | cut -d. -f1-3)${NC}"
    echo ""
    echo -e "${YELLOW}ACTION: Please connect to the drone's WiFi network first.${NC}"
    echo ""
    echo "Instructions:"
    echo "  1. Look for network: ${GREEN}L200_ProMax_XXXXXX${NC}"
    echo "  2. Disconnect from: ${YELLOW}$CURRENT_SSID${NC}"
    echo "  3. Connect to drone network"
    echo "  4. Run this script again to verify"
fi

echo ""
echo "╔════════════════════════════════════════════════════════════════════════════╗"
echo "║                      Troubleshooting Information                          ║"
echo "╚════════════════════════════════════════════════════════════════════════════╝"
echo ""
echo "If you're having issues, check:"
echo ""
echo "1. Drone Status:"
echo "   - Power LED should be ON (solid or blinking)"
echo "   - WiFi LED should be blinking (indicating active connections)"
echo "   - Battery level should be > 20%"
echo ""
echo "2. Computer WiFi Card:"
echo "   - Must support 5 GHz (802.11ac)"
echo "   - Must support WPA2 security"
echo "   - Should have good signal strength"
echo ""
echo "3. Network Interference:"
echo "   - Move away from other WiFi networks"
echo "   - Avoid areas with high RF interference"
echo "   - Keep drone within 10 meters of base station"
echo ""
echo "4. Firewall/Security:"
echo "   - Temporarily disable firewall to test"
echo "   - Ensure UDP ports 8080 and 8800 are not blocked"
echo ""
echo "For detailed troubleshooting, see: DRONE_CONNECTION_SOLUTIONS.md"
echo ""
