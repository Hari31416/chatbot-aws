# AWS Serverless Chatbot: Beginner's AWS Services & Learning Guide

Welcome to the AWS Serverless Chatbot project! This guide is designed specifically for **beginners** to help you understand the architecture of this application and navigate the ecosystem of Amazon Web Services (AWS) that powers it.

Instead of generic definitions, this guide explains exactly **how each service is used in this chatbot**, **what concepts you should study**, and **real-world cost gotchas** to keep you in the free tier.

---

## High-Level Request Flow

When a user interacts with this chatbot, their request flows through these services:

```
[ STATIC SITE VISITS ]
1. User Browser ──────(Loads HTML/CSS/JS)──────► Amazon S3 Frontend Bucket (Public Web Server)

[ SIGN-UP / LOG-IN ]
2. User Browser ──────(Register/Authenticate)──► Amazon Cognito User Pools (Secure User Directory)

[ SECURED DATABASE & IMAGE ACTIONS (REST) ]
3. User Browser ──────(Requests /conversations)► Amazon API Gateway (Verifies Cognito JWT Token)
                                                        │
                                                        ▼
                                                  AWS Lambda (Compute Backend runs FastAPI)
                                                        │
                                             ┌──────────┴──────────┐
                                             ▼                     ▼
                                     Amazon DynamoDB           Amazon S3 Uploads
                                 (Conversation History)        (Private User Images)

[ REAL-TIME CHAT RESPONSE STREAMING ]
4. User Browser ──────(Request /chat/stream)──► AWS Lambda Function URL (Direct HTTP Streaming Router)
                                                        │
                                                        ▼
                                                  AWS Lambda (LWA / Uvicorn + LiteLLM + Gemini)
                                                        │
                                             ┌──────────┴──────────┐
                                             ▼                     ▼
                                     Amazon S3 Vectors       Amazon Textract
                                   (Vector RAG Database)    (PDF Layout parsing)

[ EVENT-DRIVEN ASYNCHRONOUS DOCUMENT INGESTION (RAG) ]
5. User Browser ──────(Uploads Document)───────► Amazon API Gateway (Verifies Cognito JWT Token)
                                                        │
                                                        ▼
                                                  AWS Lambda (Compute Backend runs FastAPI)
                                                        │
                                                        ▼
                                                  Amazon S3 Uploads (prefix: staging/)
                                                        │
                                                  (S3 Event Notification)
                                                        │
                                                        ▼
                                                  Amazon SQS Ingestion Queue (Buffers Job)
                                                        │
                                                  (Triggers Worker Event)
                                                        │
                                                        ▼
                                                  AWS Lambda (Asynchronous Ingestion Worker)
                                                        │
                                             ┌──────────┴──────────┐
                                             ▼                     ▼
                                     Amazon S3 Vectors       Amazon Textract
                                   (Embed & Index Chunks)   (Document Parsing)
                                             │
                                             ▼
                                     Amazon DynamoDB (Updates status to "ready" or "failed")
```

---

## Comprehensive AWS Service Directory

Below is the breakdown of the **12 AWS Services** utilized in this project.

---

### 1. AWS Lambda

> **Friendly Analogy:** Think of AWS Lambda as a "rental car" that you only pay for by the exact second you drive it. When no one is driving it, it sits parked and costs you absolutely $0.00.

- **Role in this Chatbot:** AWS Lambda is the **compute engine** of the app. It hosts the entire Python backend (FastAPI application). When a user sends a chat message or requests their history, AWS spins up a container, executes the Python code to process the request, and then immediately shuts down.
- **Why it's cool:** There are no servers to manage, patch, or scale. If 10,000 users visit the chatbot simultaneously, AWS automatically runs 10,000 parallel copies of your function.
- **Key Concepts to Study & Google:**
  - _Serverless Compute vs. Provisioned Compute (EC2)_
  - _Lambda Cold Starts_ (why the very first request after inactivity takes a few seconds)
  - _Lambda Execution Roles (IAM)_
  - _Lambda Layers_ (reusable packages shared across functions)
