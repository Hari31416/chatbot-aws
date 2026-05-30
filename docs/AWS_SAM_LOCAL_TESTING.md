# AWS SAM Local Testing & Debugging Guide

This guide provides comprehensive instructions on how to run, test, and debug your serverless backend application locally using the **AWS SAM (Serverless Application Model) CLI** and **Docker**.

---

## 🛠️ Overview of SAM Local Capabilities

AWS SAM CLI offers several commands to emulate AWS serverless services locally:

1. **`sam local start-api`**: Spawns a local HTTP server hosting your FastAPI application via API Gateway HTTP API emulation.
2. **`sam local invoke`**: Executes a one-off invocation of a specific Lambda function (such as the Ingestion Initializer or Ingestion Processor) with a mock event payload.
3. **`sam local start-lambda`**: Establishes a local endpoint mimicking the AWS Lambda Service, allowing programmatic invocation via `boto3` or other AWS SDKs.

```mermaid
graph TD
    Client["Client / curl / Postman"]
    MockS3Event["Mock S3 Event"]
    MockSQSEvent["Mock SQS Event"]

    subgraph SAMLocal["AWS SAM Local Emulation (Docker)"]
        API["sam local start-api (Port 8080)"]
        InvokeInit["sam local invoke ChatbotIngestionInitializerFunction"]
        InvokeProc["sam local invoke ChatbotIngestionProcessorFunction"]

        subgraph Containers["Lambda Execution Container"]
            LWA["Lambda Web Adapter (LWA)"]
            FastAPI["FastAPI App (uvicorn)"]
            Initializer["Ingestion Initializer"]
            Processor["Ingestion Processor"]
        end
    end

    Client -->|HTTP Requests| API
    API -->|Proxies to| LWA
    LWA -->|HTTP| FastAPI

    MockS3Event -->|Direct Payload| InvokeInit
    InvokeInit -->|Runs Initializer| Initializer

    MockSQSEvent -->|Direct Payload| InvokeProc
    InvokeProc -->|Runs Processor| Processor
```

---

## 📋 Prerequisites

Before proceeding, ensure you have the following installed on your host machine:

- **Docker Desktop**: Must be running (SAM runs functions within dedicated Docker container instances).
- **AWS SAM CLI**: [Install SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html).
- **Python 3.12** & **`uv` package manager**.

---

## 🚀 Step-by-Step Instructions

### 1. Build the Application

Before running any local testing command, you must package the application using `sam build`.

Because the project utilizes `uv` for dependency resolution, we first export a flat `requirements.txt` file which the SAM builder parses:

```bash
# 1. Navigate to the backend directory and export requirements.txt
cd backend
uv export --format requirements-txt --no-hashes --no-emit-project -o requirements.txt
cd ..

# 2. Build the SAM template inside a container
sam build --use-container
```

> [!TIP]
> **Why `--use-container`?**
> This compiles any binary C-extensions inside a Docker container matching the AWS Lambda execution environment (Amazon Linux), avoiding runtime dynamic link errors.

---

### 2. Configure Local Environment Variables (`env.json`)

Since SAM runs functions inside isolated containers, they do not automatically inherit your shell's environment variables.

Create a file named `env.json` in the root of your project:

```json
{
  "ChatbotBackendFunction": {
    "Environment": "dev",
    "DYNAMODB_TABLE_NAME": "chatbot-table-dev",
    "S3_BUCKET_NAME": "chatbot-uploads-dev",
    "LITELLM_MODEL": "openai/gpt_oss_120b",
    "LITELLM_BASE_URL": "https://infer.e2enetworks.net/project/p-12449/genai/gpt_oss_120b/v1/",
    "LITELLM_API_KEY": "your-api-key-here",
    "LITELLM_VISION_MODEL": "gemini/gemini-3.1-flash-lite",
    "LITELLM_EMBEDDING_MODEL": "gemini/gemini-embedding-2",
    "S3_VECTOR_BUCKET_NAME": "chatbot-vectors-dev",
    "S3_VECTOR_INDEX_NAME": "enterprise-kb",
    "EMBEDDING_DIMENSION": 768,
    "RAG_TOP_K": 5,
    "CLERK_ISSUER": "https://clerk.chat.hari31416.in",
    "CLERK_AUTHORIZED_PARTIES": "https://chat.hari31416.in",
    "LOG_LEVEL": "DEBUG"
  },
  "ChatbotIngestionInitializerFunction": {
    "Environment": "dev",
    "DYNAMODB_TABLE_NAME": "chatbot-table-dev",
    "S3_BUCKET_NAME": "chatbot-uploads-dev",
    "PROCESSOR_QUEUE_URL": "https://sqs.ap-south-1.amazonaws.com/123456789012/chatbot-processor-queue-dev",
    "TEXTRACT_SNS_TOPIC_ARN": "arn:aws:sns:ap-south-1:123456789012:chatbot-textract-completion-dev",
    "TEXTRACT_SNS_ROLE_ARN": "arn:aws:iam::123456789012:role/chatbot-textract-sns-role-dev",
    "LOG_LEVEL": "DEBUG"
  },
  "ChatbotIngestionProcessorFunction": {
    "Environment": "dev",
    "DYNAMODB_TABLE_NAME": "chatbot-table-dev",
    "S3_BUCKET_NAME": "chatbot-uploads-dev",
    "LITELLM_EMBEDDING_MODEL": "gemini/gemini-embedding-2",
    "LITELLM_API_KEY": "your-api-key-here",
    "S3_VECTOR_BUCKET_NAME": "chatbot-vectors-dev",
    "S3_VECTOR_INDEX_NAME": "enterprise-kb",
    "EMBEDDING_DIMENSION": 768,
    "LOG_LEVEL": "DEBUG"
  }
}
```

