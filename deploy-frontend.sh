#!/bin/bash
set -e

echo "========================================="
echo "🔍 1. Fetching active AWS stack outputs..."
echo "========================================="
STACK_NAME="${1:-${STACK_NAME:-chat}}" # Default to "chat", or pass stack name as the first argument
AWS_REGION="${AWS_REGION:-ap-south-1}"

# Retrieve FunctionUrl, FrontendBucket and FrontendUrl
API_URL=$(aws cloudformation describe-stacks \
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

# Fallbacks in case CloudFormation stack output is not yet updated in the cloud
if [ -z "$FRONTEND_BUCKET" ] || [ "$FRONTEND_BUCKET" == "None" ]; then
  FRONTEND_BUCKET="chat-hari31416"
fi

if [ -z "$FRONTEND_URL" ] || [ "$FRONTEND_URL" == "None" ]; then
  FRONTEND_URL="http://chat-hari31416.s3-website.ap-south-1.amazonaws.com"
fi

echo "📌 Active Backend API URL: $API_URL"
echo "📌 Target S3 Bucket: $FRONTEND_BUCKET"
echo "📌 Website URL: $FRONTEND_URL"
echo "📌 AWS Region: $AWS_REGION"

echo "========================================="
echo "⚛️ 2. Building React frontend..."
echo "========================================="
cd frontend
if [ -n "${VITE_CLERK_PUBLISHABLE_KEY:-}" ]; then
  VITE_API_BASE_URL="$API_URL" VITE_CLERK_PUBLISHABLE_KEY="$VITE_CLERK_PUBLISHABLE_KEY" pnpm build
else
  VITE_API_BASE_URL="$API_URL" pnpm build
fi
cd ..

echo "========================================="
echo "📤 3. Syncing build files to S3 bucket..."
echo "========================================="
aws s3 sync frontend/dist/ s3://"$FRONTEND_BUCKET"/ --delete

echo "=========================================================="
echo "🎉 Frontend deploy successful!"
echo "👉 Your Serverless Chatbot is live at: $FRONTEND_URL"
echo "=========================================================="
