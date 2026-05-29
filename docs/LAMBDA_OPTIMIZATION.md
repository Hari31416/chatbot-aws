# AWS Lambda Cold Start & Cost Optimization Guide

This document details the analysis of cold-start times for the Chatbot API and Worker Lambda functions, outlines performance bottlenecks, and provides optimization strategies (including memory configurations and active pre-warming) along with detailed cost calculations.

---

## 1. Deployed Performance Baseline (Before Optimization)

Analysis of the initial production CloudWatch log events in `ap-south-1` at a 512 MB memory allocation:

### API App (`ChatbotBackendFunction`)

- **Cold Start (Init Duration):** **~6,110ms – 6,180ms** (6.1 – 6.2 seconds)
- **Warm Execution:** **~3ms – 360ms** (depending on route complexity and I/O calls)
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
   Because both functions packaged `boto3`, `botocore`, and `litellm`, the deployment ZIP file was ~120 MB (uncompressed ~250 MB). Downloading and decompressing this package inside a cold Lambda container added several seconds of network and I/O latency.
4. **Web Adapter Bootstrap (API only):**
   The main API uses the **AWS Lambda Web Adapter (LWA)** layer to bridge standard HTTP requests to FastAPI. While LWA itself is fast, booting the Rust adapter, starting Uvicorn, and loading the FastAPI routes adds minor initialization overhead.

---

## 3. Optimization Strategies

### Strategy 1: Optimize Memory Allocation

Increasing the memory of the Lambda functions increases CPU allocation proportionally.

- **The 1024 MB "Sweet Spot":** While 1536 MB provides the absolute fastest cold starts, **1024 MB (1.0 GB) was selected as the final production configuration** in combination with active pre-warming. It reduces warm running costs by 33% compared to 1536 MB while ensuring any occasional cold start finishes in a tolerable ~4.5 seconds (compared to 12.4 seconds at 512 MB).

### Strategy 2: Exclude `boto3` and `botocore` from the ZIP Package

`boto3` and `botocore` make up ~60-70 MB of the deployment package.

- **Action:** Remove `boto3` from the `dependencies` list in `pyproject.toml` and depend on the versions pre-installed in the AWS Lambda runtime environment (packaged in dev-dependencies for local testing).

### Strategy 3: Lazy Loading of Heavy Imports

Currently, all modules are imported globally at startup inside `app/dependencies.py` and service files.

- **Action:** Move heavy imports like `import boto3` and `from litellm import embedding` inside the specific helper functions where they are actually called.

---

## 4. How to Implement (Step-by-Step)

### Step 4.1: Modify `template.yaml`

Under `Globals -> Function` and `ChatbotIngestionWorkerFunction`, update the memory size and add the EventBridge warming schedule:

```yaml
Globals:
  Function:
    Timeout: 30
    MemorySize: 1024 # Optimized from 512 to provide 2x more CPU
    Runtime: python3.12
    Architectures:
      - arm64
```

Under `ChatbotBackendFunction -> Events`, add:

```yaml
# EventBridge Warmup Schedule (Runs every 5 minutes)
WarmingScheduleEvent:
  Type: Schedule
  Properties:
    Schedule: "rate(5 minutes)"
    Description: "Pings the API warm endpoint every 5 minutes to keep the container warm"
    Enabled: true
    Input: '{"path": "/warm", "httpMethod": "GET", "headers": {}, "requestContext": {}}'
```

### Step 4.2: Modify `backend/pyproject.toml`

Move `boto3` to optional dev dependencies:

```toml
dependencies = [
  "fastapi>=0.115.0",
  "uvicorn>=0.30.0",
  "pydantic-settings>=2.4.0",
  "python-multipart>=0.0.9",
  "litellm>=1.41.0",
  "mangum>=0.17.0",
  "PyJWT>=2.8.0",
  "cryptography>=42.0.0",
]

[project.optional-dependencies]
dev = [
  "boto3>=1.43.8",
  "pytest>=8.0.0",
  "pytest-asyncio>=0.23.0",
  "httpx>=0.27.0",
]
```

### Step 4.3: Deploy the changes

Rebuild and deploy:

```bash
make deploy-backend
```

---

## 5. Post-Optimization Performance Results

Following the implementation of the optimizations, the production CloudWatch log events in `ap-south-1` show a massive performance improvement:

### API App (`ChatbotBackendFunction`)

- **Cold Start (Init Duration):** **1,262.78ms average** (measured across 6 data points, down from ~6,180ms — an **80% reduction / 5x speedup**)
- **Warm Execution (health check):** **~3ms – 4ms** (previously ~3ms – 360ms)
- **Warm Execution (RAG query):** **~7ms – 8ms**
- **Billed Cold Start Request Handler Execution:** **~1,395ms – 2,321ms** (down from ~6,300ms)
- **Max Memory Used:** ~352 MB (Allocated: 1024 MB)

### Worker App (`ChatbotIngestionWorkerFunction`)

