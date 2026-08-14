#!/bin/bash

echo "=================================================="
echo "  Forma-Korea-Map Extension - Build Script        "
echo "=================================================="

# 1. Build Frontend for Production
echo ""
echo "[1/2] Building Frontend (React + Vite)..."
cd frontend || exit
npm run build
cd ..
echo "Frontend build completed. Static assets are in 'frontend/dist/'"

# 2. Build Backend Docker Image
echo ""
echo "[2/2] Building Backend Docker Image..."
cd backend || exit
docker build -t forma-korea-map-backend:latest .
cd ..
echo "Backend Docker image 'forma-korea-map-backend:latest' created."

echo ""
echo "=================================================="
echo "  Build Complete!                                 "
echo "=================================================="
echo "- To deploy frontend, host the 'frontend/dist' folder (e.g., Vercel, Netlify, S3)."
echo "- To deploy backend, run the docker image: "
echo "  docker run -p 8000:8000 --env-file backend/.env forma-korea-map-backend"
echo "=================================================="