- **️ Pro Tip & Cost Trap:**
  - _The Trap:_ By default, Lambda functions never delete their diagnostic logs (sent to CloudWatch). If you run heavy test loops, log storage costs will build up quietly.
  - _The Fix:_ Always configure an explicit **Log Retention Policy** (like 7 days) in your SAM template.

---

### 2. Amazon API Gateway (HTTP API v2)

> **Friendly Analogy:** Think of API Gateway as a "secure front gate keeper" at an apartment building. It checks the credentials of incoming visitors and guides them to the correct apartment.

- **Role in this Chatbot:** It acts as the secure entry point for standard REST requests (like checking API health, creating user accounts, and fetching conversation history). It receives requests, validates the security token (Cognito JWT), and routes them to the Lambda function.
- **Why it's cool:** It automatically handles browser security preflights (CORS) and stops bad or unauthorized requests _before_ they can reach and trigger your database or Lambda, saving you computing costs.
- **Key Concepts to Study & Google:**
  - _REST APIs vs. HTTP APIs (v2)_ (HTTP APIs are newer, faster, and 70% cheaper than traditional REST APIs!)
  - _CORS (Cross-Origin Resource Sharing)_ preflight checks
  - _API Gateway Authorizers_ (Cognito JWT Integration)
- **️ Pro Tip & Cost Trap:**
  - _The Trap:_ Traditional REST APIs (v1) charge a lot for features you don't need for a simple app.
  - _The Fix:_ Use the newer **HTTP API (v2)** like this project does. The free tier gives you **1 million requests** per month.

---

### 3. AWS Lambda Function URLs (FURLs) & Lambda Web Adapter (LWA)

> **Friendly Analogy:** If API Gateway is the "front gate", a Function URL is a "private express highway" directly to your Lambda container, bypassing the gate entirely for maximum speed.

- **Role in this Chatbot:** Exposes a direct, public HTTPS endpoint specifically for **real-time chat token streaming**. By using LWA (Lambda Web Adapter) and setting the invocation mode to `RESPONSE_STREAM`, the Lambda function streams the LLM's response character-by-character back to the user instantly, instead of waiting for the full sentence to finish.
- **Why it's cool:** Traditional API Gateway strictly buffers responses and throws a timeout error if a request takes longer than 29 seconds. Function URLs support direct streaming with a 15-minute timeout limit, enabling ultra-fast Time-to-First-Byte (TTFB) of $\approx 250\text{ms}$.
- **Key Concepts to Study & Google:**
  - _HTTP Server-Sent Events (SSE)_ / Response Streaming
  - _AWS Lambda Web Adapter (LWA)_ (How to run native web servers like Uvicorn inside Lambda)
  - _Chunked Transfer Encoding_
- **️ Pro Tip & Cost Trap:**
  - _The Trap:_ Since Function URLs bypass API Gateway, they also bypass Cognito's built-in token authorizer!
  - _The Fix:_ You must perform manual security token verification inside your backend code (e.g., using `PyJWT` middleware in FastAPI) to prevent anyone from calling your LLM streaming route for free.

---

### 4. Amazon Cognito (User Pools & Client)

> **Friendly Analogy:** Think of Cognito as your "outsourced security team". Instead of building your own secure database to store hashed user passwords, you let AWS handle it securely.

- **Role in this Chatbot:** Manages sign-up, sign-in, and verification emails for your users. On login, Cognito issues a cryptographically signed **JSON Web Token (JWT)** that identifies the user.
- **Why it's cool:** Bypasses complex user directory management and automatically secures endpoints against hacking attempts (brute force protection, credential stuffing) for free.
- **Key Concepts to Study & Google:**
  - _JSON Web Tokens (JWTs): ID Tokens vs. Access Tokens vs. Refresh Tokens_
  - _JWKS (JSON Web Key Sets)_ and offline cryptographic signature validation
  - _User Pools (identity directory) vs. Identity Pools (AWS credentials)_
- **️ Pro Tip & Cost Trap:**
  - _The Trap:_ Cognito recently split into _Lite_, _Essentials_, and _Plus_ tiers. Toggling on the **Plus** tier (advanced threat protection) drops your 10,000 Monthly Active Users (MAU) free tier to zero, and you are charged immediately. SMS verification messages are also never free.
  - _The Fix:_ Keep your Cognito User Pool plan set to **Lite** or **Essentials** and stick to standard Email verification.