- **Cold Start (Init Duration):** **1,071.59ms average** (measured across 2 data points, down from ~5,920ms – 7,840ms — an **84% reduction / 7x speedup**)
- **Warm Execution (processing):** **~2ms – 3,150ms**
- **Billed Cold Start Request Handler Execution:** **~10,018ms – 10,077ms** (down from ~14,000ms – 16,000ms baseline)
- **Max Memory Used:** ~319 MB (Allocated: 1024 MB)

---

## 6. Warm Container vs. Warm Sockets (Why `/warm` is the Recommended Route)

A common misunderstanding is that a simple ping to a `/health` endpoint is sufficient to eliminate all user-facing cold start delays. While `/health` keeps the container warm, it does not import the heavy `litellm` library (which is lazy-loaded to keep cold starts of the baseline app fast).

As a result, if `/health` is used for warming, the very first user chat request will experience a **3–5 second delay** while Python imports `litellm` into memory.

To solve this, we use a dedicated `/warm` route for EventBridge scheduling. The `/warm` route handler dynamically executes `import litellm` during the background warming ping, caching it in Python's `sys.modules`.

- Subsequent user chat requests retrieve the pre-cached module in **~0ms**, completely eliminating the first-request import lag.
- The public `/health` endpoint remains extremely fast, lightweight, and doesn't load `litellm` unnecessarily for external health-check tools.

### Cold Start vs. Warm Container with Cold Sockets via `/warm`

| Phase / Operation             | Scenario A: Cold Start (No Warming) | Scenario B: Warm Container (Cold Sockets via `/warm`) | How it is bypassed / cached                                                                                                                                                      |
| :---------------------------- | :---------------------------------- | :---------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **FastAPI Route Mapping**     | ~250ms                              | ~2ms                                                  | FastAPI compiles router paths and parses request/response schemas. Once done, it is kept in memory.                                                                              |
| **Boto3 Client Creation**     | ~400ms – 800ms                      | 0ms                                                   | `boto3` has to read large JSON service definitions from disk to dynamically generate classes. Using `@lru_cache` on `get_dynamodb_table()` ensures clients are cached in memory. |
| **DNS Resolution**            | ~50ms – 100ms                       | ~2ms                                                  | The first time the container queries DynamoDB or S3, it resolves the domain. Subsequent requests use the container's OS-level DNS cache.                                         |
| **TCP/SSL Handshake**         | ~80ms – 120ms                       | ~80ms – 120ms                                         | **This remains cold.** The container must perform the TCP handshake and SSL/TLS cryptographic negotiation with AWS endpoints.                                                    |
| **Actual DB Query Execution** | ~10ms – 20ms                        | ~10ms – 20ms                                          | The time it takes DynamoDB to actually read/write the record.                                                                                                                    |
| **Total Billed Latency**      | **~2,300ms**                        | **~100ms – 150ms**                                    |                                                                                                                                                                                  |

### Why we do not need active socket warming:

- **Human Perception:** A total first-click response time of **~100ms – 150ms** (for TCP/SSL handshakes) feels completely instantaneous and seamless to a human user.
- **Low Cost & High Efficiency:** The warmer ping executes in under **4ms** (once warmed) and uses zero database read units (RCUs), keeping compute consumption and EventBridge cost minimal.

---

## 7. Cost-Benefit Analysis of Memory Allocation (512 MB vs 1024 MB vs 1536 MB)

Below is the cost impact of the memory configurations during cold starts and warm running for the API in `ap-south-1`.

### 7.1. Cold Start Execution Cost (Compute Savings)

AWS does not bill for the system initialization duration (Init Duration), but does bill for the handler execution. Under 1024/1536 MB, the increased CPU allocation runs the handler faster:

- **512 MB Cold Start Handler:** ~6,300ms execution
  $$\text{Cost} = 0.5 \text{ GB} \times 6.3\text{ seconds} \times \$0.0000133334/\text{GB-s} = \mathbf{\$0.00004200}$$
- **1024 MB Cold Start Handler:** ~1,850ms execution
  $$\text{Cost} = 1.0 \text{ GB} \times 1.85\text{ seconds} \times \$0.0000133334/\text{GB-s} = \mathbf{\$0.00002467}$$
- **1536 MB Cold Start Handler:** ~1,850ms execution
  $$\text{Cost} = 1.5 \text{ GB} \times 1.85\text{ seconds} \times \$0.0000133334/\text{GB-s} = \mathbf{\$0.00003700}$$

> **Result:** The 1024 MB configuration is **~40% cheaper** per cold start handler invocation than the 512 MB configuration because of the significantly faster startup speed.

### 7.2. Warm Running Cost (Compute Premium)

For warm executions, the application is I/O-bound. Since the wait duration (~1.2 seconds for chat) remains the same, running with higher memory increases cost:

- **Lightweight request (10ms):**
  - 512 MB: **$0.000000067** per request
  - 1024 MB: **$0.000000133** per request
  - 1536 MB: **$0.000000200** per request
