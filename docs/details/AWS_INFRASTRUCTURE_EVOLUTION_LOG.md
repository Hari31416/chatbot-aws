# AWS Infrastructure & Codebase Evolution Log

This document records the incremental engineering decisions, bug resolutions, and structural milestones that shaped this serverless chatbot application. By tracing the Git history and the evolution of both `template.yaml` and files in the `docs/` directory, this report documents the "how" and "why" behind the codebase's current state.

---

## Evolution Timeline Summary

The project evolved from a standard, single-tier request-response API to a highly optimized, dual-routing real-time streaming platform.

```
       Initial Commit (cae0abe)
                │
                ▼ (Added standard FastAPI + Mangum REST routes on API Gateway)
       S3 Website & Makefile Deployments (2968618)
                │
                ▼ (CloudFront CDN simplified to direct S3 Web Hosting to bypass CDN lags)
       Secure Cognito Authentication (07fe0c4)
                │
                ▼ (Cognito edge integration; proxy routes split to bypass OPTIONS checks)
       Dummy User Account Provisioning (e22dffe)
                │
                ▼ (CLI scripts to bypass FORCE_CHANGE_PASSWORD state)
       Gemini 3.1 Flash Vision Routing (dc6d940)
                │
                ▼ (SSM secure keys and IAM read policies added)
       Costing Gotchas Guide (9285422)
                │
                ▼ (CloudWatch log retention and DynamoDB provisioning adjustments)
       Serverless Persistent Chat History CRUD (21fd4fa)
                │
                ▼ (Added UserConversationsIndex GSI to eliminate database table scans)
       Response Streaming Implementation (0cc8469)
                │
                ▼ (Lambda Function URL, LWA Layer, and PyJWT in-app authentication)
       LWA Boot & CORS Conflict Fix (21962c0)
                │
                ▼ (FastAPI CORSMiddleware alignment; run.sh virtualenv PATH fixes)
       Frontend Modular Decomposition (ec2764d)
                │
                ▼ (S3 Vectors retrieval endpoints and chat-time RAG prompt injection)
       S3 Vectors RAG Baseline
```

---

## 1. Initial Setup: FastAPI + Mangum Core

- **Commit:** `cae0abe` (Initial commit of chatbot-aws project)
- **What We Built:**
  - Standard FastAPI server with a modular architecture (`app/`, `api/`, `models/`, `services/`, `repositories/`, `utils/`).
  - Integrated `LiteLLM` for LLM provider abstraction, enabling unified model calls.
  - Deployed `template.yaml` with a single `ChatbotBackendFunction` mapped to an API Gateway HTTP API v2 proxy route.
  - Integrated `Mangum` as an ASGI-to-Lambda adapter to translate standard JSON requests and responses.
  - Implemented the first deployment guide `docs/AWS_DEPLOYMENT.md` (later renamed to `AWS_DEPLOYMENT_BACKEND.md`).

---

## 2. S3 Web Hosting & Deployment Automation

- **Commits:** `993b0eb` (React frontend & SAM CDN) & `2968618` (Simplify S3 website hosting & split deploys)
- **The Challenge:**
  - The initial frontend setup attempted to route traffic through an **AWS CloudFront Content Delivery Network (CDN)** with Origin Access Control (OAC) to cache files.
  - While secure, CloudFront distributions take **5 to 15 minutes** to propagate configuration changes or invalidate caches upon new deployments. For iterative developers, this introduced excessive lag.
- **The Evolution:**
  - Simplified the `template.yaml` file by stripping out CloudFront and establishing a direct, public-facing **S3 Static Website Hosting** bucket (`ChatbotFrontendBucket`).
  - Configured custom bucket policies to allow public `s3:GetObject` calls globally.
  - Implemented a unified `Makefile` alongside isolated deployment scripts (`deploy-backend.sh`, `deploy-frontend.sh`). These scripts query CloudFormation outputs (`FrontendBucket`, `ApiUrl`) to automatically build and upload static Vite assets.
  - Enabled **CORSMiddleware** in `backend/app/main.py` to allow cross-origin requests from the new S3 website host.
  - Created `docs/AWS_DEPLOYMENT_FRONTEND.md` to document the client build pipeline.

