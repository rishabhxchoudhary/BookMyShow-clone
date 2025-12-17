#!/bin/bash

# BookMyShow Shows Generator Setup and Run Script

echo "🎬 Setting up BookMyShow Shows Generator..."

# Create virtual environment if it doesn't exist
if [ ! -d "scripts/venv" ]; then
    echo "📦 Creating virtual environment..."
    python3 -m venv scripts/venv
fi

# Activate virtual environment
source scripts/venv/bin/activate

# Install requirements
echo "📥 Installing requirements..."
pip install -r scripts/requirements.txt

# Make the script executable
chmod +x scripts/generate_shows.py

# Run the generator
echo "🚀 Running shows generator..."
python scripts/generate_shows.py $1

echo "✅ Done! Check your application now."