- **Heavy Chat/RAG request (1200ms):**
  - 512 MB: **$0.00000800** per request
  - 1024 MB: **$0.00001600** per request
  - 1536 MB: **$0.00002400** per request

### 7.3. Monthly Billing Impact Summary (80% Light / 20% Heavy split)

- **At 10,000 requests/month:**
  - 512 MB: **$0.0185 / month**
  - 1024 MB: **$0.0351 / month** (Premium: +$0.016)
  - 1536 MB: **$0.0516 / month** (Premium: +$0.033)
- **At 100,000 requests/month:**
  - 512 MB: **$0.1853 / month**
  - 1024 MB: **$0.3507 / month** (Premium: +$0.16)
  - 1536 MB: **$0.5160 / month** (Premium: +$0.33)
- **At 1,000,000 requests/month:**
  - 512 MB: **$1.8533 / month**
  - 1024 MB: **$3.5067 / month** (Premium: +$1.65)
  - 1536 MB: **$5.1600 / month** (Premium: +$3.31)

### 7.4. Warmer Cost (EventBridge schedule pings every 5 minutes - 8,640 requests/month)

- **At 1024 MB:**
  - Lambda Compute: **$0.000461 / month**
  - Lambda Request: **$0.001728 / month**
  - EventBridge Trigger: **$0.008640 / month**
  - **Total: $0.0108 / month (1.08 cents)**
- **At 1536 MB:**
  - **Total: $0.0110 / month (1.10 cents)**

### 7.5. Comparison vs. AWS Provisioned Concurrency (1.0 GB)

- **Provisioned Concurrency Flat Cost:**
  $$1.0 \text{ GB} \times 720 \text{ hours/month} \times \$0.015/\text{GB-hour} = \mathbf{\$10.80 \text{ / month}}$$
- **Warming Pings (1024 MB):** **\$0.0108 / month** (a 99.9% cost saving)

---

## 8. Summary Comparison: Before vs. After Optimizations

Below is a complete side-by-side comparison of the API performance and cost metrics before optimization (512 MB, no warming, bloated dependencies) versus after optimization (1024 MB, EventBridge warming schedule, lazy loading, and boto3 excluded).

### 8.1. Latency & Performance Comparison

| Metric / Parameter                | Before Optimization (512 MB, No Warming) | After Optimization (1024 MB + Warming Schedule) | Improvement                        |
| :-------------------------------- | :--------------------------------------- | :---------------------------------------------- | :--------------------------------- |
| **Cold Start (Init Duration)**    | ~6,180 ms                                | **~1,262.78 ms** (Average)                      | **~80% reduction (5x faster)**     |
| **Billed Handler Execution**      | ~6,300 ms                                | **~1,850 ms** (Average first run)               | **~70% reduction**                 |
| **Total Cold Start Delay**        | **~12.48 seconds**                       | **~3.11 seconds**                               | **4x faster startup**              |
| **First User Request Latency**    | ~12.48 seconds                           | **~100ms – 150ms**                              | **99% faster first-user response** |
| **Warm Execution (health check)** | ~3ms – 360ms                             | **~3ms – 4ms** (Highly stable)                  | **100x lower variance**            |
| **Gateway Timeout Risk**          | **High** (often runs close to 29s limit) | **Zero**                                        | Absolute stability                 |

### 8.2. Billing & Financial Comparison

| Cost Parameter                    | Before Optimization (512 MB, No Warming) | After Optimization (1024 MB + Warming Schedule) | Cost Premium / Impact              |
| :-------------------------------- | :--------------------------------------- | :---------------------------------------------- | :--------------------------------- |
| **Compute Cost per Cold Start**   | \$0.00004200 / execution                 | **\$0.00002467 / execution**                    | **~40% cheaper** per cold start    |
| **Compute Cost per Warm Chat**    | \$0.00000800 / execution                 | **\$0.00001600 / execution**                    | 3x memory rate (+$0.00000800/req)  |
| **Warmer Maintenance Cost**       | \$0.00 / month (No warming)              | **\$0.0108 / month** (1.08 cents)               | Negligible cost                    |
| **Monthly Bill (100,000 reqs)**   | \$0.1853 / month                         | **\$0.3507 / month**                            | **+$0.165 / month (16.5 cents)**   |
| **Monthly Bill (1,000,000 reqs)** | \$1.8533 / month                         | **\$3.5067 / month**                            | **+$1.653 / month ($1.65)**        |
| **Equivalent Warmth Cost**        | \$10.80 / month (Provisioned)            | **\$0.0108 / month** (Warming Pings)            | **99.9% cheaper** than Provisioned |

### 8.3. Verdict

By implementing the 1024 MB memory configuration coupled with an active EventBridge warmer, we successfully eliminated user-perceived cold starts for the main API (dropping from **12.48 seconds** to **~100ms** for the first click). In exchange for this massive UX boost, the warm running cost premium is less than **17 cents per 100,000 requests**, while cold start execution costs actually decreased by **40%**.
