# AWS to GCP Migration & Costing Guide

This guide details the optimal path for migrating the Serverless Chatbot application stack from Amazon Web Services (AWS) to Google Cloud Platform (GCP). It breaks down the system architecture mapping, lists code-level adapter transitions, provides a comprehensive costing matrix, and warns against potential GCP cost traps.

---

## 1. High-Level Architectural Mapping

The serverless, event-driven flow translates natively into Google Cloud's container-centric serverless ecosystem.

```txt
[ STATIC SITE VISITS ]
1. User Browser ──────(Loads HTML/CSS/JS)──────► Firebase Hosting (Free CDN / SSL / Rewrite Routing)

[ SIGN-UP / LOG-IN ]
2. User Browser ──────(Register/Authenticate)──► Identity Platform (Firebase Auth) (50k MAU Free)

[ SECURED DATABASE & IMAGE ACTIONS (REST) ]
3. User Browser ──────(Requests /conversations)► Cloud Run Ingress (Validates Identity JWT)
                                                         │
                                                         ▼
                                                   Cloud Run (FastAPI Backend Container)
                                                         │
                                              ┌──────────┴──────────┐
                                              ▼                     ▼
                                       Cloud Firestore       Cloud Storage (GCS)
                                    (Conversation History)   (Private User Images)

[ REAL-TIME CHAT RESPONSE STREAMING ]
4. User Browser ──────(Request /chat/stream)──► Cloud Run Ingress (Direct SSE HTTP Endpoint)
                                                         │
                                                         ▼
                                                   Cloud Run (FastAPI + LiteLLM + Gemini)
                                                         │
                                              ┌──────────┴──────────┐
                                              ▼                     ▼
                                       Cloud Firestore         Document AI
                                        Vector Search         (Document OCR parsing)
                                    (Integrated Embeddings)

[ EVENT-DRIVEN ASYNCHRONOUS DOCUMENT INGESTION (RAG) ]
5. User Browser ──────(Uploads Document)───────► Cloud Run (Uploads to Staging)
                                                         │
                                                         ▼
                                                   Cloud Storage (GCS) (prefix: staging/)
                                                         │
                                                   (GCS Notification)
                                                         │
                                                         ▼
                                                   Cloud Pub/Sub Topic (Buffers Job)
                                                         │
                                                   (Push Subscription Trigger)
                                                         │
                                                         ▼
                                                   Cloud Functions (2nd Gen / Cloud Run)
                                                         │
                                              ┌──────────┴──────────┐
                                              ▼                     ▼
                                       Cloud Firestore         Document AI
                                      (Upsert Vector Doc)     (Preserves MD Layouts)
```

---

## 2. Service-by-Service Migration Comparison

| AWS Service                    | GCP Equivalent                              | Migration Complexity | Adaptation Strategy                                                                                                                                 |
| :----------------------------- | :------------------------------------------ | :------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AWS Lambda + LWA (FastAPI)** | **Cloud Run**                               | **Low**              | Packaged as a standard container. Deploy directly to Cloud Run. Remove `AWS Lambda Web Adapter` layer; Cloud Run handles native HTTP routing.       |
| **AWS Lambda Function URL**    | **Cloud Run Service URL**                   | **Low**              | Expose Cloud Run directly via public URL. Cloud Run natively supports HTTP Response Streaming (Server-Sent Events) without proxy gateway buffering. |
| **Amazon Cognito User Pools**  | **Identity Platform** _(Firebase Auth)_     | **Low**              | Swap Amplify JS SDK on frontend for **Firebase Auth SDK**. Backend fetches JWKS from Google to verify JWT signatures offline.                       |
| **Amazon DynamoDB**            | **Cloud Firestore** _(Datastore or Native)_ | **Medium**           | Recreate Single-Table design inside Firestore documents. Map keys using indexes and nested structures. Firestore supports `TTL` (Time To Live).     |
| **Amazon S3 (Uploads)**        | **Cloud Storage (GCS)**                     | **Low**              | Swap S3 client operations to Google Cloud Storage Python client. Map S3 Presigned URLs to GCS Signed URLs.                                          |
| **Amazon S3 (Frontend Site)**  | **Firebase Hosting**                        | **Low**              | Best target. Firebase Hosting serves React/Vite outputs, handles SSL, CDN, custom domains, and rewrites all requests to `index.html` for SPAs.      |
| **Amazon S3 Vectors**          | **Firestore Vector Search**                 | **Medium**           | Firestore natively supports Vector Indexing and Vector Similarity queries (`VectorDistance`). No external vector client needed.                     |
| **Amazon SQS + DLQ**           | **Cloud Pub/Sub**                           | **Low**              | Create a Pub/Sub topic and use a **Push Subscription** to directly trigger the worker. Pub/Sub natively supports Dead Letter Topics.                |
| **AWS Lambda Worker**          | **Cloud Functions (2nd Gen)**               | **Low**              | Port background worker to a 2nd Gen Cloud Function. Cloud Functions 2nd Gen run natively on top of Cloud Run infrastructure.                        |
| **AWS Textract**               | **Document AI (OCR)**                       | **Low**              | Use Google's Document AI OCR processor. Document AI excels at layout detection and returns clean structural layouts.                                |
| **SSM Parameter Store**        | **Secret Manager**                          | **Low**              | Store secret keys as Secret Manager secrets. Inject them directly into Cloud Run/Functions environments via IAM bindings.                           |
| **CloudWatch Logs**            | **Cloud Logging**                           | **Low**              | `stdout` print statements and logging modules automatically feed into Google Cloud's Operations Suite (Stackdriver).                                |

