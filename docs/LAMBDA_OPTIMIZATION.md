# AWS Lambda Cold Start & Cost Optimization Guide

This document details the analysis of the existing cold-start times for the Chatbot API and Worker Lambda functions, outlines the core performance bottlenecks, and provides actionable optimization strategies along with their cost considerations.

---

## 1. Deployed Performance Baseline

Analysis of the production CloudWatch log events in `ap-south-1` reveals the following execution profile for the deployed functions:

### API App (`ChatbotBackendFunction`)

- **Cold Start (Init Duration):** **~6,110ms – 6,180ms** (6.1 – 6.2 seconds)
- **Warm Execution:** **~3ms – 360ms** (depending on route complexity and IO calls)
- **Max Memory Used:** ~284 MB (Allocated: 512 MB)

### Worker App (`ChatbotIngestionWorkerFunction`)

- **Cold Start (Init Duration):** **~5,920ms – 7,840ms** (5.9 – 7.8 seconds)
- **Warm Execution:** **~2ms – 3,150ms** (excluding active processing duration)
- **Max Memory Used:** ~314 MB (Allocated: 512 MB)

> [!WARNING]
> A cold start of **6+ seconds** is a major bottleneck for the user-facing API, causing initial chat requests or UI views to feel unresponsive.

---

## 2. Core Bottlenecks

1. **CPU Constrained Environment (512 MB Memory):**
   AWS Lambda allocates CPU power proportionally to the configured memory. At 512 MB RAM, the function only receives a small fraction of a CPU core. Decompressing the ZIP deployment package and executing Python's startup routines are heavily CPU-bound and run very slowly.
2. **Heavy Dependency Imports (`litellm`):**
   The `litellm` library has a deep dependency tree, importing heavy libraries such as `openai`, `pydantic`, `tiktoken`, and `tokenizers`. The initialization of these libraries (especially compiled C-extensions like `regex` and `tokenizers`' internal Rust models) takes up **80%+ of the initialization phase**.
3. **Large Deployment Package Size:**
   Because both functions package `boto3`, `botocore`, and `litellm`, the deployment ZIP file is ~120 MB (uncompressed ~250 MB). Downloading and decompressing this package inside a cold Lambda container adds several seconds of network and I/O latency.
4. **Web Adapter Bootstrap (API only):**
   The main API uses the **AWS Lambda Web Adapter (LWA)** layer to bridge standard HTTP requests to FastAPI. While LWA itself is fast, booting the Rust adapter, starting Uvicorn, and loading the FastAPI routes adds minor initialization overhead.

---

## 3. Optimization Strategies

### Strategy 1: Increase Memory Allocation (Recommended)

Increasing the memory of the Lambda functions increases CPU allocation proportionally.

- **How it Works:** Increase `MemorySize` to `1536 MB` or `2048 MB` in `template.yaml`.
- **Expected Cold Start Reduction:** **Cut in half (from ~6.1s down to ~1.5s – 2.0s)**.
- **Cost Considerations (ARM64 architecture at $0.0000133334/GB-s):**
  - **For Cold Starts:** Cost remains **neutral**. A 1.5 GB Lambda running for 2 seconds costs the exact same as a 0.5 GB Lambda running for 6 seconds (`2s × 1.5GB = 3 GB-s` vs `6s × 0.5GB = 3 GB-s`).
  - **For Warm Executions (IO-bound):** Since waiting on external API calls (e.g., LiteLLM completions) cannot speed up with more CPU, a 500ms request will cost more. However, the absolute difference is negligible:
    - _512 MB:_ **$3.33** per million requests.
    - _1536 MB:_ **$10.00** per million requests.

### Strategy 2: Exclude `boto3` and `botocore` from the ZIP Package

`boto3` and `botocore` make up ~60-70 MB of the deployment package.

- **How it Works:** Remove `boto3` and `botocore` from the `dependencies` list in `pyproject.toml` and depend on the versions pre-installed in the AWS Lambda runtime environment.
- **Expected Cold Start Reduction:** Shaves off **500ms – 1.0s** of package download and decompression time.
- **Cost Considerations:** Fully free.
- **Caveat:** The pre-installed runtime version of `boto3` is maintained by AWS. For standard S3/DynamoDB usages, this is safe and highly recommended.

### Strategy 3: Lazy Loading of Heavy Imports

Currently, all modules are imported globally at startup inside `app/dependencies.py` and service files.

- **How it Works:** Move heavy imports like `import boto3` and `from litellm import embedding` inside the specific helper functions where they are actually called.
- **Expected Cold Start Reduction:**
  - For non-LLM API routes (e.g., `/health` or listing conversations), the cold start drops to **~300ms – 500ms** because `litellm` and `boto3` are completely bypassed.
- **Cost Considerations:** Fully free.

---

## 4. How to Implement (Step-by-Step)

To implement the recommended optimizations (Memory Increase & Boto3 Exclusion), follow these changes:

### Step 4.1: Modify `template.yaml`

Under `Globals -> Function`, increase the memory size:

```yaml
Globals:
  Function:
    Timeout: 30
    MemorySize: 1024 # Increased from 512 to provide 2x more CPU
    Runtime: python3.12
    Architectures:
      - arm64
```

### Step 4.2: Modify `backend/pyproject.toml`

Remove `boto3` from the packaged dependencies so that SAM does not zip it:

```toml
dependencies = [
  "fastapi>=0.115.0",
  "uvicorn>=0.30.0",
  "pydantic-settings>=2.4.0",
  "python-multipart>=0.0.9",
  # "boto3>=1.43.8", <-- Removed to use the Lambda runtime version
  "litellm>=1.41.0",
  "mangum>=0.17.0",
  "PyJWT>=2.8.0",
  "cryptography>=42.0.0",
]
```

### Step 4.3: Deploy the changes

Rebuild and deploy:

```bash
# Run local requirements export and rebuild
make deploy-backend
```
