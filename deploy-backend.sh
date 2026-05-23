#!/bin/bash
set -e

echo "========================================="
echo "📦 1. Exporting backend requirements..."
echo "========================================="
cd backend
uv export --format requirements-txt --no-hashes --no-emit-project -o requirements.txt
cd ..

echo "========================================="
echo "🛠️ 2. Building SAM AWS resources..."
echo "========================================="
sam build --use-container

echo "========================================="
echo "☁️ 3. Deploying infrastructure to AWS..."
echo "========================================="
sam deploy

echo "========================================="
echo "🎉 Backend and infrastructure deployed successfully!"
echo "========================================="
