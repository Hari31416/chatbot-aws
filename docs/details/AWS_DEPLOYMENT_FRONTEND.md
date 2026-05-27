# Chatbot AWS — Frontend Deployment Guide

This document details the architecture, setup, compilation, and cloud deployment of our professional **Vite + React + TypeScript** chatbot client. For rapid prototyping and simplicity, the frontend is deployed as a **Public S3 Static Website**, eliminating CDN propagation delays during updates.

---

## 1. Static Web Hosting Architecture

```
Browser (User)
  │
  ├── GET index.html / CSS / JS  ──► Amazon S3 Static Website Hosting
  │                                    (Bucket: chat-hari31416)
  │
  ├── GET/POST REST APIs ─────────► AWS API Gateway (Secured by Cognito)
  │
  └── POST /chat/stream (SSE) ────► AWS Lambda Function URL (In-App PyJWT)
```

The frontend runs entirely client-side in the user's browser. It is compiled into static HTML, CSS, and JS chunks and hosted directly in an Amazon S3 bucket configured for website hosting.

### AWS Services & Configurations

| AWS Component       | Configuration                            | Purpose                                       |
| ------------------- | ---------------------------------------- | --------------------------------------------- |
| **S3 Bucket**       | `chatbot-frontend-<AccountId>-<Env>`     | Direct asset storage                          |
| **Website Hosting** | `Index: index.html`, `Error: index.html` | Handles root loading and single-page routing  |
| **Public Access**   | `BlockPublicAccess: false`               | Allows the public to fetch website files      |
| **Bucket Policy**   | `PublicReadGetObject`                    | Allows read-only `s3:GetObject` access to `*` |

---

## 2. Environment Configurations

Vite environments inject variables during build-time (bundling). We configure these variables inside `/frontend/.env` locally or via the CLI in production.

- **`PORT`**: Dev server port (default `3000`).
- **`ALLOWED_HOSTS`**: Authorized hostnames for Vite local server.
- **`VITE_API_BASE_URL`**: Deployed AWS API Gateway base URL.
- **`VITE_COGNITO_USER_POOL_ID`**: Active AWS Cognito User Pool.
- **`VITE_COGNITO_CLIENT_ID`**: Active AWS Cognito Client App ID (without secrets).
- **`VITE_AWS_REGION`**: AWS deployment region (e.g., `ap-south-1`).

---

## 3. Deployment Orchestration

We have automated the deployment pipeline using modular shell scripts and a root `Makefile` to allow isolated frontend builds.

### The Deployment Scripts

1.  **[deploy-frontend.sh](file:///Users/hari/Desktop/sandbox/chatbot-aws/deploy-frontend.sh)**:
    - Queries CloudFormation stack outputs using the AWS CLI for the active stack (accepts an optional first command-line argument like `chat-staging` to specify the target environment, defaulting to `chat`).
    - Retrieves the active `ApiUrl`, `FrontendBucket`, `UserPoolId`, and `UserPoolClientId`.
    - Falls back to your custom S3 bucket name `chat-hari31416` if stack outputs are not yet populated.
    - Compiles Vite, injecting these variables dynamically at build-time.
    - Syncs the `/dist` directory to the target S3 bucket using `aws s3 sync` and deletes stale files.

---

## 4. How to Deploy

You can deploy the frontend to various target environments by running the orchestration scripts.

### Deploying to Production (Default "chat" stack)

Using the root **`Makefile`**, you can deploy changes to your production stack immediately:

```bash
# 1. Create S3 Bucket configuration (First-time only)
make create-bucket

# 2. Compile and upload default production stack
make deploy-frontend
```

Or directly call the shell script:

```bash
./deploy-frontend.sh
```

### Deploying to Staging (Separate "chat-staging" stack)

If you have deployed a separate staging stack (`chat-staging`) using Option C, compile and sync specifically to the staging S3 bucket:

```bash
./deploy-frontend.sh chat-staging
```

---

## 5. Manual Build & Upload Reference

If you prefer to compile and upload the assets manually without the Makefile recipes:

```bash
# 1. CD into frontend
cd frontend

# 2. Build the production build by setting env variables
VITE_API_BASE_URL="https://<api-gateway-id>.execute-api.ap-south-1.amazonaws.com" \
VITE_COGNITO_USER_POOL_ID="ap-south-1_xxxxxxxxx" \
VITE_COGNITO_CLIENT_ID="xxxxxxxxxxxxxxxxxxxxxxxxxx" \
VITE_AWS_REGION="ap-south-1" \
pnpm build

# 3. Sync to S3 using AWS CLI
aws s3 sync dist/ s3://chat-hari31416/ --delete
```

Once uploaded, the web application is live instantly at your S3 Website endpoint:
👉 `http://chat-hari31416.s3-website.ap-south-1.amazonaws.com`