---

## 3. Financial Matrix: Free Tiers vs. Paid Credits

GCP has some of the most generous and well-known serverless free tiers in the industry.

### 🟢 100% Free / Always Free Tiers

These services cost **$0.00** forever under moderate development use.

- **Identity Platform (Firebase Auth):**
  - _Grant:_ **50,000 Monthly Active Users (MAUs)** completely free for standard email/password accounts.
  - _Role:_ User sign-up and login directory.
- **Cloud Run:**
  - _Grant:_ **2 million requests**, 180,000 vCPU-seconds, and 360,000 GiB-seconds free _every single month_.
  - _Role:_ FastAPI Backend compute. If set to scale-to-zero, idle time is 100% free.
- **Cloud Functions (2nd Gen):**
  - _Grant:_ **2 million invocations** free monthly, along with additional compute seconds covered under the standard Cloud Run free allocation.
  - _Role:_ Ingestion background worker.
- **Cloud Pub/Sub:**
  - _Grant:_ First **10 GB of data transmission** per month completely free.
  - _Role:_ Decoupling upload events from processing.
- **Firebase Hosting:**
  - _Grant:_ **10 GB of storage** and **10 GB of bandwidth** per month free.
  - _Role:_ Static frontend React/Vite hosting.
- **Cloud Storage (GCS):**
  - _Grant:_ **5 GB of storage** per month (in specific regional buckets: `us-east1`, `us-west1`, `us-central1`), plus 5,000 Class A (write) and 50,000 Class B (read) operations free monthly.
  - _Role:_ User private uploads (Lifecycle rules delete items after 7 days, maintaining a sub-100MB footprint).
- **Cloud Firestore:**
  - _Grant:_ **1 GB of storage** per project, plus **50,000 reads, 20,000 writes, and 20,000 deletes** _every single day_.
  - _Role:_ Session databases and Vector database indexes.
- **Secret Manager:**
  - _Grant:_ First **6 active secret versions** are completely free, plus 10,000 secret access operations free monthly.
  - _Role:_ Storing Gemini/LiteLLM API tokens.
- **Cloud Logging (Stackdriver):**
  - _Grant:_ First **50 GB of log data ingestion** per project per month is completely free, with 30-day retention.
  - _Role:_ Request logging, trace outputs, and diagnostics.

### 🟡 Eligible for Free Tier (Limited/Temporary)

- **Document AI (OCR / Layout Analysis):**
  - _Grant:_ First **1,000 pages free per month** for standard Document OCR.
  - _After Limit:_ Standard OCR is **$1.50 per 1,000 pages** (Layout analysis is $15 per 1,000 pages).
  - _Role:_ Structural layout parsing for PDF documents.

### 🔴 Requires Credits / Paid Services

- **LLM Endpoints (via LiteLLM / Gemini):**
  - _Pricing Model:_ API tokens generated through Gemini/LiteLLM NIM endpoints are billed directly by their API providers, not GCP (unless using Vertex AI Model Garden endpoints).

---

## 4. GCP Cost Traps & Mitigation Strategies

Avoid these silent cost triggers on Google Cloud to ensure your deployment remains completely free:

### Trap #1: Leaving Cloud Run "Minimum Instances = 1"