---

### 3. Emulating the HTTP API Gateway (`sam local start-api`)

This hosts your FastAPI application behind a local API Gateway server.

```bash
sam local start-api --env-vars env.json --port 8080
```

- **Interactive Docs**: Visit `http://localhost:8080/docs` in your browser.
- **Health Check**:

  ```bash
  curl http://localhost:8080/health
  # {"status":"ok"}
  ```

- **Send a Chat Message**:

  ```bash
  curl -X POST http://localhost:8080/chat \
    -H "Content-Type: application/json" \
    -d '{"message": "Hello, bot!", "user_id": "tester"}'
  ```

---

### 4. Testing the Ingestion Initializer & Processor (`sam local invoke`)

With the two-lambda hybrid architecture, you can test both functions independently:

#### 4.1 Testing Ingestion Initializer (Lambda 1 — S3 Event)

##### Step A: Generate a Mock S3 Event Payload

Save the following as `events/s3-event.json`:

```json
{
  "Records": [
    {
      "s3": {
        "bucket": {
          "name": "chatbot-uploads-dev"
        },
        "object": {
          "key": "staging/tester/doc123/sample_report.txt"
        }
      }
    }
  ]
}
```

##### Step B: Invoke the Initializer

```bash
sam local invoke ChatbotIngestionInitializerFunction \
  --event events/s3-event.json \
  --env-vars env.json
```

SAM will invoke `app.worker_initializer.handler`, which parses the S3 metadata, updates the document status to `processing`, and enqueues a text ingestion payload to the `ProcessorQueue` SQS.

---

#### 4.2 Testing Ingestion Processor (Lambda 2 — SQS Event)

##### Step A: Generate a Mock SQS Event Payload

Save the following direct text payload as `events/sqs-processor-event.json`:

```json
{
  "Records": [
    {
      "messageId": "19dd0b1e-9b69-4e1b-a0cc-de5d1947b415",
      "receiptHandle": "MessageReceiptHandle",
      "body": "{\n  \"source\": \"text\",\n  \"document_id\": \"doc123\",\n  \"user_id\": \"tester\",\n  \"filename\": \"sample_report.txt\",\n  \"s3_key\": \"staging/tester/doc123/sample_report.txt\"\n}",
      "eventSource": "aws:sqs"
    }
  ]
}
```

##### Step B: Invoke the Processor

```bash
sam local invoke ChatbotIngestionProcessorFunction \
  --event events/sqs-processor-event.json \
  --env-vars env.json
```

SAM will invoke `app.worker_processor.handler`, which downloads the text file from the staging bucket path, runs semantic chunking and embedding, upserts embeddings to `AWS S3 Vectors`, updates the DynamoDB table status to `ready`, and deletes the staging file from S3.

---

### 5. Running a Local Lambda Endpoint (`sam local start-lambda`)

If you wish to test programmatic invocations (e.g. executing lambda invokes from the AWS SDK/CLI):

```bash
sam local start-lambda --env-vars env.json --port 3001
```

You can then test via the AWS CLI:

```bash
aws lambda invoke \
  --function-name "ChatbotBackendFunction" \
  --endpoint-url "http://127.0.0.1:3001" \
  --no-verify-ssl \
  out.json
```

---

## 🛜 Connecting to Local Databases (DynamoDB / Minio)

If you are running DynamoDB Local or Minio on your host machine inside a Docker container network:

1. **Find the Docker network name** running your local infrastructure (e.g. `chatbot-network`):

   ```bash
   docker network ls
   ```

2. **Launch SAM Local** inside that same Docker network:

   ```bash
   sam local start-api --env-vars env.json --port 8080 --docker-network chatbot-network
   ```

3. **Update your `env.json` endpoints** to target the docker service names instead of `localhost`:

   ```json
   "DYNAMODB_ENDPOINT_URL": "http://dynamodb-local:8000",
   "S3_ENDPOINT_URL": "http://minio-s3:9000",
   "S3_FORCE_PATH_STYLE": "true",
   "S3_VECTOR_ENDPOINT_URL": "http://minio-s3:9000"
   ```

---

## 💡 Troubleshooting & Performance Tips

- **Fast Rebuilds**: If you only make changes to your Python source code files (and have not introduced new dependencies in `pyproject.toml`), you can run `sam build` without the `--use-container` flag. It completes in a fraction of the time!
- **Warm Containers**: To keep the Docker container running between API requests (improving response time significantly during testing), use the `--warm-containers` flag:

  ```bash
  sam local start-api --env-vars env.json --port 8080 --warm-containers EAGER
  ```

- **Debug Port Integration**: You can attach VS Code or PyCharm remote debuggers by exposing port 5678 inside the SAM runtime:

  ```bash
  sam local start-api --env-vars env.json -d 5678
  ```