---

## 3. Secure Cognito Authentication & CORS Preflight Splits

- **Commits:** `07fe0c4` (Implement secure Cognito auth) & `e22dffe` (Document Cognito dummy user steps)
- **The Challenge:**
  - Securing backend endpoints required a user directory. Using custom database credentials would require building password salting, hashing, and token storage.
  - **AWS Cognito** provided standard security, but implementing it on API Gateway proxy routes (`/{proxy+}`) created a critical **CORS blocking error** on HTTP preflight `OPTIONS` requests.
  - In a standard proxy setup, browser preflight requests are caught by the authorizer. Because preflight requests do not carry `Authorization` tokens, API Gateway rejected them with a 401/403 block before they reached FastAPI.
- **The Evolution:**
  - Added Cognito resources `ChatbotUserPool` and `ChatbotUserPoolClient` in `template.yaml`.
  - Configured `CognitoAuthorizer` on `ChatbotHttpApi`.
  - **The Proxy Route Split Fix:** Solved the preflight block in `template.yaml` by declaring specific routes (`GetApiEvent`, `PostApiEvent`, `PutApiEvent`, `DeleteApiEvent`) under the default authorizer, but **excluding the OPTIONS method**. By leaving `OPTIONS` unmapped, API Gateway automatically responds to browser preflight requests natively using the gateway's `CorsConfiguration` without checking for JWTs.
  - Created `docs/COGNITO_AUTH.md`.
  - Added support for creating pre-confirmed guest credentials. When creating demo accounts, Cognito places them in a `FORCE_CHANGE_PASSWORD` status, causing frontend login failures. The docs were updated to outline AWS CLI overrides (`admin-set-user-password` with the `--permanent` flag) to mark user accounts as fully confirmed.

---

## 4. Multi-Model Support: Gemini 3.1 Flash Vision Integration

