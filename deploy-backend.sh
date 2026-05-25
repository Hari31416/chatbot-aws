#!/bin/bash
set -e

STACK_NAME="${STACK_NAME:-chat}"
AWS_REGION="${AWS_REGION:-ap-south-1}"
S3_VECTOR_BUCKET_NAME="${S3_VECTOR_BUCKET_NAME:-chatbot-vectors-prod}"
S3_VECTOR_INDEX_NAME="${S3_VECTOR_INDEX_NAME:-enterprise-kb}"
LITELLM_EMBEDDING_MODEL="${LITELLM_EMBEDDING_MODEL:-gemini/gemini-embedding-2}"
EMBEDDING_DIMENSION="${EMBEDDING_DIMENSION:-768}"

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
sam deploy \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION"

echo "========================================="
echo "🧠 4. Initializing S3 Vectors RAG storage..."
echo "========================================="
cd backend
uv run python scripts/init_rag_storage.py \
  --region "$AWS_REGION" \
  --bucket "$S3_VECTOR_BUCKET_NAME" \
  --index "$S3_VECTOR_INDEX_NAME" \
  --embedding-model "$LITELLM_EMBEDDING_MODEL" \
  --dimension "$EMBEDDING_DIMENSION"
cd ..

echo "========================================="
echo "🎉 Backend and infrastructure deployed successfully!"
echo "========================================="
