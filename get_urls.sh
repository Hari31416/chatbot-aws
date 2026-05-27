#!/bin/bash
set -e

echo "========================================="
echo "🔍 1. Fetching active AWS stack outputs..."
echo "========================================="
STACK_NAME="${1:-chat}" # Default to "chat", or pass stack name as the first argument
AWS_REGION="${AWS_REGION:-ap-south-1}"

# Retrieve ApiUrl, FunctionUrl, FrontendBucket and FrontendUrl
API_URL=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" \
  --output text)

FUNCTION_URL=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='FunctionUrl'].OutputValue" \
  --output text)

FRONTEND_BUCKET=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='FrontendBucket'].OutputValue" \
  --output text)

FRONTEND_URL=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='FrontendUrl'].OutputValue" \
  --output text)

echo "📌 Active Backend API URL: $API_URL"
echo "📌 Streaming Function URL: $FUNCTION_URL"
echo "📌 Target S3 Bucket: $FRONTEND_BUCKET"
echo "📌 Website URL: $FRONTEND_URL"

# Create .env.local file for React app
cat > .env.local <<EOL
VITE_API_BASE_URL=$API_URL
VITE_FUNCTION_URL=$FUNCTION_URL
EOL