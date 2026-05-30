"""Lambda 2 — Ingestion Processor.

Triggered by ProcessorQueue (SQS).  Each SQS message is either:
  - An SNS notification envelope from TextractCompletionTopic (binary path), or
  - A direct JSON payload sent by Lambda 1 (text path).

For the binary path:
  1. Extract job_id from Textract SNS notification.
  2. Look up TEXTRACT# record in DynamoDB.
  3. Call fetch_textract_text() — single GetDocumentTextDetection, no polling.
  4. Delete rag-raw-uploads/ S3 file.

For the text path:
  1. Read file bytes from S3 staging path.
  2. Decode as UTF-8.

Both paths then: split_text → embed → upsert → update DynamoDB → delete staging.
"""

from __future__ import annotations

import asyncio
import json
import logging

from app.dependencies import (
    get_repository,
    get_rag_service,
    get_s3_client,
    get_settings,
)
from app.utils.time import utcnow_iso

logger = logging.getLogger(__name__)

# Configure root logger for Lambda stdout
if not logger.handlers:
    _sh = logging.StreamHandler()
    _sh.setFormatter(
        logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")
    )
    logger.addHandler(_sh)
    logger.setLevel(logging.INFO)


async def _process_textract_record(payload: dict) -> None:
    """Handle a Textract completion notification payload."""
    job_id: str = payload.get("JobId", "")
    status: str = payload.get("Status", "")

    if not job_id:
        raise ValueError("Textract SNS payload missing JobId")

    repo = get_repository()

    if status != "SUCCEEDED":
        logger.warning(
            "Textract job %s did not succeed (status=%s); marking failed",
            job_id,
            status,
        )
        job_meta = repo.get_textract_job(job_id)
        if job_meta:
            repo.update_rag_document_status(
                job_meta["user_id"], job_meta["document_id"], "failed", 0, utcnow_iso()
            )
        return

    job_meta = repo.get_textract_job(job_id)
    if not job_meta:
        raise ValueError(f"TEXTRACT#{job_id} record not found in DynamoDB")

    document_id: str = job_meta["document_id"]
    user_id: str = job_meta["user_id"]
    filename: str = job_meta["filename"]
    s3_raw_key: str = job_meta["s3_raw_key"]

    logger.info(
        "Processing Textract result job_id=%s document_id=%s user_id=%s",
        job_id,
        document_id,
        user_id,
    )

    rag_service = get_rag_service()

    # Single call — no polling; Textract already completed before SNS fired
    text = await rag_service.fetch_textract_text(job_id)

    # Clean up rag-raw-uploads file (best-effort)
    s3 = get_s3_client()
    try:
        bucket_name = get_settings().s3_bucket_name
        s3.delete_object(Bucket=bucket_name, Key=s3_raw_key)
        logger.info("Deleted rag-raw-uploads file: %s", s3_raw_key)
    except Exception:
        logger.exception("Failed to delete rag-raw-uploads file: %s", s3_raw_key)

    await _ingest_and_update(
        text=text,
        filename=filename,
        user_id=user_id,
        document_id=document_id,
        staging_bucket=None,  # no staging file to delete for textract path
        staging_key=None,
    )


async def _process_text_record(payload: dict) -> None:
    """Handle a direct text-file payload from Lambda 1."""
    document_id: str = payload["document_id"]
    user_id: str = payload["user_id"]
    filename: str = payload["filename"]
    s3_key: str = payload["s3_key"]
    bucket_name: str = payload.get("bucket_name", "")

    if not bucket_name:
        bucket_name = get_settings().s3_bucket_name

    logger.info(
        "Processing text file document_id=%s user_id=%s s3_key=%s",
        document_id,
        user_id,
        s3_key,
    )

    s3 = get_s3_client()
    response = s3.get_object(Bucket=bucket_name, Key=s3_key)
    data: bytes = response["Body"].read()
    text = data.decode("utf-8")

    await _ingest_and_update(
        text=text,
        filename=filename,
        user_id=user_id,
        document_id=document_id,
        staging_bucket=bucket_name,
        staging_key=s3_key,
    )


async def _ingest_and_update(
    text: str,
    filename: str,
    user_id: str,
    document_id: str,
    staging_bucket: str | None,
    staging_key: str | None,
) -> None:
    """Chunk, embed, upsert, update DynamoDB status, and delete staging file."""
    repo = get_repository()
    rag_service = get_rag_service()

    # Fetch tags from the DynamoDB document record
    doc = repo.get_rag_document(user_id, document_id)
    tags: list[str] | None = doc.get("tags") if doc else None

    try:
        result = await rag_service.ingest_document(
            filename=filename,
            content=text,
            user_id=user_id,
            document_id=document_id,
            tags=tags,
        )
        repo.update_rag_document_status(
            user_id, document_id, "ready", result.chunks_ingested, utcnow_iso()
        )
        logger.info(
            "Ingested document_id=%s chunks=%d", document_id, result.chunks_ingested
        )
    except Exception:
        logger.exception("Ingestion failed for document_id=%s", document_id)
        try:
            repo.update_rag_document_status(
                user_id, document_id, "failed", 0, utcnow_iso()
            )
        except Exception:
            logger.exception(
                "Failed to write failure status for document_id=%s", document_id
            )
    finally:
        # Always clean up staging file regardless of ingestion outcome
        if staging_bucket and staging_key:
            try:
                s3 = get_s3_client()
                s3.delete_object(Bucket=staging_bucket, Key=staging_key)
                logger.info("Deleted staging file: %s", staging_key)
            except Exception:
                logger.exception("Failed to delete staging file: %s", staging_key)


def handler(event: dict, context: object) -> None:
    """Lambda 2 entry point — handles SQS records (SNS-wrapped or direct)."""
    logger.info(
        "Processor received event with %d SQS record(s)",
        len(event.get("Records", [])),
    )

    for sqs_record in event.get("Records", []):
        body_str: str = sqs_record.get("body", "{}")
        try:
            body = json.loads(body_str)
        except Exception:
            logger.exception("Failed to parse SQS record body as JSON: %s", body_str)
            continue

        # Unwrap SNS envelope if present (Textract sends through SNS → SQS)
        if body.get("Type") == "Notification":
            try:
                payload = json.loads(body["Message"])
            except Exception:
                logger.exception(
                    "Failed to parse SNS Message as JSON: %s", body.get("Message")
                )
                continue
            source = "textract"
        else:
            payload = body
            source = payload.get("source", "")

        logger.info("Processing SQS record source=%s", source)

        try:
            if source == "textract":
                asyncio.run(_process_textract_record(payload))
            elif source == "text":
                asyncio.run(_process_text_record(payload))
            else:
                logger.warning("Unknown source %r in payload — skipping", source)
        except Exception:
            logger.exception("Processor failed for SQS record source=%s", source)
            # Re-raise so SQS returns the message to the queue / DLQ
            raise
