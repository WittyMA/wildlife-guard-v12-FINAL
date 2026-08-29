# Wildlife Guard - Production Deployment & Operations Guide

This guide provides step-by-step instructions for deploying and operating the Wildlife Guard system in production environments. It is designed to be highly precise, practical, and optimized for field engineers and system administrators.

---

## 1. System Architecture & Flow

The system consists of a **Cloud Web Application** (handling user dashboards, AI analytics, and database management) and a **Local Drone Bridge** (running at the field base station to communicate with the physical L200 ProMax drone).

```
[Camera Stations / Web UI] ──(tRPC API)──► [Cloud Web App]
                                                │
                                        (DRONE_BRIDGE_URL)
                                                │
                                                ▼
[L200 ProMax Drone] ◄──(UDP Control/Telemetry)── [Local Drone Bridge]
```

---

## 2. Web Application Deployment (Cloud)

The main web application can be deployed to PaaS platforms like Railway, Render, or Heroku.

### Step 2.1: Database Provisioning
1. Provision a managed **PostgreSQL** database (e.g., Supabase, Neon, or Aiven).
2. Retrieve the connection string with SSL required. Example:
   `postgres://user:password@host:5432/dbname?sslmode=require`

### Step 2.2: Environment Configuration
Set up the following environment variables on your cloud hosting platform:

| Variable | Example Value | Description |
| :--- | :--- | :--- |
| `NODE_ENV` | `production` | Enables production builds and optimizations |
| `DATABASE_URL` | `postgres://avnadmin:...` | Secure connection string to your database |
| `JWT_SECRET` | `GvG91OszPrqc...` | High-entropy string for session tokens |
| `EMAIL_SERVICE` | `gmail` | SMTP provider for sending OTP login emails |
| `EMAIL_USER` | `wwanyizah@gmail.com` | Email address used to send OTPs |
| `EMAIL_PASSWORD` | `mdhwpetzkdcowbpf` | SMTP application-specific password |
| `DRONE_BRIDGE_URL` | `http://<base-station-ip>:5000` | Publicly accessible URL of the local bridge |

### Step 2.3: Build & Start
Run the following commands in your deployment pipeline:
```bash
# Install dependencies
pnpm install --frozen-lockfile

# Push schema and run migrations
pnpm db:migrate:custom

# Build client and server bundles
pnpm build

# Start production server
NODE_ENV=production node dist/index.js
```

---

## 3. Drone Bridge Deployment (Local Base Station)

The bridge service must run on a local computer (e.g., Raspberry Pi or Laptop) connected to the same WiFi network as the L200 ProMax drone.

### Step 3.1: Network Setup
1. Turn on the L200 ProMax drone.
2. Connect the base station computer to the drone's broadcast WiFi network (typically named `L200_ProMax_XXXX`).
3. Verify the base station can reach the drone:
   ```bash
   ping 192.168.0.1
   ```

### Step 3.2: Local Installation & Launch
1. Navigate to the `drone-bridge` directory:
   ```bash
   cd drone-bridge
   ```
2. Install the lightweight dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Run the bridge service:
   ```bash
   python bridge.py
   ```

### Step 3.3: Docker Deployment (Alternative)
For isolated containerized environments:
```bash
# Build the Docker container
docker build -t wildlife-drone-bridge:latest .

# Run the container with host network access
docker run -d \
  --name drone-bridge \
  --network host \
  -p 5000:5000 \
  -p 8080:8080 \
  wildlife-drone-bridge:latest
```

---

## 4. Verification & Testing

Once both services are deployed, perform these checks to ensure full system functionality:

1. **Verify Bridge Health**:
   ```bash
   curl http://localhost:5000/health
   ```
   *Expected response:* `{"healthy": true, "drone_status": "connected"}`

2. **Verify GPS Stream**:
   ```bash
   curl http://localhost:5000/telemetry/gps
   ```
   *Expected response:* Returns current real-time GPS coordinates of the drone.

3. **Run Automated Test Suite**:
   ```bash
   python drone-bridge/test_bridge.py
   ```
   This script runs 9 separate integration tests to verify connectivity, telemetry streams, and command validation.
