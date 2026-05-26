# AWS to Azure Migration & Costing Guide

This guide details the optimal path for migrating the Serverless Chatbot application stack from Amazon Web Services (AWS) to Microsoft Azure. It breaks down the system architecture mapping, lists code-level adapter transitions, provides a comprehensive costing matrix, and warns against potential Azure cost traps.

---

## 1. High-Level Architectural Mapping

The serverless, event-driven flow translates natively into Azure's ecosystem.

```
[ STATIC SITE VISITS ]
1. User Browser ──────(Loads HTML/CSS/JS)──────► Azure Static Web Apps (Free CDN / SSL / Routing)

[ SIGN-UP / LOG-IN ]
2. User Browser ──────(Register/Authenticate)──► Microsoft Entra External ID (50k MAU Free Tier)

[ SECURED DATABASE & IMAGE ACTIONS (REST) ]
3. User Browser ──────(Requests /conversations)► Azure Container Apps Ingress (Validates Entra JWT)
                                                         │
                                                         ▼
                                                   Azure Container Apps (FastAPI Backend container)
                                                         │
                                              ┌──────────┴──────────┐
                                              ▼                     ▼
                                     Azure Cosmos DB NoSQL     Azure Blob Storage
                                     (Conversation History)    (Private User Images)

[ REAL-TIME CHAT RESPONSE STREAMING ]
4. User Browser ──────(Request /chat/stream)──► Azure Container Apps Ingress (Direct SSE Endpoint)
                                                         │
                                                         ▼
                                                   Azure Container Apps (FastAPI + LiteLLM + Gemini)
                                                         │
                                              ┌──────────┴──────────┐
                                              ▼                     ▼
                                     Azure Cosmos DB NoSQL   Azure AI Document
                                        Vector Search          Intelligence
                                    (Integrated Embeddings)   (Layout PDF parsing)

[ EVENT-DRIVEN ASYNCHRONOUS DOCUMENT INGESTION (RAG) ]
5. User Browser ──────(Uploads Document)───────► Azure Container Apps (Uploads to Staging)
                                                         │
                                                         ▼
                                                   Azure Blob Storage (container: uploads)
                                                         │
                                                   (Event Grid Notification)
                                                         │
                                                         ▼
                                                   Azure Service Bus Queue (Buffers Job)
                                                         │
                                                   (Triggers Function)
                                                         │
                                                         ▼
                                                   Azure Functions (Asynchronous Worker)
                                                         │
                                              ┌──────────┴──────────┐
                                              ▼                     ▼
                                     Azure Cosmos DB NoSQL   Azure AI Document
                                      (Upsert Vector Doc)      Intelligence
                                                             (Preserves MD Layouts)
```

---

## 2. Service-by-Service Migration Comparison

| AWS Service | Azure Equivalent | Migration Complexity | Adaptation Strategy |
| :--- | :--- | :--- | :--- |
| **AWS Lambda + LWA (FastAPI)** | **Azure Container Apps (ACA)** | **Low** | Packaged as a standard container. Deploy directly to ACA. Remove `AWS Lambda Web Adapter` layer; ACA supports native ingress routing. |
| **AWS Lambda Function URL** | **Azure Container Apps Ingress** | **Low** | Expose Container App endpoints with Ingress. ACA natively supports HTTP Chunked Transfer Encoding (Response Streaming). |
| **Amazon Cognito User Pools** | **Microsoft Entra External ID** | **Medium** | Swap Amplify JS SDK on frontend for **MSAL.js**. Backend uses standard Entra JWKS endpoints to verify JWT signatures. |
| **Amazon DynamoDB** | **Azure Cosmos DB for NoSQL** | **Medium** | Recreate Single-Table design inside a Cosmos container. Swap key schemas using partitions and indexes. Cosmos DB supports `TimeToLive` natively. |
| **Amazon S3 (Uploads)** | **Azure Blob Storage** | **Low** | Swap S3 client operations to Azure Blob Storage client. Map S3 Presigned URLs to Azure Blob Shared Access Signatures (SAS) URLs. |
| **Amazon S3 (Frontend Site)** | **Azure Static Web Apps (ASWA)** | **Low** | Ideal target. ASWA hosts standard React/Vite outputs, handles CDN distribution, custom domains, and sets up SPA routing fallback configurations. |
| **Amazon S3 Vectors** | **Cosmos DB Vector Search** | **Medium** | Instead of an external S3 Vector client, define a Vector Index directly inside the Cosmos DB Container. Enables metadata-filtered hybrid vector queries in one DB call. |
| **Amazon SQS + DLQ** | **Azure Service Bus (Queue)** | **Low** | Recreate FIFO or Standard queues using Service Bus Queues. Azure Service Bus has native dead-lettering support. |
| **AWS Lambda Worker** | **Azure Functions** | **Medium** | Port background worker to an Azure Function using a Service Bus Queue Trigger. |
| **AWS Textract** | **Azure AI Document Intelligence** | **Low** | Call the `prebuilt-layout` endpoint of Document Intelligence. Retain Markdown-based parsing outputs for RAG chunks. |
| **SSM Parameter Store** | **Azure Key Vault** | **Low** | Securely store third-party keys as Key Vault secrets. Bind ACA/Functions to retrieve them via Managed Identity. |
| **CloudWatch Logs** | **Azure Monitor Log Analytics** | **Low** | stdout / logging module output streams automatically capture inside Log Analytics / Application Insights. |

