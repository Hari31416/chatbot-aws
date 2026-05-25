import asyncio
import json
import logging
import os
import urllib.parse
from anyio import to_thread
from app.dependencies import get_repository, get_rag_service, get_s3_client, get_settings
from app.utils.time import utcnow_iso

logger = logging.getLogger(__name__)

# Configure root logger to output to stdout in Lambda environment
if not logger.handlers:
    sh = logging.StreamHandler()
    sh.setFormatter(logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s'))
    logger.addHandler(sh)
    logger.setLevel(logging.INFO)

def handler(event, context):
    """
    SQS Event handler processing S3 Event Notifications or direct SQS pushes.
    """
    logger.info("Received event: %s", json.dumps(event))
    records = event.get("Records", [])
    for record in records:
        body_str = record.get("body", "{}")
        try:
            body = json.loads(body_str)
        except Exception:
            logger.exception("Failed to parse SQS record body as JSON: %s", body_str)
            continue

        s3_records = body.get("Records", [])
        if not s3_records:
            logger.warning("No S3 event records found in SQS message")
            continue

        for s3_rec in s3_records:
            s3_data = s3_rec.get("s3", {})
            bucket_name = s3_data.get("bucket", {}).get("name")
            s3_key = urllib.parse.unquote_plus(s3_data.get("object", {}).get("key", ""))

            if not bucket_name or not s3_key:
                logger.warning("Missing bucket_name or s3_key: bucket=%s, key=%s", bucket_name, s3_key)
                continue

            logger.info("Processing S3 object: bucket=%s, key=%s", bucket_name, s3_key)

            # We expect the key format: staging/{user_id}/{document_id}/{filename}
            parts = s3_key.split("/")
            if len(parts) < 4 or parts[0] != "staging":
                logger.warning("Unexpected S3 key format for staging file: %s", s3_key)
                continue

            user_id = parts[1]
            document_id = parts[2]
            filename = "/".join(parts[3:])

            asyncio.run(process_staging_file(bucket_name, s3_key, user_id, document_id, filename))

async def process_staging_file(bucket_name: str, s3_key: str, user_id: str, document_id: str, filename: str):
    logger.info("Starting background ingestion for user_id=%s, document_id=%s, filename=%s", user_id, document_id, filename)
    
    repo = get_repository()
    
    try:
        # 1. Download file content from staging S3
        s3_client = get_s3_client()
        response = await to_thread.run_sync(
            lambda: s3_client.get_object(Bucket=bucket_name, Key=s3_key)
        )
        data = await to_thread.run_sync(response["Body"].read)
        content_type = response.get("ContentType", "application/octet-stream")

        # 2. Determine if it is binary or text
        extension = os.path.splitext(filename.lower())[1] or ""
        is_binary = extension in (".pdf", ".png", ".jpg", ".jpeg", ".tiff", ".tif")
        
        # 3. Call RAG ingestion service
        rag_service = get_rag_service()
        
        if is_binary:
            result = await rag_service.ingest_binary_document(
                filename=filename,
                data=data,
                mime_type=content_type,
                user_id=user_id,
                document_id=document_id,
            )
        else:
            try:
                content = data.decode("utf-8")
            except UnicodeDecodeError:
                logger.warning("Decoding failed, falling back to Textract for %s", filename)
                result = await rag_service.ingest_binary_document(
                    filename=filename,
                    data=data,
                    mime_type=content_type,
                    user_id=user_id,
                    document_id=document_id,
                )
            else:
                result = await rag_service.ingest_document(
                    filename=filename,
                    content=content,
                    user_id=user_id,
                    document_id=document_id,
                )
                
        # 4. Update status in DynamoDB
        updated_at = utcnow_iso()
        await to_thread.run_sync(
            repo.update_rag_document_status,
            user_id,
            document_id,
            "ready",
            result.chunks_ingested,
            updated_at,
        )
        logger.info("Successfully ingested document_id=%s, chunks=%d", document_id, result.chunks_ingested)
        
    except Exception as exc:
        logger.exception("Failed to process background ingestion for document_id=%s", document_id)
        updated_at = utcnow_iso()
        try:
            await to_thread.run_sync(
                repo.update_rag_document_status,
                user_id,
                document_id,
                "failed",
                0,
                updated_at,
            )
        except Exception:
            logger.exception("Failed to write failure status to DynamoDB for document_id=%s", document_id)
            
    finally:
        # 5. Clean up the staging file
        try:
            s3_client = get_s3_client()
            await to_thread.run_sync(
                lambda: s3_client.delete_object(Bucket=bucket_name, Key=s3_key)
            )
            logger.info("Cleaned up staging S3 file: %s", s3_key)
        except Exception:
            logger.exception("Failed to clean up staging S3 file: %s", s3_key)
