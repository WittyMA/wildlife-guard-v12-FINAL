#!/bin/bash

# Wildlife Detection System - Vercel Deployment Script

set -e

echo "🚀 Wildlife Detection System - Vercel Deployment"
echo "================================================"

# Check if Vercel CLI is installed
if ! command -v vercel &> /dev/null; then
    echo "❌ Vercel CLI not found. Installing..."
    npm install -g vercel
fi

# Build the application
echo "🔨 Building application..."
pnpm install
pnpm build

# Deploy to Vercel
echo "🚀 Deploying to Vercel..."
vercel --prod

echo "✅ Deployment complete!"
echo "📍 Visit your dashboard to configure environment variables"
echo "   https://vercel.com/dashboard"
