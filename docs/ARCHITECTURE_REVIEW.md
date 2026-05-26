# Architecture Review — Chatbot AWS

A comprehensive review of the current serverless architecture across security, performance, and AWS best practices.

---

## Summary

The architecture is well-structured for a serverless chatbot: single Lambda with LWA for streaming, Cognito JWT auth at the API Gateway edge, DynamoDB single-table design, SSM for secrets, and S3 for uploads and frontend hosting. The foundation is solid. The recommendations below are improvements to harden it for production use.

---

## 🔴 Critical — Fix Before Production

### 1. Lambda Function URL has `AuthType: NONE`

**Location**: `template.yaml` line 121

```yaml
FunctionUrlConfig:
  AuthType: NONE  # ← Public to the internet
  InvokeMode: RESPONSE_STREAM
```

The FURL is completely unauthenticated at the AWS layer. Authentication is handled by FastAPI/PyJWT middleware, but if a bug or deployment error bypasses the middleware, the Lambda is directly exposed to the internet without any AWS-level gate.

**Fix**: Keep `AuthType: NONE` for now (required for unauthenticated public streaming), but add an **AWS WAF** rule or at minimum a custom origin header secret so only your frontend can call it. Alternatively, pass the Cognito token and validate it in the FastAPI middleware (already done) but add rate limiting via WAF.

> [!CAUTION]
> Anyone who discovers the FURL endpoint can send unlimited LLM requests, burning your API credits. WAF rate limiting is essential.

---

### 2. Wildcard Resource on S3 Vectors and Textract IAM Policies

**Location**: `template.yaml` lines 98–114

```yaml
- Statement:
    - Effect: Allow
      Action:
        - s3vectors:CreateVectorBucket
        - s3vectors:CreateIndex
        - s3vectors:PutVectors
        - s3vectors:QueryVectors
        - s3vectors:GetVectors
        - s3vectors:ListIndexes
        - s3vectors:ListVectorBuckets
      Resource: "*"   # ← Wildcard — not least-privilege
    - Effect: Allow
      Action:
        - textract:DetectDocumentText
        - textract:StartDocumentTextDetection
        - textract:GetDocumentTextDetection
      Resource: "*"   # ← Wildcard
```

This grants access to **all** S3 Vector buckets and Textract operations across your entire AWS account.

**Fix**: Scope the S3 Vectors resource to your specific bucket ARN. Textract does not support resource-level ARNs, so `"*"` is unavoidable there — but document this explicitly as a known exception.

```yaml
- Statement:
    - Effect: Allow
      Action:
        - s3vectors:PutVectors
        - s3vectors:QueryVectors
        - s3vectors:GetVectors
        - s3vectors:ListIndexes
      Resource: !Sub "arn:aws:s3vectors:${AWS::Region}:${AWS::AccountId}:bucket/${S3VectorBucketName}/*"
    - Effect: Allow
      Action:
        - s3vectors:CreateVectorBucket
        - s3vectors:ListVectorBuckets
      Resource: "*"  # Required — no resource-level support for bucket listing
```

Also **remove** `CreateVectorBucket` and `CreateIndex` from the Lambda's runtime policy — these are one-time setup operations that should only be granted during the initial deployment, not to every incoming request.

---

### 3. Weak Cognito Password Policy

**Location**: `template.yaml` lines 299–303

```yaml
PasswordPolicy:
  MinimumLength: 8
  RequireLowercase: false
  RequireNumbers: false
  RequireSymbols: false
  RequireUppercase: false
```

All complexity requirements are disabled. 8-character all-lowercase passwords (e.g., `password`) are accepted. This is a major brute-force risk for a production user pool.

**Fix**: Enable at minimum numbers and uppercase requirements:

```yaml
PasswordPolicy:
  MinimumLength: 12
  RequireLowercase: true
  RequireNumbers: true
  RequireSymbols: false   # optional: can enable for stricter security
  RequireUppercase: true
```

---

### 4. Frontend Bucket Uses Public S3 Website Hosting (No HTTPS)

**Location**: `template.yaml` lines 257–284

The frontend bucket uses S3 static website hosting with a public bucket policy (`Principal: "*"`). S3 website endpoints serve traffic over **plain HTTP** (`http://bucket.s3-website.region.amazonaws.com`). There is no HTTPS, no custom domain, and no CDN caching.

**Fix**: Replace with **CloudFront + OAC (Origin Access Control)**:

```yaml
ChatbotFrontendDistribution:
  Type: AWS::CloudFront::Distribution
  Properties:
    DistributionConfig:
      Origins:
        - DomainName: !GetAtt ChatbotFrontendBucket.RegionalDomainName
          OriginAccessControlId: !Ref FrontendOAC
      DefaultCacheBehavior:
        ViewerProtocolPolicy: redirect-to-https
        CachePolicyId: 658327ea-f89d-4fab-a63d-7e88639e58f6  # Managed CachingOptimized
```