---

## 3. Financial Matrix: Free Tiers vs. Paid Credits

One of Azure's strongest features is its generous developer free tiers. Below is the detailed cost model categorizing which services are **100% Free**, **Eligible for Free Tier (with limitations)**, or **Require Credits/Paid Use**.

### 🟢 100% Free / Always Free Tiers
These services cost **$0.00** forever under moderate development use, regardless of how long the application runs.

* **Azure Static Web Apps (ASWA) [Free Tier Plan]:**
  * *Grant:* Unlimited hosting, free SSL certificates, custom domains, integrated global CDN, and 100 GB of outbound bandwidth per month.
  * *Role:* Chatbot React/Vite Frontend interface.
* **Microsoft Entra External ID:**
  * *Grant:* **50,000 Monthly Active Users (MAUs)** completely free! (Cognito's equivalent free tier caps at 10,000).
  * *Role:* User authentication, sign-ups, and logins.
* **Azure Container Apps (ACA):**
  * *Grant:* **180,000 vCPU-seconds, 360,000 GiB-seconds, and 2 million requests** free *every single month*. 
  * *Role:* Hosts the FastAPI Backend. If configured to scale-to-zero during periods of inactivity, this will remain completely inside the free tier.
* **Azure Functions [Consumption Plan]:**
  * *Grant:* **1 million execution requests and 400,000 GB-seconds** of serverless compute free *every single month*.
  * *Role:* Background ingestion worker processing files.
* **Azure Cosmos DB NoSQL [Free Tier Account]:**
  * *Grant:* **1,000 RU/s (Request Units) of provisioned throughput and 25 GB of storage** entirely free *for life* per subscription.
  * *Role:* Single-table schema and Vector database indexes.
* **Azure Monitor / Application Insights:**
  * *Grant:* **5 GB of log data ingestion per month** completely free, with 31-day data retention.
  * *Role:* Backend diagnostic logging and request tracing.

### 🟡 Eligible for Free Tier (Limited/Temporary)
These services have high limits but may trigger minor charges or transition to paid models after 12 months.

* **Azure Blob Storage [12-Month Free Tier]:**
  * *Grant:* **5 GB of LRS (Locally Redundant Storage)**, 20,000 read operations, and 20,000 write operations free monthly for the first 12 months.
  * *After 12 Months:* Extremely cheap. Storage of 5 GB is $\approx \$0.08/\text{month}$.
  * *Role:* User private uploads (Lifecycle rules will clean up files after 7 days, maintaining a near-zero footprint).
* **Azure Storage Queues [12-Month Free Tier]:**
  * *Grant:* Combined with the Blob Storage 12-month free tier. Provides 20,000 transactions free per month.
  * *Alternate option:* Azure Service Bus. The standard tier has a small base fee, but using **Storage Queues** for RAG decoupling is **100% free** for development.
  * *Role:* Buffering incoming PDF documents for parsing.
* **Azure Key Vault:**
  * *Grant:* Not strictly free, but priced at a fraction of a cent ($0.03 per 10,000 operations). Development use runs under $\$0.01/\text{month}$ and easily fits within a basic starter credit.
  * *Role:* Vault for storing LiteLLM API credentials.

### 🔴 Requires Credits / Paid Services
These services do not have continuous free tiers for this project's workflow and will draw down your Azure credits or require billing.

* **Azure AI Document Intelligence (OCR / Form Analysis):**
  * *Pricing Model:* The Free (`F0`) tier allows **500 free pages per month** (recurs monthly). If you exceed 500 pages of PDF documents, you must scale to the Standard (`S0`) tier, which costs **$10 per 1,000 pages** for Layout Analysis. 
  * *Study Trap:* Continuous bulk imports of large PDF libraries will consume credits quickly.
* **LLM Endpoints (via LiteLLM / Gemini):**
  * *Pricing Model:* LLM tokens consumed through NVIDIA NIM or Google Gemini APIs are charged by the respective third-party providers, not Azure.
* **Azure Service Bus [Standard Tier]:**
  * *Pricing Model:* If you choose Service Bus over Storage Queues for advanced enterprise message handling, the **Standard tier** charges a base fee of $\approx \$0.014/\text{hour}$ ($\approx \$10/\text{month}$).
  * *Mitigation:* Stick to **Azure Storage Queues** for lightweight development projects to avoid this charge.

---

## 4. Azure Cost Traps & Mitigation Strategies

Just like AWS, Azure has quiet cost triggers that developers should watch out for. Follow these rules to protect your credit line:

### Trap #1: Leaving Container Apps with "Minimum Replicas = 1"
* **The Danger:** Azure Container Apps can scale down to `0` replicas when there is no traffic. However, if your deploy template or CI/CD script defines `minReplicas: 1` to prevent cold starts, the container will run 24/7, burning through your free compute grant within days and billing you thereafter.
* **The Mitigation:** Always set `minReplicas: 0` in your container app spec configuration. Accept the minor cold-start latency ($2-3\text{s}$) for the sake of free hosting.

### Trap #2: Uncapped Cosmos DB Throughput (Autoscale vs. Manual Provisioned)
* **The Danger:** Cosmos DB can be provisioned in Autoscale mode, which defaults to scaling between 400 and 4,000 RU/s. This exceeds the 1,000 RU/s free tier limit, immediately charging you for the excess provisioned bandwidth.
* **The Mitigation:** When provisioning your Cosmos DB container, choose **Manual Throughput** and set the limit to exactly **400 RU/s**. This is highly performant for development and fits perfectly under the 1,000 RU/s Always Free limit, leaving you with 600 RU/s of headroom.

### Trap #3: Diagnostic Log Accumulation in Application Insights
* **The Danger:** Application Insights captures all standard console prints. If your FastAPI application runs in `DEBUG` mode and dumps long JSON payloads, massive logs will build up.
* **The Mitigation:** Keep `LOG_LEVEL` set to `INFO` or `WARNING` in your environment variables. 

### Trap #4: Blob Storage Replication
* **The Danger:** Configuring your storage account with **GRS (Geo-Redundant Storage)** replicates your data to another geographic region, doubling storage costs and charging for outbound bandwidth.
* **The Mitigation:** Set the storage replication type to **LRS (Locally Redundant Storage)**, which is local, fast, and fully covered under the 12-month free tier.

---

## 5. IaC & Local Development

In your AWS stack, **AWS SAM (Serverless Application Model)** serves three roles:
1. **Declarative IaC:** The `template.yaml` blueprint.
2. **Packaging & Deployment CLI:** `sam build` and `sam deploy`.
3. **Local Emulation:** `sam local start-api` for local serverless execution.

In Azure, this orchestration maps to a modern, developer-friendly ecosystem:

```
┌─────────────────────────────────┬──────────────────────────────────┐
│ AWS SAM Component               │ Azure Native Equivalent          │
├─────────────────────────────────┼──────────────────────────────────┤
│ template.yaml (SAM/CFN)         │ Azure Bicep (.bicep)             │
│ sam build / sam deploy          │ Azure Developer CLI (azd)        │
│ sam local (Lambda emulation)    │ Azure Functions Core Tools       │
│ AWS Cognito Auth Emulation      │ Azure Static Web Apps (SWA) CLI  │
└─────────────────────────────────┴──────────────────────────────────┘
```

### A. IaC: From SAM YAML to Azure Bicep
Azure Bicep is Azure's modern Domain-Specific Language (DSL) that compiles directly to ARM JSON templates. It is significantly more concise, supports modularity, has rich autocompletion, and automatically calculates resource dependency trees (eliminating `DependsOn` boilerplate).

Here is a preview of how your SAM resource definitions convert to an **Azure Bicep** template (`infra/main.bicep`):

```bicep
// Define environment context
param environmentName string = 'prod'
param location string = resourceGroup().location

// 1. Azure Blob Storage (equivalent to S3 Private Bucket)
resource storageAccount 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: 'chatbotuploads${uniqueString(resourceGroup().id)}'
  location: location
  sku: { name: 'Standard_LRS' } // Local replication to minimize costs
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

// 2. Azure Cosmos DB with Vector Search & Serverless Mode (DynamoDB & Vector Store replacement)
resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2023-11-15' = {
  name: 'chatbot-db-${environmentName}'
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    capabilities: [
      { name: 'EnableServerless' }      // Dynamic serverless pay-per-request model
      { name: 'EnableNoSQLVectorSearch' } // Built-in vector embedding indexes
    ]
    databaseAccountOfferType: 'Standard'
    locations: [{ locationName: location }]
  }
}

// 3. Azure Container App (FastAPI Backend replacement for Lambda + LWA)
resource containerApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: 'chatbot-backend'
  location: location
  properties: {
    configuration: {
      ingress: {
        external: true
        targetPort: 8080
        allowInsecure: false
        transport: 'auto' // Crucial for SSE HTTP response streaming
      }
    }
    template: {
      containers: [
        {
          name: 'fastapi-backend'
          image: 'myregistry.azurecr.io/chatbot-backend:latest'
          resources: { cpu: json('0.5'), memory: '1.0Gi' }
        }
      ]
    }
  }
}
```

### B. Deployment & Dev CLI: The Azure Developer CLI (`azd`)
The closest tool to the **SAM CLI** (`sam build` + `sam deploy`) is the **Azure Developer CLI (`azd`)**. 

It uses a single configuration file (`azure.yaml`) in the project root to bind the application code (FastAPI, React) to the infrastructure (Bicep/Terraform).

**The `azd` Deployment Workflow:**
1. **`azd init`**: Scans your code and bootstraps an Azure project context.
2. **`azd provision`**: Compiles Bicep files and sets up all serverless infrastructure.
3. **`azd deploy`**: Builds code projects (compiling React frontend, packing container images for FastAPI, and bundling Azure Functions) and deploys them to Azure.
4. **`azd up`**: Combines provisioning and deployment into a single command—the direct equivalent of `sam deploy --guided`.

### C. Local Testing: From `sam local` to SWA CLI & Core Tools
Instead of simulating raw Lambda functions inside local Docker containers with SAM, Azure relies on dedicated emulator runtimes:

1. **Azure Functions Core Tools (`func`):**
   * Install via NPM or Homebrew: `npm install -g azure-functions-core-tools`.
   * **Usage:** Run `func host start` inside your `backend/` worker folder to run a local replica of the serverless runtime, exposing queue/event triggers over localhost.
2. **Azure Static Web Apps CLI (`swa`):**
   * The **SWA CLI** (`npm install -g @azure/static-web-apps-cli`) is a powerful emulator that runs a local server simulating the entire front-to-back architecture:
     * Serves the React frontend.
     * Proxies API calls directly to your local FastAPI backend.
     * Emulates **Entra ID authentication / login** so you can test secure headers and JWT extraction on localhost without configuring live cloud directories!
   * **Usage:** `swa start http://localhost:5173 --api-location http://localhost:8080`

---

## 6. Summary Checklist for a Cost-Free Deployment

If you want to run this entire migrated chatbot on Azure for **$0.00/month**, build your environment using this setup checklist:

1. **Frontend:** Deploy React/Vite to **Azure Static Web Apps** (Free Plan).
2. **Backend Engine:** Host containerized FastAPI on **Azure Container Apps** (`minReplicas: 0`, `maxReplicas: 5`).
3. **Database:** Deploy **Cosmos DB for NoSQL** utilizing the **Free Tier Discount** flag, manually capping container throughput at **400 RU/s**.
4. **Vector Search:** Configure Vector Indexing inside your **Cosmos DB NoSQL Container** rather than spinning up a separate search service.
5. **Decoupled Queue:** Use **Azure Storage Queues** (12-month free standard storage transactions) instead of Azure Service Bus Standard tier.
6. **Ingestion Compute:** Deploy the worker as an **Azure Function** under the Consumption Plan.
7. **Secrets:** Bind parameters to **Azure Key Vault** utilizing system-assigned Managed Identity for passwordless connection.
8. **Auth Directory:** Create a **Microsoft Entra External ID** tenant to manage user authentication.
9. **Infrastructure Orchestration:** Use **Azure Bicep** and **Azure Developer CLI (`azd`)** for standard deployment automations.

