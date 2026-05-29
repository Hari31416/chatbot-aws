# AWS Free Tier Cost Optimization Guide

This document describes the investigation into the high Amazon DynamoDB and Amazon SQS utilization observed in the AWS Free Tier dashboard, the root causes identified, and the optimizations applied to mitigate them.

---

## 1. Executive Summary

During monitoring of the serverless chatbot application, we observed that:

- **DynamoDB Read/Write Capacity Unit-Hours (RCU-Hrs / WCU-Hrs)** were extremely high (~1,940 Unit-Hours).
- **SQS Request Counts** were unusually high (~82,706 requests) despite having minimal file ingestion activity.
- Other serverless components (AWS Lambda invocations, API Gateway requests) remained near-zero.

To prevent hitting AWS Free Tier limits and incurring unnecessary charges, we resolved the issues by deleting the unused staging stack, switching DynamoDB to On-Demand billing, and optimizing SQS polling concurrency and wait times.

---

## 2. Issue Deep Dive & Root Causes

### A. DynamoDB Provisioned Capacity Accumulation

In AWS, DynamoDB offers two billing modes: **Provisioned** and **On-Demand (Pay-Per-Request)**.

- **The Configuration:** The application's `template.yaml` was configured to use `BillingMode: PROVISIONED` with 5 Read Capacity Units (RCUs) and 5 Write Capacity Units (WCUs) on the main table and 5 RCU / 5 WCU on the Global Secondary Index (`UserConversationsIndexV2`).
- **The Root Cause:** Under Provisioned mode, AWS charges for capacity by the hour **24/7**, regardless of whether any database requests are actually made.
  - Each stack consumed `10 RCU` and `10 WCU` continuously.
  - Having both `chat` (production) and `chat-staging` stacks running simultaneously meant the account was consuming **20 RCU-Hrs and 20 WCU-Hrs every hour**.
  - Over 4 days, this accumulated to: `20 units * 24 hours * 4 days = 1,920 Unit-Hours`.

### B. Amazon SQS Polling Request Volume

Amazon SQS is a **pull-based** queue service. When you configure SQS as an Event Source Mapping trigger for a Lambda function, the AWS Lambda service polls the queue on your behalf.

- **The Root Cause:**
  - **Short Polling by Default:** The queue did not have `ReceiveMessageWaitTimeSeconds` defined, falling back to short polling where any empty check counts as an API call.
  - **Continuous Pollers:** The Lambda service initiates a cluster of concurrent pollers (minimum of 5 active connections) to monitor the SQS queue 24/7.
  - **Cumulative Requests:** 5 concurrent connections polling continuously (even with standard 20s long-polling) consume `0.25 requests/second`, totaling **21,600 SQS requests per day** per queue. Across both the production and staging queues, this generated **~43,200 requests/day**, rapidly consuming the 1 million monthly free SQS requests.

---

## 3. Optimizations Implemented

The following changes were applied to resolve the high utilization:

1. **Deleted the Staging Stack (`chat-staging`):**
   - Removed the staging SQS queue and the staging Lambda worker, cutting the SQS polling request count in half immediately.
   - Deleted the staging DynamoDB table, saving 50% of the active RCU/WCU allocations.
2. **Switched DynamoDB to On-Demand (`PAY_PER_REQUEST`):**
   - Updated `template.yaml` to use `BillingMode: PAY_PER_REQUEST` and removed all static `ProvisionedThroughput` allocations.
   - Under On-Demand, you only consume Read/Write requests when actual queries occur.
3. **Enabled SQS Long Polling:**
   - Added `ReceiveMessageWaitTimeSeconds: 20` to the queue configuration. This forces all polling connections to wait up to 20 seconds for a message before closing, reducing the request frequency.
4. **Limited Lambda SQS Poller Concurrency:**
   - Configured `ScalingConfig` with `MaximumConcurrency: 2` on the Lambda SQS Event Source Mapping. This reduces the number of concurrent active long-polling connections Lambda uses, further minimizing idle API calls.

---

## 4. Before vs. After Comparison

The table below shows the impact of these changes on your monthly AWS Free Tier usage quotas:

| Resource            | Metric / Metric Type   | Before Fix (Prod + Staging, Provisioned & Short-Polled)    | After Fix (Prod Only, On-Demand & Long-Polled)          | Free Tier Limit (Monthly) | Expected Monthly Cost               |
| :------------------ | :--------------------- | :--------------------------------------------------------- | :------------------------------------------------------ | :------------------------ | :---------------------------------- |
| **DynamoDB (RCUs)** | ReadCapacityUnit-Hrs   | **14,400 RCU-Hrs** <br>_(20 RCUs x 720 hours/month)_       | **~0 RCU-Hrs** <br>_(On-Demand: 100% pay-per-query)_    | 18,600 RCU-Hrs            | **$0.00** _(No capacity charge)_    |
| **DynamoDB (WCUs)** | WriteCapacityUnit-Hrs  | **14,400 WCU-Hrs** <br>_(20 WCUs x 720 hours/month)_       | **~0 WCU-Hrs** <br>_(On-Demand: 100% pay-per-query)_    | 18,600 WCU-Hrs            | **$0.00** _(No capacity charge)_    |
| **Amazon SQS**      | API Request Count      | **~1,296,000 requests/month** <br>_(~43,200 requests/day)_ | **~259,200 requests/month** <br>_(~8,640 requests/day)_ | 1,000,000 requests        | **$0.00** _(Well within Free Tier)_ |
| **AWS Lambda**      | Invocations / Duration | Minimal <br>_(Only runs on file upload)_                   | Minimal <br>_(Only runs on file upload)_                | 1,000,000 free requests   | **$0.00**                           |
| **S3 Storage**      | GB-Months              | Minimal <br>_(7-day auto-expire lifecycles)_               | Minimal <br>_(7-day auto-expire lifecycles)_            | 5 GB                      | **$0.00**                           |
