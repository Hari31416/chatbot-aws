"""Lambda 1 — Ingestion Initializer.

Triggered directly by an S3 Event Notification (no SQS wrapper).
Routes uploaded files:
  - Binary (.pdf, .png, .jpg, .jpeg, .tiff, .tif) → start Textract async job,
    save TEXTRACT# mapping to DynamoDB.
  - Text (UTF-8 decodable) → enqueue payload to ProcessorQueue (SQS).
  - UTF-8 decode failure → treat file as binary.
"""

from __future__ import annotations

import json
import logging
import os
import urllib.parse

from app.dependencies import (
    get_repository,
    get_s3_client,
    get_settings,
    get_sqs_client,
    get_textract_client,
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

_BINARY_EXTENSIONS = frozenset({".pdf", ".png", ".jpg", ".jpeg", ".tiff", ".tif"})


def _parse_s3_key(s3_key: str) -> tuple[str, str, str] | None:
    """Return (user_id, document_id, filename) or None for malformed keys."""
    parts = s3_key.split("/")
    if len(parts) < 4 or parts[0] != "staging":
        logger.warning("Unexpected S3 key format for staging file: %s", s3_key)
        return None
    user_id = parts[1]
    document_id = parts[2]
    filename = "/".join(parts[3:])
    return user_id, document_id, filename


def _handle_binary(
    bucket_name: str,
    s3_key: str,
    user_id: str,
    document_id: str,
    filename: str,
) -> None:
    """Copy staging file to rag-raw-uploads/, start Textract, save job record."""
    settings = get_settings()
    s3 = get_s3_client()
    textract = get_textract_client()
    repo = get_repository()

    extension = os.path.splitext(filename.lower())[1] or ""
    s3_raw_key = f"rag-raw-uploads/{user_id}/{document_id}{extension}"

    # Copy staging → rag-raw-uploads (Textract requires the file to stay in S3)
    logger.info("Copying staging file to raw uploads: %s → %s", s3_key, s3_raw_key)
    s3.copy_object(
        Bucket=bucket_name,
        CopySource={"Bucket": bucket_name, "Key": s3_key},
        Key=s3_raw_key,
    )

    # Start async Textract job with SNS notification channel
    sns_role_arn = settings.textract_sns_role_arn
    sns_topic_arn = settings.textract_sns_topic_arn

    start_kwargs: dict = {
        "DocumentLocation": {"S3Object": {"Bucket": bucket_name, "Name": s3_raw_key}}
    }
    if sns_role_arn and sns_topic_arn:
        start_kwargs["NotificationChannel"] = {
            "SNSTopicArn": sns_topic_arn,
            "RoleArn": sns_role_arn,
        }

    response = textract.start_document_text_detection(**start_kwargs)
    job_id = response["JobId"]
    logger.info(
        "Textract job started job_id=%s document_id=%s s3_raw_key=%s",
        job_id,
        document_id,
        s3_raw_key,
    )

    # Persist job → document mapping for Lambda 2 lookup
    repo.save_textract_job(
        job_id=job_id,
        document_id=document_id,
        user_id=user_id,
        filename=filename,
        s3_raw_key=s3_raw_key,
        created_at=utcnow_iso(),
    )


def _handle_text(
    bucket_name: str,
    s3_key: str,
    user_id: str,
    document_id: str,
    filename: str,
) -> None:
    """Enqueue a text-file processing message to ProcessorQueue."""
    settings = get_settings()
    sqs = get_sqs_client()

    queue_url = settings.processor_queue_url
    if not queue_url:
        raise RuntimeError(
            "PROCESSOR_QUEUE_URL is not configured — cannot enqueue text message"
        )

    payload = {
        "source": "text",
        "document_id": document_id,
        "user_id": user_id,
        "filename": filename,
        "s3_key": s3_key,
        "bucket_name": bucket_name,
    }
    sqs.send_message(QueueUrl=queue_url, MessageBody=json.dumps(payload))
    logger.info(
        "Enqueued text message to ProcessorQueue: document_id=%s user_id=%s",
        document_id,
        user_id,
    )


def handler(event: dict, context: object) -> None:
    """Lambda 1 entry point — handles S3 event records directly."""
    logger.info(
        "Initializer received event with %d record(s)", len(event.get("Records", []))
    )

    repo = get_repository()

    for record in event.get("Records", []):
        s3_data = record.get("s3", {})
        bucket_name: str = s3_data.get("bucket", {}).get("name", "")
        raw_key: str = s3_data.get("object", {}).get("key", "")
        s3_key = urllib.parse.unquote_plus(raw_key)

        if not bucket_name or not s3_key:
            logger.warning(
                "Missing bucket_name or s3_key in record: bucket=%s, key=%s",
                bucket_name,
                s3_key,
            )
            continue

        parsed = _parse_s3_key(s3_key)
        if parsed is None:
            continue
        user_id, document_id, filename = parsed

        logger.info(
            "Processing staging file: bucket=%s key=%s user_id=%s document_id=%s",
            bucket_name,
            s3_key,
            user_id,
            document_id,
        )

        # Mark document as processing
        repo.update_rag_document_status(
            user_id, document_id, "processing", 0, utcnow_iso()
        )

        extension = os.path.splitext(filename.lower())[1] or ""
        is_binary = extension in _BINARY_EXTENSIONS

        if not is_binary:
            # Attempt to verify UTF-8 by downloading a small head of the file
            try:
                s3 = get_s3_client()
                head = s3.get_object(
                    Bucket=bucket_name, Key=s3_key, Range="bytes=0-1023"
                )
                sample = head["Body"].read()
                sample.decode("utf-8")
            except UnicodeDecodeError:
                logger.warning(
                    "UTF-8 decode failed for %s — treating as binary", filename
                )
                is_binary = True
            except Exception:
                # If we can't read the head, assume text and let the processor handle it
                logger.warning(
                    "Could not read head of %s to check encoding; treating as text",
                    filename,
                )

        try:
            if is_binary:
                _handle_binary(bucket_name, s3_key, user_id, document_id, filename)
            else:
                _handle_text(bucket_name, s3_key, user_id, document_id, filename)
        except Exception:
            logger.exception(
                "Initializer failed for document_id=%s; setting status=failed",
                document_id,
            )
            try:
                repo.update_rag_document_status(
                    user_id, document_id, "failed", 0, utcnow_iso()
                )
            except Exception:
                logger.exception(
                    "Failed to write failure status for document_id=%s", document_id
                )
