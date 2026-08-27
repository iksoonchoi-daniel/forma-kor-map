#!/bin/bash

echo "=================================================="
echo "  Forma-Korea-Map Extension - Development Server  "
echo "=================================================="

# Helper function to cleanup background processes on exit
cleanup() {
    echo ""
    echo "Stopping servers..."
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
    exit
}

# Trap Ctrl+C (SIGINT) to run cleanup
trap cleanup INT

# 1. Start Backend Server
echo "Starting Backend API Server (FastAPI)..."
cd backend || exit
source venv/bin/activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8001 &
BACKEND_PID=$!
cd ..

# 2. Start Frontend Server
echo "Starting Frontend Development Server (Vite)..."
cd frontend || exit
npm run dev &
FRONTEND_PID=$!
cd ..

echo ""
echo "✅ Servers are successfully running!"
echo "➡️  Backend Docs (Swagger) : http://localhost:8001/docs"
echo "➡️  Frontend App URL       : http://localhost:3501"
echo "🛑 Press [Ctrl+C] to stop both servers."
echo ""

# Keep the script running to wait for background processes
wait
