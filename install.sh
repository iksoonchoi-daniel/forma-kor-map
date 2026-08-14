#!/bin/bash

echo "=================================================="
echo "  Forma-Korea-Map Extension - Installation Script "
echo "=================================================="

# 1. Backend Setup
echo ""
echo "[1/2] Setting up Backend Virtual Environment & Dependencies..."
cd backend || exit

# Create virtual environment if it doesn't exist
if [ ! -d "venv" ]; then
    python3 -m venv venv
    echo "Created virtual environment 'venv'."
fi

# Activate virtual environment and install requirements
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

# Create .env if it doesn't exist
if [ ! -f .env ]; then
    cp .env.example .env
    echo "Created backend/.env file."
    echo "⚠️  ACTION REQUIRED: Please open backend/.env and update VWORLD_API_KEY."
fi

# Deactivate virtual environment
deactivate
cd ..

# 2. Frontend Setup
echo ""
echo "[2/2] Setting up Frontend Dependencies..."
cd frontend || exit

# Install NPM packages
npm install

# Create .env if it doesn't exist
if [ ! -f .env ]; then
    cp .env.example .env
    echo "Created frontend/.env file."
fi
cd ..

echo ""
echo "=================================================="
echo "  Installation Complete!                          "
echo "  You can now run './run.sh' to start the app.    "
echo "=================================================="