- **The Danger:** Cloud Run has a "Min Instances" slider to mitigate cold starts. If `min-instances` is set to `1`, Google keeps your container warm 24/7. This consumes your free monthly vCPU/GiB allocations within days, leading to continuous billing.
- **The Mitigation:** Set `min-instances: 0` and `max-instances: 5` (or low limits). Embrace the minor cold-start latency to preserve your free tier.

### Trap #2: Storing GCS Blobs outside standard Regional Buckets

- **The Danger:** The GCS 5 GB free tier is strictly limited to specific US-regions (`us-east1`, `us-west1`, `us-central1`) using standard regional storage. Choosing multi-regional storage or placing your bucket in a European/Asian region will trigger billing immediately.
- **The Mitigation:** Always deploy GCS buckets inside one of the three free US regions and stick to **Standard Storage**. Set up an **Object Lifecycle Management Rule** to automatically delete uploads after 7 days.

### Trap #3: Exceeding daily Firestore write allowances with indexing loops

- **The Danger:** While Firestore gives you 20,000 free writes per day, a buggy vector ingestion loop or continuous batch upsert tests on large books can exceed this daily limit within minutes, triggering database charges.
- **The Mitigation:** Add chunk limits in your ingestion worker to prevent indexing multi-thousand-page documents during testing phases.

---

## 5. IaC & Local Development

To manage IaC, building, and local environments on GCP, you swap AWS SAM for:

### A. Infrastructure as Code (IaC): Terraform

Unlike AWS SAM which compiles to CloudFormation, GCP’s primary orchestration standard is **HashiCorp Terraform**. Terraform is fully open-source, highly modular, and manages GCP resources natively using declarative syntax.

Here is a snippet of HCL (`main.tf`) matching your AWS stack:

```hcl
# 1. Cloud Storage Bucket (S3 replacement)
resource "google_storage_bucket" "uploads" {
  name          = "chatbot-uploads-prod"
  location      = "US-CENTRAL1" # Eligible for GCS Free Tier
  storage_class = "STANDARD"

  lifecycle_rule {
    action { type = "Delete" }
    condition { age = 7 } // Auto-clean files after 7 days
  }
}

# 2. Cloud Run Service (Lambda + LWA replacement)
resource "google_cloud_run_service" "backend" {
  name     = "chatbot-backend"
  location = "us-central1"

  template {
    spec {
      containers {
        image = "gcr.io/my-project/chatbot-backend:latest"
        resources {
          limits = { cpu = "1000m", memory = "1024Mi" }
        }
      }
    }
    metadata {
      annotations = {
        "autoscaling.knative.dev/minScale" = "0" // Critical for $0/month scale-to-zero
        "autoscaling.knative.dev/maxScale" = "5"
      }
    }
  }
}
```

### B. Deployment CLI: The Google Cloud CLI (`gcloud`)

The equivalent to the `sam deploy` workflow is the **`gcloud` CLI**.

- Build your containers locally or via **Cloud Build** (`gcloud builds submit`).
- Deploy containerized code directly using simple commands:

  ```bash
  gcloud run deploy chatbot-backend --image gcr.io/my-project/chatbot-backend:latest --platform managed
  ```

### C. Local Testing Emulators: Firebase Emulator Suite

GCP offers one of the most cohesive local emulation environments in the industry: the **Firebase Emulator Suite**.

- Run `firebase emulators:start` to boot up **local, offline emulators** for:
  - **Firestore** (including vector index simulations).
  - **Firebase Hosting** (hosting local React/Vite configurations).
  - **Firebase Auth** (testing registration flows on localhost).

---

## 6. Summary Checklist for a Cost-Free Deployment (GCP)

To run the entire migrated stack on GCP for **$0.00/month**:

1. **Frontend:** Deploy React/Vite to **Firebase Hosting** (Free Plan).
2. **Backend Engine:** Host containerized FastAPI on **Cloud Run** (`min-instances: 0`).
3. **Database:** Deploy **Cloud Firestore** in Native Mode, utilizing its always-free daily quota.
4. **Vector Search:** Enable **Firestore Vector Indexing** within your Firestore databases.
5. **Decoupled Queue:** Route bucket triggers via **Cloud Pub/Sub** topics using a **Push Subscription** to target your worker.
6. **Ingestion Compute:** Deploy the worker as a **2nd Gen Cloud Function** (Consumption Plan).
7. **Secrets:** Bind parameters securely to **Google Secret Manager** (up to 6 secrets are free).
8. **Auth Directory:** Enable **Identity Platform** to manage user registers/logins.
9. **Infrastructure Orchestration:** Use **Terraform** and the **`gcloud` CLI** for deployment.