- Keep the bucket **private** (remove the public bucket policy)
- CloudFront provides HTTPS, global edge caching, and custom domain support
- Free tier: 1 TB/month data transfer out, 10M HTTP requests/month

> [!IMPORTANT]
> The docs acknowledge this trade-off in `AWS_SAM_TEMPLATE_ANALYSIS.md` (Section 10): CloudFront was skipped for "instant updates." Use `aws cloudfront create-invalidation` in `deploy-frontend.sh` to automate invalidation — this solves that concern.

---

## 🟡 Important — Recommended Improvements

### 5. `ALLOW_USER_PASSWORD_AUTH` Exposes Plaintext Passwords

**Location**: `template.yaml` line 320

```yaml
ExplicitAuthFlows:
  - ALLOW_USER_PASSWORD_AUTH  # ← Sends password in plaintext to Cognito
  - ALLOW_REFRESH_TOKEN_AUTH
  - ALLOW_USER_SRP_AUTH
```

`USER_PASSWORD_AUTH` sends the password to Cognito without client-side hashing. `USER_SRP_AUTH` (Secure Remote Password) performs a cryptographic challenge where the password never leaves the client unprotected.

**Fix**: Remove `ALLOW_USER_PASSWORD_AUTH` and migrate the frontend login to `USER_SRP_AUTH` exclusively (already included in `ExplicitAuthFlows`). The `COGNITO_AUTH.md` doc confirms the frontend uses `InitiateAuth` directly, so this only requires updating the `AuthFlow` field in the frontend's login `fetch` call.

---

### 6. JWKS is Fetched at Cold Start with `lru_cache` — No Expiration

**Location**: `backend/app/dependencies.py` lines 172–179

```python
@lru_cache(maxsize=1)
def get_jwks(jwks_url: str) -> dict:
    ...
```

Cognito rotates signing keys periodically. `lru_cache` with no TTL means the JWKS is cached for the **lifetime of the Lambda container** (potentially days). If Cognito rotates its keys, your Lambda will reject all valid tokens until the container is recycled.

**Fix**: Use `cachetools.TTLCache` (already a transitive dep via boto3 ecosystem or add it explicitly):

```python
from cachetools import TTLCache
_jwks_cache: TTLCache = TTLCache(maxsize=10, ttl=3600)  # Refresh every hour

def get_jwks(jwks_url: str) -> dict:
    if jwks_url in _jwks_cache:
        return _jwks_cache[jwks_url]
    # ... fetch and store in _jwks_cache[jwks_url]
```

---

### 7. SSM Key is Read at Every Cold Start via `lru_cache`

**Location**: `backend/app/dependencies.py` lines 63–70

The `get_ssm_parameter` function is `lru_cache`'d, which is correct for the Lambda container lifetime. However, **if the API key changes in SSM**, the Lambda container won't pick it up until it's recycled. This is fine for static keys, but worth documenting explicitly and pairing with a Lambda function configuration update (which forces container recycling) in your key-rotation runbook.

> [!NOTE]
> Consider adding a comment in `dependencies.py` explaining this behavior so future maintainers don't assume key rotations take effect immediately.

---

### 8. DynamoDB GSI Projection is `ALL` — Wastes GSI Write Capacity

**Location**: `template.yaml` lines 226–227

```yaml
Projection:
  ProjectionType: ALL
```

`ProjectionType: ALL` copies **every attribute** from the base table into the GSI. For the `UserConversationsIndex`, which is used to list conversation metadata, you don't need the full message history projected — only the metadata fields (`user_id`, `sk`, `title`, `created_at`, etc.).

**Fix**: Switch to `INCLUDE` and specify only the needed attributes for conversation listing:

```yaml
Projection:
  ProjectionType: INCLUDE
  NonKeyAttributes:
    - title
    - created_at
    - updated_at
    - message_count
```

This reduces GSI storage costs and WCU consumption for replication writes.

---

### 9. CORS `AllowOrigins: "*"` on API Gateway

**Location**: `template.yaml` lines 173–174

```yaml
CorsConfiguration:
  AllowOrigins:
    - "*"
```

