## 1. Lambda & CloudFront Logs (The #1 Hidden Cost)

By default, every time your Lambda functions or CloudFront distributions execute, they automatically dump log streams into **Amazon CloudWatch**.

- **The Trap:** CloudWatch only gives you 5 GB of free log storage. If you leave your system running or have a chatty loop logging massive payloads, CloudWatch will quietly start charging you $0.03 per GB for ingestion and ongoing storage.
- **The Fix:** Go to CloudWatch Logs and explicitly set a **Retention Policy** on your log groups (e.g., expire logs after 3 or 7 days) instead of leaving them at the default "Never Expire".

## 2. S3 Storage Class & Multi-Region Replication

- **The Trap:** The S3 Free Tier (5 GB) only applies to the standard **S3 Standard** tier. If you inadvertently configure your code to upload objects directly to `S3 Standard-IA` (Infrequent Access) or activate automatic multi-region cross-region replication, you will bypass the free tier and start paying for replication bandwidth and storage.
- **The Fix:** Stick entirely to a single region and ensure your storage bucket uploads default to standard storage.

## 3. Cognito "Plus" Tier vs. Lite/Essentials

Cognito recently restructured its pricing into **Lite, Essentials, and Plus** tiers.

- **The Trap:** The legendary **10,000 Monthly Active Users (MAU) free tier** only applies if your user pool is set to the _Lite_ or _Essentials_ tiers. If you accidentally toggle on the **Plus** tier (which activates advanced threat protection and compliance features), **the free tier drops to zero** and you are charged a flat $0.02 per active user from user number one.
- **The Fix:** Check your Cognito User Pool settings and keep the feature plan set to **Lite** or **Essentials**. Also, stick to App/TOTP authentication; using **SMS for MFA** sends messages via Amazon SNS, which is never free and charges per text message.

## 4. DynamoDB Provisioned vs. On-Demand Capacity

DynamoDB gives you **25 GB of storage** and 25 WCU / 25 RCU (Write/Read Capacity Units) entirely _Always Free_.

- **The Trap:** This free tier only applies if you choose **Provisioned Capacity** and set the sliders to 25 or lower. If you select **On-Demand (Pay-per-request)** capacity because it sounds easier, you completely forfeit the 25 WCU/RCU free tier, and every single read/write operation will draw from your $100 credit line.
- **The Fix:** When creating DynamoDB tables, select **Provisioned Capacity**, turn auto-scaling off, and set both Read and Write capacities to a safe baseline (e.g., 5).

## 5. CloudFront Advanced Routing

As mentioned earlier, your 1 TB of outbound data transfer is perfectly free.

- **The Trap:** If you choose to route your CloudFront traffic through **Origin Shield** (a centralized caching tier to protect your origin server) or use **Lambda@Edge** for heavy request mutations instead of lightweight **CloudFront Functions**, those specific routing components will immediately begin accumulating charges.
- **The Fix:** For a personal project, rely purely on standard CloudFront caching without Origin Shield.

## 6. Textract "Analyze" Calls vs. "Detect" Calls

- **The Trap:** Passing documents to `AnalyzeDocument` (for structured data like tables and forms) costs up to **$50 per 1,000 pages** after your 3-month trial ends, whereas raw OCR text extraction (`DetectDocumentText`) is only **$1.50 per 1,000 pages**. Running a heavy integration script or continuous cron job over large PDF libraries using structural analysis will melt through your $100 credit within hours.
- **The Fix:** Only invoke the heavy `Analyze` block if you strictly need form or table parsing; otherwise, default your pipelines to standard text detection.

## 7. Amazon SQS Free Tier & Visibility Timeouts

Amazon SQS is highly cost-effective and integrates with the AWS **Always Free** tier.

- **The Trap:** AWS SQS offers **1 million free requests** per month. However, if your application has a polling loop or if your Ingestion Worker Lambda processes a document slower than the SQS queue's `VisibilityTimeout`, the message will reappear in the queue and trigger another worker invocation. This "visibility loop" can lead to duplicate processing, double LLM bills, and database conflicts, and can multiply SQS requests rapidly if a toxic message keeps failing and retrying endlessly.
- **The Fix:** 
  1. Always set up a **Dead Letter Queue (DLQ)** with a reasonable retry threshold (`maxReceiveCount: 3`) so failing, "poison" messages are automatically quarantined rather than looping forever.
  2. Ensure your queue's `VisibilityTimeout` is set to at least **1.5x to 3x** your worker Lambda's timeout. In this project, the worker timeout is 120s, and the SQS visibility timeout is 180s.
