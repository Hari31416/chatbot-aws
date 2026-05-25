# Architectural Changes & Infrastructure Trade-offs for Response Streaming

This document records the architectural and infrastructure decisions made to implement real-time Response Streaming in the serverless chatbot, explaining the selected solution (Lambda Function URLs + AWS Lambda Web Adapter) and analyzing alternative approaches.

---

## 1. What Infrastructure Changes Were Made & Why

To achieve true chunk-by-chunk token streaming, we updated `template.yaml` to deploy a **Lambda Function URL (FURL)** configured with **AWS Lambda Web Adapter (LWA)**, shifting away from standard API Gateway routing for stream consumers.

### Summary of Changes:

1. **Lambda Function URL Config**:
   - Added `FunctionUrlConfig` to `ChatbotBackendFunction`.
   - Set `InvokeMode: RESPONSE_STREAM` (enables HTTP chunked transfer encoding).
   - Set `AuthType: NONE` (shifts authentication from API Gateway Authorizers to in-app PyJWT middleware).
2. **AWS Lambda Web Adapter (LWA) Layer**:
   - Attached the public AWS-published `LambdaAdapterLayerArm64:27` layer.
   - Set the handler to `run.sh` and added the `AWS_LAMBDA_EXEC_WRAPPER: /opt/bootstrap` environment variable. At cold start, the Lambda wrapper intercepts the execution and runs `run.sh` inside the function root directory, launching Uvicorn on `PORT: 8080` (using `exec python -m uvicorn` to properly resolve the package within Lambda's `$PATH`).
   - Set `AWS_LWA_INVOKE_MODE: response_stream` and `PORT: "8080"` env vars.
3. **CORS Optimization**:
   - Delegated CORS preflight and headers handling entirely to the application layer (FastAPI's `CORSMiddleware`). This eliminates the duplicate CORS headers conflict (which happens if both the AWS Function URL infrastructure and FastAPI inject `Access-Control-Allow-Origin` simultaneously), completely resolving browser CORS blocking.

---

## 2. Why We Implemented This Solution

Our original stack ran on **API Gateway HTTP APIs (v2)** with the **Mangum** adapter. While cheap and fast for standard JSON payloads, this stack has hard architectural limits that prevent streaming:

### The Limitations of API Gateway:

- **Response Buffering**: API Gateway HTTP/REST APIs **do not support chunked/streaming responses**. They force Lambda to buffer the entire response, waiting for the LLM to complete generation (often 5 to 12 seconds) before returning a single byte to the client. This results in terrible Time-to-First-Byte (TTFB) and high latency.
- **Mangum Adapter Limits**: Mangum is an ASGI-to-Lambda adapter that translates API Gateway payloads. It lacks support for serverless chunked streams, converting any `StreamingResponse` into a buffered, synchronous JSON block.

### The Benefits of Lambda Function URLs + LWA:

1. **True Chunked Transfer Encoding**: Exposing a Lambda Function URL in `RESPONSE_STREAM` mode allows the Lambda to write directly to an active, open HTTP socket, delivering tokens to the client browser in real-time ($\approx 250\text{ms}$ TTFB).
2. **In-App Performance**: Bypassing API Gateway and Mangum reduces network hops. The LWA layer spins up a standard, blazing-fast `uvicorn` instance directly in the Lambda execution context, routing requests natively inside FastAPI.
3. **Pure Cost Efficiency**: API Gateway charges per request and gigabyte transferred. **AWS Lambda Function URLs are completely free of charge**, cutting conversation route costs entirely.

---

## 3. Alternative Architectural Options Checked

Before settling on Lambda Function URLs + LWA, we evaluated three other streaming methodologies. Here is why we rejected them:

### Alternative 1: AWS API Gateway WebSockets

- **How it would work**: Establish a persistent two-way WebSocket connection between the React frontend and Lambda. The client sends prompts via a WebSocket route, and Lambda writes tokens back to the socket.
- **Why we rejected it**:
  - **High Complexity**: WebSockets are highly stateful. Lambda is serverless and stateless. To connect them, we would need to build complex connection management, including a dedicated DynamoDB table to store `ConnectionIds` and lambda routing handlers for `$connect`, `$disconnect`, and `$default`.
  - **Duplicated Database Overhead**: Every individual token write requires an active SDK call (`apigatewaymanagementapi.post_to_connection`), multiplying database reads and Lambda network overhead.
  - **Costly Idle Connections**: WebSocket connections charge per connection-minute and message sent, whereas HTTP event-streams are completely free at the gateway layer.

### Alternative 2: AWS AppSync (GraphQL Subscriptions)

- **How it would work**: Deploy an AppSync GraphQL API using AWS AppSync subscriptions to stream LLM tokens to the client via WebSockets.
- **Why we rejected it**:
  - **Massive Overkill**: Introducing AppSync requires writing complex GraphQL schema definitions (`schema.graphql`), setting up AppSync resolvers, and bundling heavy GraphQL client libraries (`Apollo` or `AWS Amplify`) on the React frontend.
  - **High Architectural Cost**: AppSync carries a flat pricing model ($2.00 per million Query/Mutation operations + subscription charges) which is excessively expensive compared to a free Lambda Function URL.

### Alternative 3: REST Polling (Buffer-to-DynamoDB + Polling)

- **How it would work**: The client sends a REST request to `/chat`. The backend writes tokens to a DynamoDB message item in real-time. The frontend runs a `setInterval` loop, polling the DynamoDB endpoint every 500ms to fetch the growing text.
- **Why we rejected it**:
  - **Terrible User Experience**: Polling creates a laggy, staggered UI experience compared to a continuous, fluid SSE event stream.
  - **Database Write/Read Spam**: Polling generates huge read/write traffic on DynamoDB, resulting in high provisioning costs and potential throttling.
  - **Extremely Inefficient**: Forces the client to make dozens of redundant HTTP requests for a single message, increasing mobile battery drain and data usage.

---

## 4. Conclusion: The Optimal Path

The **Lambda Function URL + AWS Lambda Web Adapter** model represents the state-of-the-art serverless streaming design. By leveraging the public `LambdaAdapterLayerArm64` execution layer, we get standard, industry-compliant **ASGI StreamingResponses** running locally and serverlessly in the cloud, requiring zero state management, zero extra database tables, and carrying **zero API Gateway costs**.
