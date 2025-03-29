#!/bin/bash
# Install script for SpeechFunctionCaller

# Install frontend
echo "Installing frontend..."
cd frontend
npm install
cd ..

# Install backend
echo "Building backend..."
cd backend
./gradlew build
cd ..

echo "Installation complete!"