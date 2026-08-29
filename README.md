# Wildlife Guard - Automated Wildlife Detection & Drone Trigger System

Wildlife Guard is a state-of-the-art Progressive Web Application (PWA) designed to protect wildlife and monitor conservation areas. It uses local AI inference to detect humans, vehicles, and animals, automatically triggering aerial drone missions for verification when critical threats are detected.

---

## 🚀 Quick Start

### 1. Web Application (Cloud/Server)

```bash
# Install dependencies
pnpm install

# Run database migrations
pnpm db:migrate:custom

# Start development server
pnpm dev
```

The application dashboard will be available at `http://localhost:3000`.

### 2. Drone Bridge Service (Local Base Station)

```bash
# Navigate to the bridge directory
cd drone-bridge

# Install Python dependencies
pip install -r requirements.txt

# Run the bridge service
python bridge.py
```

The local drone gateway will start on port `5000` and communicate with the L200 ProMax drone.

---

## 📚 Documentation & Guides

To keep our documentation precise, clear, and free of duplication, we have consolidated all instructions into single sources of truth:

- **[MASTER_DOCUMENTATION.md](MASTER_DOCUMENTATION.md)**: The **ultimate single source of truth** for system architecture, database schemas, API references, and deployment steps.
- **[drone-bridge/BRIDGE_SETUP_GUIDE.md](drone-bridge/BRIDGE_SETUP_GUIDE.md)**: Detailed hardware configuration, local network setups, and deep-dive troubleshooting for the L200 ProMax drone.
- **[FIXES_APPLIED.md](FIXES_APPLIED.md)**: Detailed technical log of the fixes implemented to resolve GPS connectivity, 404 errors, and system stability issues.

---

## 🛠️ Tech Stack

- **Frontend**: React, TypeScript, TailwindCSS, Vite
- **Backend**: Node.js, Express, tRPC
- **Database**: PostgreSQL, Drizzle ORM
- **Drone Bridge**: Python (Flask), UDP Sockets
- **Push Notifications**: Firebase Cloud Messaging (FCM)
- **Authentication**: Passwordless Email OTP (Gmail SMTP)