---

### 5. Amazon DynamoDB

> **Friendly Analogy:** Think of DynamoDB as a "hyper-optimized spreadsheet". Instead of complex folders and interconnected tables, you stack all your data into a single sheet designed for sub-millisecond retrieval speeds.

- **Role in this Chatbot:** Stores user session metadata, actual message transcripts, and quick-cache context structures.
- **Why it's cool:** It is a serverless, NoSQL database that can handle millions of requests per second with flat sub-10ms response times. In this project, it utilizes a **Single-Table Design**—meaning users, metadata, messages, and caching exist in one table, eliminating expensive database "joins".
- **Key Concepts to Study & Google:**
  - _NoSQL Key-Value / Document Databases_
  - _DynamoDB Partition Key (PK) & Sort Key (SK)_ (Composite Primary Keys)
  - _DynamoDB Single-Table Design_
  - _Global Secondary Indexes (GSIs)_ (creating alternative lookup indexes)
  - _Time-To-Live (TTL)_ (automatically deleting data after an expiry timestamp)
- **️ Pro Tip & Cost Trap:**
  - _The Trap:_ DynamoDB has two billing models: On-Demand and Provisioned. On-Demand charges per request, which sounds simple but forfeits AWS's massive **Always Free Tier**.
  - _The Fix:_ In your SAM template, explicitly configure **Provisioned Billing** and set the Read/Write capacity units to a safe minimum (e.g., 5). This fits 100% inside AWS's Always Free tier (up to 25 RCU/WCU).

---

### 6. Amazon S3 (Private Uploads Bucket)

> **Friendly Analogy:** Think of S3 as a "giant secure storage locker" where you can throw files of any size and get back a secure, unique key to open them.

- **Role in this Chatbot:** Securely stores images uploaded by the user when they initiate a multimodal conversation (like asking the bot to describe a screenshot).
- **Why it's cool:** It is highly secure. S3 blocks all public internet access to this bucket. When the frontend needs to show an image, the backend Lambda generates a cryptographically signed **S3 Presigned GET URL** that expires automatically after 1 hour.
- **Key Concepts to Study & Google:**
  - _Object Storage vs. Block Storage (EBS/Hard Drives)_
  - _S3 Bucket Policies & Public Access Blocks_
  - _S3 Presigned URLs_
  - _S3 Lifecycle Rules_ (automatically deleting temporary files)