Wildcard CORS allows any website to make authenticated API calls to your backend (using the user's Cognito token stored in their browser). In production, you should lock this to your actual frontend domain.

**Fix**: Replace with your deployed frontend URL and accept it as a parameter:

```yaml
Parameters:
  AllowedOrigin:
    Type: String
    Default: "*"
    Description: CORS allowed origin (e.g., https://your-frontend.example.com)

CorsConfiguration:
  AllowOrigins:
    - !Ref AllowedOrigin
```

---

### 10. [RESOLVED] Lambda Timeout Set to 30s — Decoupled Async Ingestion Implemented

**Location**: `template.yaml` line 46

API Gateway HTTP API has a **30-second integration timeout** that cannot be overridden. In the old synchronous ingestion design, parsing complex multi-page documents and indexing vectors would regularly exceed 30 seconds, causing integration failures and Lambda busy-waiting wastes.

**Resolution**: Fully resolved by migrating to an **event-driven, decoupled asynchronous architecture** using **Amazon SQS** queues and an **Ingestion Worker Lambda function**:
1. Documents are uploaded under S3 bucket staging prefix (`staging/`) and FastAPI returns `202 Accepted` instantly (<50ms).
2. The landing file triggers an S3 Event Notification which publishes a job message into `IngestionQueue`.
3. SQS triggers `ChatbotIngestionWorkerFunction` with `BatchSize: 1` and a dedicated **120-second timeout** to process the document via Textract and calculate vector embeddings in the background.
4. The worker updates DynamoDB metadata once complete and cleans up the staging files in S3.
5. SQS is configured with an `IngestionDLQ` to catch toxic or failed payloads with a 14-day retention cycle.

---

## 🟢 Low Priority — Nice to Have

### 11. No X-Ray Tracing Enabled

AWS Lambda and API Gateway support **X-Ray** distributed tracing with zero code changes. Add to `Globals`:

```yaml
Globals:
  Function:
    Tracing: Active
```

And to API Gateway:
```yaml
ChatbotHttpApi:
  Properties:
    AccessLogDestination: ...
    TracingEnabled: true
```

This gives you end-to-end request tracing across Lambda → DynamoDB → S3 → SSM for free (within the X-Ray free tier: 100k traces/month).

---

### 12. CloudWatch Log Retention is 7 Days — Consider Environment-Based

**Location**: `template.yaml` line 164

`RetentionInDays: 7` is hardcoded. For staging, you may want even less (3 days); for production you may want more (30 days) for incident investigation.

```yaml
ChatbotBackendFunctionLogGroup:
  Properties:
    RetentionInDays: !If [IsProd, 30, 7]
```

With a condition:
```yaml
Conditions:
  IsProd: !Equals [!Ref Environment, "prod"]
```

---

### 13. DynamoDB `S3CrudPolicy` Grants Too Much — Use Fine-Grained Policies

**Location**: `template.yaml` lines 91–92

`S3CrudPolicy` grants `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, and `s3:ListBucket`. Lambda only needs `PutObject` (upload), `GetObject` (presigned URL generation), and `DeleteObject` (cleanup). Consider swapping to a custom policy if you want stricter control.

---

### 14. Missing `DeletionPolicy` on DynamoDB Table

If the CloudFormation stack is accidentally deleted (e.g., `sam delete`), DynamoDB tables are **permanently deleted** along with all user data by default.

**Fix**: Add `DeletionPolicy: Retain` to the table resource:

```yaml
ChatbotTable:
  Type: AWS::DynamoDB::Table
  DeletionPolicy: Retain
  UpdateReplacePolicy: Retain
```

---

### 15. `LITELLM_EMBEDDING_API_KEY_PARAMETER` Points to Vision Key

**Location**: `template.yaml` line 61

```yaml
LITELLM_EMBEDDING_API_KEY_PARAMETER: /chatbot/litellm_vision_api_key  # ← Same as vision key
```

The embedding API key parameter intentionally reuses the vision key path (since both use Gemini). This works but is fragile — if you ever want separate keys, you'll need to update both the template and the SSM parameter. At minimum, add a comment:

```yaml
# Note: Intentionally reuses the vision API key SSM path since both models (embedding + vision)
# use the same Gemini API key. Update both if separating keys in the future.
LITELLM_EMBEDDING_API_KEY_PARAMETER: /chatbot/litellm_vision_api_key
```

---

## Summary Table

| # | Issue | Severity | Effort |
|---|-------|----------|--------|
| 1 | FURL has no AWS-layer auth — add WAF rate limiting | 🔴 Critical | Medium |
| 2 | Wildcard `Resource: "*"` on IAM policies | 🔴 Critical | Low |
| 3 | Weak Cognito password policy | 🔴 Critical | Low |
| 4 | No HTTPS on frontend (S3 website, not CloudFront) | 🔴 Critical | Medium |
| 5 | `ALLOW_USER_PASSWORD_AUTH` sends plaintext password | 🟡 Important | Low |
| 6 | JWKS cached forever — no TTL refresh | 🟡 Important | Low |
| 7 | SSM key not refreshed on rotation | 🟡 Important | Low (doc only) |
| 8 | GSI `ProjectionType: ALL` wastes WCU | 🟡 Important | Low |
| 9 | CORS `AllowOrigins: "*"` | 🟡 Important | Low |
| 10 | **[RESOLVED]** Textract async not implemented | 🟢 Resolved | High (Completed!) |
| 11 | No X-Ray tracing | 🟢 Nice to Have | Low |
| 12 | Log retention not environment-aware | 🟢 Nice to Have | Low |
| 13 | `S3CrudPolicy` broader than needed | 🟢 Nice to Have | Low |
| 14 | No `DeletionPolicy: Retain` on DynamoDB | 🟢 Nice to Have | Low |
| 15 | Embedding key reuses vision key path undocumented | 🟢 Nice to Have | Low |

---

## 🎯 Personal / Learning Project Filter

> **Context**: This app is for personal use and learning only, with a goal of keeping costs as close to zero as possible. The single user is the developer. Below is an honest assessment of which issues you can safely ignore and why — and which ones still matter even in this context.

---

### ✅ Safe to Ignore

| # | Issue | Why It's Fine for Personal Use |
|---|-------|-------------------------------|
| **1** | FURL `AuthType: NONE` + WAF | Your FastAPI middleware already rejects unauthenticated requests with a 401 **before** any LLM call is made — the Lambda is invoked but returns immediately with no cost to your API provider. You're the only user, so the FURL URL leaking is unlikely. **WAF costs ~$5/month minimum** — not worth it. |
| **3** | Weak Cognito password policy | You control the only account. Pick a strong password yourself and you're fine. No need to enforce it at the pool level when there's one user. |
| **4** | No HTTPS / CloudFront | S3 HTTP is fine for personal use accessed from your own browser. CloudFront's free tier is generous (1 TB/month), but the setup adds complexity with no real benefit when there's no sensitive data in transit beyond your own JWT. Skip until you need a custom domain. |
| **5** | `ALLOW_USER_PASSWORD_AUTH` | The risk here is someone intercepting your password in transit to Cognito. Since the call goes over TLS to `cognito-idp.amazonaws.com`, plaintext in the protocol doesn't mean plaintext on the wire. For a single-user personal app, this is an acceptable trade-off vs. the complexity of implementing SRP. |
| **7** | SSM key rotation doc | You're not rotating keys on a schedule. When you do rotate, you'll remember to redeploy — or just add a note to yourself. No need for a formal runbook. |
| **9** | CORS `AllowOrigins: "*"` | CORS is a browser-enforcement mechanism. It prevents *other websites* from making requests using your credentials. Since you're the only user, this is a non-issue — you won't be visiting malicious third-party sites that exfiltrate your token. |
| **11** | X-Ray tracing | Useful for debugging in production teams. For personal use, CloudWatch logs are sufficient. |
| **12** | Environment-aware log retention | You likely run a single `prod` stack. 7-day retention is already a reasonable default. Don't over-engineer this. |
| **13** | `S3CrudPolicy` scope | The blast radius of an over-permissioned Lambda in your own account is just your own data. Not worth adding custom IAM boilerplate for a personal project. |
| **15** | Embedding key comment | Low risk for solo work — you know this. Add the comment when/if you revisit the codebase after a long break. |

---

### ⚠️ Still Worth Fixing (Even for Personal Use)

These issues are either **low effort**, have **real functional consequences**, or **cost you money** even on a free-tier setup:

| # | Issue | Why It Still Matters |
|---|-------|---------------------|
| **2** | Wildcard IAM on S3 Vectors | **Low effort to fix.** The `CreateVectorBucket` and `CreateIndex` permissions in the Lambda's runtime policy are genuinely unnecessary — they're one-time setup ops. Scoping them out takes 5 minutes and is a good habit. |
| **6** | JWKS `lru_cache` with no TTL | This is a **real functional bug**, not just a best practice. If Cognito rotates its signing keys (it does, roughly annually), your Lambda will start rejecting all logins and you'll have no idea why until you hunt it down. A TTL cache is a 10-line fix. |
| **8** | GSI `ProjectionType: ALL` | This one actually **costs you free-tier WCU**. Every message written to the base table also writes a full copy to the GSI. Switching to `INCLUDE` with just the metadata fields halves your GSI write consumption — keeping you safely inside the 25 WCU free tier as your conversation history grows. |
| **14** | `DeletionPolicy: Retain` on DynamoDB | A two-line fix that saves your chat history from being permanently wiped if you accidentally run `sam delete`. Especially worth it since you're using this for learning — you'll want to preserve real conversations. |
