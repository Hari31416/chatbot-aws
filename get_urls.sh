#!/bin/bash
set -e

echo "========================================="
echo "🔍 1. Fetching active AWS stack outputs..."
echo "========================================="
STACK_NAME="${1:-chat}" # Default to "chat", or pass stack name as the first argument
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

COGNITO_USER_POOL_ID=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" \
  --output text)

COGNITO_CLIENT_ID=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolClientId'].OutputValue" \
  --output text)

echo "📌 Active Backend API URL: $API_URL"
echo "📌 Target S3 Bucket: $FRONTEND_BUCKET"
echo "📌 Website URL: $FRONTEND_URL"
echo "📌 Cognito User Pool ID: $COGNITO_USER_POOL_ID"
echo "📌 Cognito Client ID: $COGNITO_CLIENT_ID"

# Create .env.local file for React app
cat > .env.local <<EOL
VITE_API_BASE_URL=$API_URL
VITE_COGNITO_USER_POOL_ID=$COGNITO_USER_POOL_ID
VITE_COGNITO_CLIENT_ID=$COGNITO_CLIENT_ID
EOL