- **️ Pro Tip & Cost Trap:**
  - _The Trap:_ Leaving large media uploads in S3 forever will slowly eat away at your 5 GB free tier storage.
  - _The Fix:_ Set up an S3 **Lifecycle Configuration Rule** (configured in this project's `template.yaml`) to automatically delete uploaded images after 7 days.

---

### 7. Amazon S3 (Public Frontend Web Hosting Bucket)

> **Friendly Analogy:** Think of this S3 bucket as a public billboard where you pin your React website's code files for the entire world to read.

- **Role in this Chatbot:** Hosts the static frontend interface (Vite + React single-page application). Since modern frontend apps build down to plain HTML, CSS, and Javascript files, you don't need a running server to host them; you can serve them directly from S3!
- **Why it's cool:** Standard web server hosting (like EC2) runs 24/7 and costs money even if no one is visiting. S3 website hosting is practically free for small websites, costing only pennies per month.
- **Key Concepts to Study & Google:**
  - _S3 Static Website Hosting_
  - _Single-Page Application (SPA) Fallback routing_ (mapping `index.html` as the error document so your React Router routes don't throw 404 errors on page refreshes).
- **️ Pro Tip & Cost Trap:**
  - _The Trap:_ Standard public S3 buckets do not protect against massive bandwidth spikes if someone tries to scrape your site.
  - _The Fix:_ For small or personal development projects, direct S3 hosting is fast and fine. For high-traffic production projects, you should always sit a **CloudFront Content Delivery Network (CDN)** in front of the bucket.

---

### 8. AWS Systems Manager (SSM) Parameter Store

> **Friendly Analogy:** Think of SSM Parameter Store as a "secure lockbox" for sensitive notes. You don't leave your vault keys lying around on your desk (environment variables); you keep them locked away in this secure central cabinet.

- **Role in this Chatbot:** Securely stores your secret third-party LLM API keys (like Gemini or NVIDIA NIM keys) as KMS-encrypted `SecureString` values.
- **Why it's cool:** Injects secrets directly into your Lambda function's memory during the cold start phase, ensuring sensitive keys are never checked into Git, exposed in the AWS console, or printed in plain-text logs.
- **Key Concepts to Study & Google:**
  - _AWS SSM Parameter Store vs. AWS Secrets Manager_ (SSM is completely free for standard parameters; Secrets Manager costs $0.40 per secret per month!)
  - _AWS Key Management Service (KMS)_ encryption
  - _SecureString parameters_
- **️ Pro Tip & Cost Trap:**
  - _The Trap:_ Beginners often use AWS Secrets Manager because it sounds descriptive, but it immediately charges you.
  - _The Fix:_ Use **SSM Parameter Store** with the `SecureString` type for standard application configurations and API keys to keep your costs at exactly $0.

---

### 9. Amazon CloudWatch Logs

> **Friendly Analogy:** Think of CloudWatch as the "black box flight recorder" of your application. It records everything that happens behind the scenes so you can inspect it if something goes wrong.

- **Role in this Chatbot:** Automatically collects and indexes stdout print statements, error logs, and exception tracebacks generated by the Python Lambda code.
- **Why it's cool:** Essential for debugging. If a user reports a bug, you can search CloudWatch by timestamp or `request_id` to trace the exact error message.
- **Key Concepts to Study & Google:**
  - _CloudWatch Log Groups & Log Streams_
  - _Log Filtering & Metric Filters_
  - _Log Storage & Ingestion Costs_
- **️ Pro Tip & Cost Trap:**
  - _The Trap:_ As mentioned under Lambda, AWS defaults all CloudWatch logs to "Never Expire". Over months, old debugging logs will accumulate and quietly bill you.
  - _The Fix:_ Check the `template.yaml` resource `ChatbotBackendFunctionLogGroup` to see how `RetentionInDays: 7` forces automatic log expiration.

---

### 10. Amazon S3 Vectors (RAG Database)

> **Friendly Analogy:** Think of S3 Vectors as an "intelligent index card system" added to your storage locker. Instead of searching files by matching exact words, it lets you search files by matching _concepts_ (semantic meaning).

- **Role in this Chatbot:** Powering the **Retrieval-Augmented Generation (RAG)** pipeline. It stores document embeddings (768-dimension coordinate arrays generated by LiteLLM using Gemini-Embedding-2) inside specialized bucket indexes. When a user asks a question, it retrieves the most conceptually similar paragraph chunks from your uploaded documents to answer the question.
- **Why it's cool:** Normal vector databases (like Pinecone or Qdrant) require you to provision running server clusters that cost $30–$100+ per month. S3 Vectors is a serverless, low-cost solution that builds directly on your existing S3 storage!
- **Key Concepts to Study & Google:**
  - _Vector Embeddings / High-Dimensional Spaces_
  - _Cosine Similarity vs. Euclidean Distance_
  - _RAG (Retrieval-Augmented Generation)_
  - _S3 Vectors Ingestion (`put_vectors`) & Similarity Search (`query_vectors`)_
- **️ Pro Tip & Cost Trap:**
  - _The Trap:_ S3 Vector databases are ideal for high-scale, cost-effective document searches. However, as it is a serverless search engine, very frequent large-batch vector scans can accumulate operations costs if unchecked.
  - _The Fix:_ Use metadata filters (e.g., matching a specific `source_doc`) in your query payload to narrow down the query index space, making searches faster and more accurate.

---

### 11. AWS Textract

> **Friendly Analogy:** Think of Textract as a "supercharged OCR scanner" that doesn't just read the characters on a page, but understands if they belong to a formal table, an invoice grid, or a multi-column article layout.

- **Role in this Chatbot:** Serves as the pipeline for ingesting complex multi-page PDF documents. It scans PDFs, reconstructs layout structures (like paragraph grids, forms, and tables), and formats them into clean markdown text before embedding.
- **Why it's cool:** Standard open-source Python PDF parsers scrape plain text, turning multi-column text into scrambled rows and tables into unreadable strings. Textract preserves the grid relationship, which is critical for making sure your RAG database retrieves accurate information.
- **Key Concepts to Study & Google:**
  - _OCR (Optical Character Recognition)_
  - _Document Structure & Layout Analysis_
  - _AWS Textract `DetectDocumentText` vs. `AnalyzeDocument`_
- **️ Pro Tip & Cost Trap:**
  - _The Trap:_ `AnalyzeDocument` (which parses forms and tables) is up to **30x more expensive** ($50 per 1,000 pages) than standard `DetectDocumentText` ($1.50 per 1,000 pages) after your trial ends.
  - _The Fix:_ Only invoke the heavy layout `Analyze` features if you strictly need complex grid extraction; otherwise, default your pipelines to standard text detection.

---

### 12. Amazon Simple Queue Service (SQS) & Dead Letter Queues (DLQ)

> **Friendly Analogy:** Think of Amazon SQS as a "post office mail slot". When you want to send a letter, you don't wait at the post office for the mail carrier to drive it to the destination. You drop the letter in the slot and walk away, confident that the post office will deliver it in the background while you go about your day.

- **Role in this Chatbot:** It acts as the asynchronous decoupling buffer for RAG document ingestion. When a user uploads a document, instead of running a slow, synchronous parsing script that might time out the browser session, the document is saved to S3, which immediately drops a notification message into `IngestionQueue`. A separate background Worker Lambda then pulls messages from the queue one at a time and processes them safely. If a job fails repeatedly (e.g., due to a temporary API timeout or DB lock), SQS automatically reroutes it to `IngestionDLQ` (Dead Letter Queue) after 3 retries so no uploads are lost.
- **Why it's cool:** It enables 100% reliable background processing. The user gets an instant "Upload Accepted" response in under 50ms, while heavy calculations (OCR, embedding generation, database writes) occur silently in the background. If the system gets a sudden spike of 1,000 document uploads, SQS buffers them safely so your background Lambda worker isn't overwhelmed.
- **Key Concepts to Study & Google:**
  - _Decoupling / Publish-Subscribe Architectures_
  - _SQS Standard vs. FIFO Queues_
  - _Visibility Timeout_ (how long a message is hidden from other workers while one worker is processing it)
  - _Dead Letter Queues (DLQ) & Redrive Policies_ (handling failed messages)
  - _SQS Batch Size_ (processing messages in groups vs. one-by-one)
- **️ Pro Tip & Cost Trap:**
  - _The Trap:_ If your Lambda worker takes longer to process a document than the SQS queue's **Visibility Timeout**, SQS will assume the worker died and make the message visible again. Another worker will pick it up, leading to duplicate processing, double LLM bills, and database conflicts.
  - _The Fix:_ Always ensure your SQS queue's `VisibilityTimeout` is at least **1.5x to 3x** the maximum execution timeout of your consumer Lambda function. (In this project, the worker timeout is 120s, and the SQS visibility timeout is 180s).

---

## How AWS SAM (Serverless Application Model) Coordinates It All

As a beginner, looking at 11 different services can feel overwhelming. If you had to click around the AWS Console to set them up, connect them, and assign security policies, it would take days and be highly prone to errors.

This is why we use **AWS SAM**.

Inside your project root, there is a file called [template.yaml](../template.yaml). This file is an **Infrastructure-as-Code (IaC)** blueprint. It tells AWS:

1. _"Deploy a Lambda function using the `./backend` code."_
2. _"Deploy a DynamoDB table named `chatbot-table` with a Partition Key and Sort Key."_
3. _"Give the Lambda function precise CRUD (Create, Read, Update, Delete) permissions to the DynamoDB table."_
4. _"Create a Cognito User Pool for email login."_

When you run `sam deploy`, AWS reads this YAML file and builds the entire ecosystem automatically in under 5 minutes. If you want to delete the entire app and all its costs, you simply run `sam delete`, and AWS tears it all down cleanly.

---

## Beginner's Learning Roadmap

If you want to become comfortable managing and developing this app, here is the recommended path:

### Step 1: Master the Serverless Basics

- Install the **AWS CLI** and configure your local computer with your AWS credentials.
- Deploy this chatbot once using `sam build --use-container` and `sam deploy --guided` to see how the services are built in your AWS Console.

### Step 2: Understand the Database

- Open the **Amazon DynamoDB Console** and explore your deployed table.
- Observe how conversation history is saved. Look at the composite keys (`pk` and `sk`) and see how the context (`CTX`) cache item expires automatically when you don't message the bot for an hour.

### Step 3: Explore Security (IAM & Cognito)

- Look up **IAM Policies**. Understand how your Lambda's execution role restricts access so that your Lambda can _only_ write to your specific S3 bucket and DynamoDB table.
- Create a dummy test user in Cognito using the AWS CLI commands listed in the Cognito Auth Guide.

### Step 4: Trace the Code

- Examine [backend/app/dependencies.py](../backend/app/dependencies.py). Study how it parses the user identity claims sent by API Gateway, or falls back to a dummy user ID for local, offline development.
- Examine [backend/app/services/vector_store.py](../backend/app/services/vector_store.py) to see how Boto3 initializes and queries the S3 Vectors index.

_Congratulations on starting your serverless journey! You are working with a state-of-the-art serverless architecture that is highly performant, secure, and optimized._

---

## 🎓 Deep-Dive Developer Q&A (Architectural Shifts)

This section documents key architectural Q&As exploring how this serverless stack compares to traditional serverful approaches you may be familiar with.

### Q1: Isn't exposing AWS Lambda Function URLs (FURLs) as a direct public HTTPS endpoint bad for security?

**A:** No, because **public network accessibility is not the same as unauthorized access.**
All web APIs (including API Gateway and serverful VMs) must expose a public-facing HTTPS endpoint so browsers can reach them. What matters is **authentication and authorization**:

1. **JWT Verification:** Even though the Function URL security is set to `AuthType: NONE` (meaning AWS does not block callers at the network edge), the FastAPI app running inside Lambda intercepts every request. It requires a valid, cryptographically signed Cognito JWT in the `Authorization` header. If it's missing or invalid, the backend immediately rejects the call with a `401 Unauthorized` before executing any LLM or DB code.
2. **Encrypted in Transit:** FURLs automatically enforce industry-standard TLS (HTTPS) to protect data in transit.
3. **DDoS Protection:** AWS shields FURLs automatically with basic AWS Shield infrastructure-layer DDoS protection.

---

### Q2: How does Cognito auth/registration differ from a standard serverful FastAPI + DB OAuth setup?

**A:** The paradigm shift is centered on **delegation**:

- **Database & Hashing:** In a serverful app, you manage a `users` table, hash passwords yourself (using bcrypt/argon2), and handle security compliance. With Cognito, AWS manages the entire secure directory. You don't store passwords or hash anything.
- **Bypassing the Backend:** During registration and login, the React client communicates **directly with Cognito’s public API**. Your FastAPI backend is completely bypassed! You pay $0 in Lambda compute fees for sign-up and login traffic.
- **Asymmetric Tokens:** Instead of signing JWTs with a shared symmetric `SECRET_KEY` in your `.env` file, Cognito signs JWTs using asymmetric cryptography. The backend validates signatures offline by fetching Cognito’s public keys from a public URL called the **JWKS** (JSON Web Key Set).

---

### Q3: How does Amazon API Gateway (v2) work under the hood, and how does it compare to Function URLs (FURLs) + Lambda Web Adapter (LWA)?

**A:** The differences lie in mapping, buffering, and timeouts:

#### Amazon API Gateway HTTP API (v2)

1. **Envoy Proxy Fleet:** It is an AWS-managed reverse proxy.
2. **Edge Auth:** It validates the Cognito JWT at the network edge _before_ invoking your Lambda.
3. **Proxy Event Mapping:** It translates the raw HTTP request into a heavy structured JSON event (Proxy Integration v2.0) and invokes Lambda. Mangum (the ASGI adapter inside Lambda) translates this JSON into ASGI format for FastAPI.
4. **⚠️ Response Buffering:** API Gateway strictly **buffers the entire response**. It waits for the Lambda to finish completely, caps response size at 6MB, and times out after 29 seconds.

#### FURLs + Lambda Web Adapter (LWA)

1. **Direct Connection:** FURLs bypass API Gateway completely, allowing direct streaming.
2. **LWA Layer Bootstrap:** LWA compiles as a Go binary wrapper (`/opt/bootstrap`). At container startup, LWA boots first, launches Uvicorn on local port 8080, and forwards incoming HTTP requests directly to it over TCP loopback.
3. **Chunked Responses:** By setting `InvokeMode: RESPONSE_STREAM`, LWA and the FURL support true **HTTP Chunked Transfer Encoding** (Streaming). When FastAPI yields a word chunk, it is written immediately to the Lambda runtime stream, bringing Time-to-First-Byte (TTFB) down from 10 seconds to $\approx 250\text{ms}$.
4. **Extended Limits:** Bypasses the 6MB response limit and supports timeouts up to the full 15-minute Lambda limit.

---

### Q4: How does Single-Table Design in DynamoDB work, and how is it different from MongoDB collections?

**A:** The main shift is moving from **logical entity separation** to **UI-access pattern optimization**:

- **The MongoDB Way:** You store data in multiple collections (`users`, `conversations`, `messages`) and join them using `$lookup` or issue multiple sequential queries.
- **The DynamoDB Single-Table Way:** Since DynamoDB doesn't have joins, separating data forces multiple slow network queries. To prevent this, **every entity type is stored in one single table** sharing generic keys: Partition Key (`pk`) and Sort Key (`sk`).
- **Pre-Joined Data:** By matching prefix structures:
  - Conversation Metadata: `pk = CONV#conv-999` \| `sk = META`
  - Chat Messages: `pk = CONV#conv-999` \| `sk = MSG#timestamp`
  - Cache Context: `pk = CONV#conv-999` \| `sk = CTX`
    You can query the table for `pk = CONV#conv-999` and retrieve the conversation header, message transcripts, and context cache in **one single database operation** in under 5ms because they sit physically next to each other on the same database partition!
- **Global Secondary Indexes (GSIs):** Since querying is only fast on `pk`, to look up conversations by `user_id`, we create a GSI where `user_id` acts as the alternate partition key, allowing AWS to replicate and index the data dynamically.

---

### Q5: Why did we transition the document ingestion flow to an event-driven SQS queue and background Lambda worker instead of processing it in the main API function?

**A:** This is a classic shift from **synchronous busy-waiting** to **event-driven asynchronous design** to solve two major serverless limits: **timeouts** and **costs**.

1. **Bypassing the 30-Second API Gateway Hard Timeout:** API Gateway HTTP APIs enforce a non-configurable **30-second integration timeout**. Parsing complex, multi-page PDFs using AWS Textract, chunking text, generating high-dimensional vector embeddings, and indexing them in S3 Vectors can easily exceed 30 seconds. In the old synchronous design, this resulted in the API Gateway aborting the client connection (throwing 502/504 errors) even if the background work was still running. By switching to SQS, the API immediately acknowledges the upload and returns an HTTP `202 Accepted` in <50ms. The actual processing occurs offline with a dedicated Lambda timeout of **120 seconds**, completely insulated from API Gateway timeouts.
2. **Drastic Compute Cost Reductions:** AWS Lambda bills for execution time by the millisecond. In a synchronous design, the Lambda function had to spin in a busy-waiting loop, sleeping and polling Textract's status API (`GetDocumentTextDetection`) every few seconds. This meant paying for idle CPU time while waiting for a managed third-party service to finish. In the event-driven queue-centric design, S3 triggers SQS on object landing, and SQS instantly triggers the worker Lambda to start the job. SQS handles built-in automatic retries if the database or embedding endpoint fails, and routes toxic messages safely to the Dead Letter Queue (DLQ) without crashing the user's browser session.