- **Commit:** `dc6d940` (Route image queries to Gemini 3.1 Flash Lite)
- **The Challenge:**
  - Accepting image attachments required shifting to a multimodal LLM (like Google's Gemini). However, exposing standard vision keys plain-text in template files is a massive security hazard.
- **The Evolution:**
  - Added new backend settings for `LiteLlmVisionModel` (defaulting to `gemini/gemini-3.1-flash-lite`).
  - Added `SSMParameterReadPolicy` to the SAM function configuration, granting access to `/chatbot/litellm_vision_api_key` in AWS Parameter Store.
  - Created the `get_vision_llm_client` dependency, which performs lazy lookup and KMS decryption of SSM API keys during warm execution, falling back to local environment variables during offline testing.

---

## 5. Cost Optimization & Always-Free Tier Alignment

- **Commit:** `9285422` (docs: add AWS_COSTING_GOTCHAS.md to document hidden AWS infrastructure costs)
- **The Challenge:**
  - Standard AWS serverless deployments carry silent costing traps that can exhaust credits or free-tier thresholds, specifically CloudWatch log bloating and DynamoDB Pay-per-request pricing.
- **The Evolution:**
  - Added `docs/AWS_COSTING_GOTCHAS.md` to establish costing boundaries.
  - **DynamoDB Billing Evolution:** Updated `ChatbotTable` in `template.yaml` to run on `BillingMode: PROVISIONED` with a baseline of 5 RCU and 5 WCU. This aligns the database with the AWS Always-Free tier (which grants up to 25 RCU/WCU free for provisioned tables but charges from request number one under On-Demand models).
  - **CloudWatch Logging Evolution:** Added an explicit `ChatbotBackendFunctionLogGroup` resource in `template.yaml` set to `RetentionInDays: 7` to override Lambda's default "Never Expire" log streams.

---

## 6. Serverless Persistent Chat History CRUD

- **Commit:** `21fd4fa` (Implement serverless persistent chat history CRUD endpoints)
- **The Challenge:**
  - The initial chatbot client stored conversation histories inside local browser memory (`localStorage`). This prevented cross-device access and made histories fragile.
  - Simply querying messages by `user_id` inside a single-table DynamoDB layout requires a full Table Scan. A scan reads every single item in the database, resulting in massive RCU consumption, slow execution, and mounting billing fees.
- **The Evolution:**
  - **The GSI Evolution:** Added **`UserConversationsIndex`** as a Global Secondary Index (GSI) inside `template.yaml`'s `ChatbotTable` definition. The GSI projects `user_id` as the partition key and timestamp `sk` as the range key.
  - Updated `conversation_repository.py` to support full CRUD methods (listing conversations, updating metadata, and safe cascading deletion of messages).
  - Modified `/conversations` routes to perform high-speed, localized GSI queries instead of table scans, bringing list fetches down to sub-5ms times.

---

## 7. Real-Time Response Streaming Implementation

- **Commit:** `0cc8469` (Implement Server-Sent Events response streaming)
- **The Challenge:**
  - Waiting for full LLM completions introduced significant latencies (often 5 to 12 seconds). To match modern standards, the chatbot required **Server-Sent Events (SSE)** chunk streaming.
  - **API Gateway HTTP APIs (v2)** strictly buffer all outbound responses. They wait for Lambda to finish executing before returning data.
  - **Mangum** does not support event-stream protocols.
- **The Evolution:**
  - **Function URLs & LWA Layer Integration:** Attached the `LambdaAdapterLayerArm64:27` layer in `template.yaml` and exposed a direct **Lambda Function URL (FURL)** configured with `RESPONSE_STREAM` invocation mode.
  - Set `AWS_LWA_INVOKE_MODE: response_stream` inside the Lambda environment variables. This forces Lambda Web Adapter to route streaming payloads natively via standard chunked transfer encoding.
  - **PyJWT In-App Auth Migration:** Because Lambda Function URLs bypass API Gateway entirely, we lost the edge-level Cognito Authorizer. We migrated token verification directly into the FastAPI application using custom dependency-injected JWT middleware (`dependencies.py`). The middleware dynamically fetches Cognito's JSON Web Key Sets (JWKS) URL, verifies token signatures and expiration periods, and returns verified user sub/username mappings.
  - Created `docs/SSE_STREAMING_GUIDE.md` and `docs/AWS_CHNAGES_IN_CONFIG_FOR_STREAMING.md` to document the new dual-routing model: REST operations utilize secure API Gateway routing, while `/chat/stream` routes through the low-latency Function URL.
  - Preserved the pre-SSE backend configuration document as `docs/AWS_DEPLOYMENT_BACKEND_BEFORE_SSE.md`.

---

## 8. LWA Boot & Duplicate CORS Preflight Blocking Bugfixes

- **Commit:** `21962c0` (Resolve Lambda LWA boot issues and CORS preflight blocks)
- **The Challenge:**
  - Upon deploying the SSE streaming build, developers encountered two immediate blockers:
    1. **Lambda Boot Failure:** LWA failed to resolve dependencies or start Uvicorn because the entrypoint `Handler: app.main.app` could not properly parse execution namespaces within Lambda's environment path.
    2. **CORS Preflight Blocking:** The frontend failed to connect to the Function URL. The browser blocked calls because both the AWS Function URL infrastructure (configured with a `Cors` block in `FunctionUrlConfig`) and FastAPI's `CORSMiddleware` injected standard CORS headers (like `Access-Control-Allow-Origin`). This duplication of CORS headers is treated as a security violation by modern web browsers, causing them to block calls.
- **The Evolution:**
  - **Boot Issue Resolution:** Changed `Handler: app.main.app` to **`Handler: run.sh`** in `template.yaml` and set the execution wrapper `AWS_LAMBDA_EXEC_WRAPPER: /opt/bootstrap`. In `backend/run.sh`, the startup call was updated to `exec python -m uvicorn app.main:app` (instead of calling raw `uvicorn`), ensuring the Python virtual environment and paths are resolved correctly.
  - **CORS Conflict Resolution:** Stripped the `Cors` property block entirely from `FunctionUrlConfig` in `template.yaml`. CORS handling was delegated exclusively to FastAPI's application layer via `CORSMiddleware` in `main.py`, removing duplicate header injection and fully resolving browser CORS blocks.
  - Fixed `FunctionUrl` output inside `template.yaml` to retrieve the property from the logical resource using `!GetAtt ChatbotBackendFunctionUrl.FunctionUrl` instead of an invalid `!Ref`.

---

## 9. Frontend Monolithic Decomposition

- **Commit:** `ec2764d` (Decompose monolithic App.tsx into modular subcomponents)
- **The Challenge:**
  - As features expanded (Cognito login gates, image attachments, persistent histories, SSE chunk buffers, sidebars, and settings drawer), the React frontend's primary file `App.tsx` bloated into a monolithic **700+ line file** that was fragile, difficult to read, and prone to merge conflicts.
- **The Evolution:**
  - Decomposed the monolithic interface into reusable, modular TypeScript subcomponents under `frontend/src/components/`:
    1. **`AuthGate.tsx`**: Manages verification forms, Cognito user registration, and standard login states.
    2. **`Sidebar.tsx`**: Renders conversation lists, delete buttons, rename modals, and user email profile details.
    3. **`ChatFeed.tsx`**: Manages message arrays, markdown parsing (using standard lists, code snippets, copy buttons), and typing/streaming indicators.
    4. **`InputBar.tsx`**: Handles prompt entries, image attachment previews, and S3 file validation rules.
    5. **`SettingsModal.tsx`**: Houses API base URL configs and public API heartbeat checkers.
  - Reduced the central `App.tsx` file to a lightweight wrapper managing only global state, custom React hooks, and stream reader triggers, improving code maintainability.

---

## 10. S3 Vectors RAG Baseline

- **Commit:** `4c8d50e` (Implement S3 Vectors RAG Baseline)
- **What Changed:**
  - Added RAG configuration to backend settings for S3 Vectors bucket/index names, embedding model, embedding dimensions, chunk sizing, and default retrieval count.
  - Introduced `VectorStoreClient` for LiteLLM Gemini embeddings plus S3 Vectors `put_vectors` and `query_vectors` calls.
  - Stored `user_id` as filterable vector metadata and forced all vector similarity queries through a `user_id` filter before applying optional document filters.
  - Introduced `RagService` for text normalization, chunking, embedding, and ingestion.
  - Added `/rag/ingest` and `/rag/search` endpoints for plain-text knowledge ingestion and retrieval verification.
  - Added a DynamoDB-backed RAG document registry under each user partition and exposed it through `/rag/documents`.
  - Integrated optional RAG context injection into `/chat` and `/chat/stream` through `use_rag` and `rag_documents` request fields.
  - Added frontend RAG controls that show ingested document names and let users select document filters.
  - Updated the SAM template with S3 Vectors IAM permissions and RAG environment variables.

---

## 11. Event-Driven Asynchronous Ingestion & SQS Background Worker

- **Commit:** `9bc6f1d` (Implement Decoupled Event-Driven RAG Ingestion)
- **What We Built:**
  - **Asynchronous endpoints**: Redesigned `/rag/ingest` and `/rag/ingest/file` API routes to immediately save placeholders in DynamoDB with a `"processing"` status, upload raw files to S3 staging prefix `staging/{user_id}/{document_id}/{filename}`, and return a `202 Accepted` response.
  - **SQS Integration**: Introduced `IngestionDLQ` and `IngestionQueue` coupled with an SQS Queue Policy that authorizes S3 event publications.
  - **S3 Event Configuration**: Configured `NotificationConfiguration` on `ChatbotStorageBucket` under `staging/` key prefix to automatically trigger an SQS message when files land.
  - **Background Worker**: Developed `ChatbotIngestionWorkerFunction` (`app/worker.py`) that polls SQS, decodes structured staging keys, processes files through Textract and RagService offline, updates DynamoDB status to `"ready"` (or `"failed"`), and cleans up staging files.
  - **Visual Catalog & Polling**: Configured frontend `DocumentsModal.tsx` to automatically poll the API every 3 seconds if any document is processing, rendering beautiful pulsing, spinning orange badges saying `"Processing..."`, `"Failed"` warnings, and disabling quick-selectors until completed.
  - **Unit Tests**: Updated mocks in `conftest.py` and restructured endpoints and added full worker handler unit tests in `test_rag.py`.
