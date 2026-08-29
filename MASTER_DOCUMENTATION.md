# Wildlife Guard - Complete Master Documentation

This document serves as the **unified single source of truth** for the Wildlife Guard system. It consolidates all previous guides, eliminating duplications, and provides a clear, precise path for deployment, drone integration, and system maintenance.

---

## 1. System Architecture

The Wildlife Guard system is designed as a distributed architecture consisting of three main components:

| Component | Technology Stack | Location | Purpose |
| :--- | :--- | :--- | :--- |
| **Web Application** | React, TypeScript, TailwindCSS, Express, tRPC | Cloud / Local Server | Main dashboard, AI inference interface, mission control, and user management |
| **Database** | PostgreSQL, Drizzle ORM | Cloud (Supabase, Aiven, Neon) | Persistent storage for users, camera stations, detections, and drone missions |
| **Drone Bridge** | Python (Flask), UDP Sockets | Local Base Station (Raspberry Pi / Laptop) | Local gateway communicating with the L200 ProMax drone via local WiFi |

```
┌─────────────────────────────────────────────────────────────┐
│             Wildlife Guard Web Application                  │
│                     (Node.js/Express)                       │
└────────────────────────┬────────────────────────────────────┘
                         │
                    /api/trpc/missions
                         │
┌────────────────────────▼────────────────────────────────────┐
│         L200 ProMax Bridge Service (bridge.py)              │
│                     (Python/Flask)                          │
└────────────────────────┬────────────────────────────────────┘
                         │
        ┌────────────────┴────────────────┐
   UDP 8800 (Commands)              UDP 8080 (Telemetry)
        │                                 │
┌───────▼─────────────────────────────────▼───────────────────┐
│                    L200 ProMax Drone                        │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Environment Configuration

The application requires a configured `.env` file in the root directory. Below is the precise configuration structure:

```env
# Database Configuration
DATABASE_URL=postgres://avnadmin:PASSWORD@host:port/defaultdb?sslmode=require

# Firebase Configuration (Optional - For Push Notifications)
FIREBASE_PROJECT_ID=wildlife-security-camera
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_PRIVATE_KEY_ID=49411abe896b4bd55dae3b8b5c526ec89e3f3b0c
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-fbsvc@wildlife-security-camera.iam.gserviceaccount.com

# Email Configuration (For OTP Login)
EMAIL_SERVICE=gmail
EMAIL_USER=wwanyizah@gmail.com
EMAIL_PASSWORD=mdhwpetzkdcowbpf

# Drone Bridge Service Configuration
DRONE_BRIDGE_URL=http://localhost:5000
DRONE_BRIDGE_TIMEOUT=5000

# Security & Application Settings
JWT_SECRET=GvG91OszPrqcBNrA46HSUK7qDZBxYemfjdyC+NPdOAM=
VITE_APP_ID=wildlife-conservation-pwa
VITE_APP_TITLE="Wildlife Guard"
VITE_APP_LOGO=https://example.com/logo.png
NODE_ENV=development
```

---

## 3. Database Schema

The system uses Drizzle ORM to manage the PostgreSQL database schema. The database contains 8 core tables:

1. **`users`**: Manages ranger accounts, roles (`admin`, `ranger`), and authentication status.
2. **`camera_stations`**: Stores geographical locations and status of camera feeds.
3. **`detection_events`**: Logs AI detections (human, animal, vehicle, anonymous, dark_environment, blurry_image).
4. **`drone_missions`**: Tracks drone deployments, target coordinates, status, and verification results.
5. **`ranger_contacts`**: Stores contact info and Firebase Cloud Messaging (FCM) tokens for push notifications.
6. **`offline_sync_queue`**: Queues local detections when internet connection is lost.
7. **`system_logs`**: Logs system activities and errors for audit.
8. **`drone_telemetry`**: Stores cached telemetry history from the drone.

---

## 4. Deployment Guides

### 4.1 Development Environment Setup

To run the system locally for development or testing:

1. **Install Dependencies**:
   Ensure you have Node.js 18+ and `pnpm` installed.
   ```bash
   pnpm install
   ```

2. **Run Database Migrations**:
   ```bash
   pnpm db:migrate:custom
   ```

3. **Start Development Server**:
   ```bash
   pnpm dev
   ```
   The application will be available at `http://localhost:3000`.

### 4.2 Production Deployment (Cloud)

For deploying the main web application to cloud platforms (Vercel, Railway, Render, etc.):

1. **Build the Application**:
   ```bash
   pnpm build
   ```
   This generates a static client build in `dist/public` and compiles the Express server to `dist/index.js`.

2. **Configure Production Environment**:
   Set `NODE_ENV=production` and ensure all database and email credentials in the environment variables are correctly pointed to production resources.

3. **Run Production Server**:
   ```bash
   NODE_ENV=production node dist/index.js
   ```

---

## 5. L200 ProMax Drone Bridge Integration

The local bridge service (`bridge.py`) acts as the translator between the cloud application and the physical drone.

### 5.1 Bridge Service Setup

1. **Navigate to Bridge Directory**:
   ```bash
   cd drone-bridge
   ```

2. **Install Python Dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

3. **Start the Bridge Service**:
   ```bash
   python bridge.py
   ```
   The service will start on port `5000` and spawn a background thread listening for UDP telemetry on port `8080`.

### 5.2 API Reference

| Endpoint | Method | Description | Response Format |
| :--- | :--- | :--- | :--- |
| `/health` | `GET` | Verifies bridge and drone status | `{"healthy": true, "drone_status": "connected"}` |
| `/telemetry` | `GET` | Returns all cached telemetry | `{"battery": 85, "lat": -1.23, "lng": 36.78, ...}` |
| `/telemetry/gps` | `GET` | Returns GPS coordinates only | `{"latitude": -1.23, "longitude": 36.78, ...}` |
| `/command` | `POST` | Sends hex command to drone | `{"success": true, "message": "Command sent"}` |

### 5.3 Troubleshooting Drone Connection

- **GPS Coordinates Show `0.0, 0.0`**: Ensure the drone has a clear view of the sky to acquire a GPS lock. It may take 30-60 seconds after power-on.
- **Commands Fail**: Verify the drone's IP address (`192.168.0.1`) is reachable by pinging it from the bridge server. Ensure the drone is armed before sending flight commands.
