#!/bin/bash

# Wildlife Detection System - Railway Deployment Script
# This script automates deployment to Railway

set -e

echo "🚀 Wildlife Detection System - Railway Deployment"
echo "=================================================="

# Check if Railway CLI is installed
if ! command -v railway &> /dev/null; then
    echo "❌ Railway CLI not found. Installing..."
    npm install -g @railway/cli
fi

# Check if user is logged in
if ! railway whoami &> /dev/null; then
    echo "🔐 Please log in to Railway..."
    railway login
fi

# Build the application
echo "🔨 Building application..."
pnpm install
pnpm build

# Create Railway project if it doesn't exist
echo "📦 Creating/linking Railway project..."
railway init

# Add PostgreSQL service
echo "🗄️  Adding PostgreSQL database..."
railway add --service postgres

# Set environment variables
echo "⚙️  Setting environment variables..."
railway variables set NODE_ENV=production
railway variables set VITE_APP_TITLE="Wildlife Guard"
railway variables set VITE_APP_ID="wildlife-prod"

# Prompt for sensitive variables
read -p "Enter EMAIL_USER: " EMAIL_USER
railway variables set EMAIL_USER="$EMAIL_USER"

read -sp "Enter EMAIL_PASSWORD: " EMAIL_PASSWORD
railway variables set EMAIL_PASSWORD="$EMAIL_PASSWORD"

read -sp "Enter JWT_SECRET (min 32 chars): " JWT_SECRET
railway variables set JWT_SECRET="$JWT_SECRET"

read -p "Enter DRONE_BRIDGE_URL (e.g., https://bridge.yourdomain.com): " DRONE_BRIDGE_URL
railway variables set DRONE_BRIDGE_URL="$DRONE_BRIDGE_URL"

# Deploy
echo "🚀 Deploying to Railway..."
railway up

echo "✅ Deployment complete!"
echo "📍 Your app is live at: $(railway domain)"
