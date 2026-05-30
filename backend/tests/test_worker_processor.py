"""Tests for the Ingestion Processor Lambda (worker_processor.handler)."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.rag import RagIngestResult


def _make_textract_sqs_event(job_id: str, status: str = "SUCCEEDED") -> dict:
    """Build an SQS event wrapping an SNS Textract notification."""
    sns_message = json.dumps({"JobId": job_id, "Status": status})
    sns_envelope = {
        "Type": "Notification",
        "Message": sns_message,
        "TopicArn": "arn:aws:sns:us-east-1:123:topic",
    }
    return {"Records": [{"body": json.dumps(sns_envelope)}]}


def _make_text_sqs_event(
    document_id: str,
    user_id: str,
    filename: str,
    s3_key: str,
    bucket_name: str = "test-bucket",
) -> dict:
    """Build an SQS event with a direct text payload (no SNS envelope)."""
    payload = {
        "source": "text",
        "document_id": document_id,
        "user_id": user_id,
        "filename": filename,
        "s3_key": s3_key,
        "bucket_name": bucket_name,
    }
    return {"Records": [{"body": json.dumps(payload)}]}


# ---------------------------------------------------------------------------
# Test: Textract success path
# ---------------------------------------------------------------------------


def test_processor_textract_success_path() -> None:
    """Textract SUCCEEDED → fetch text, chunk, embed, write vectors, status=ready."""
    mock_repo = MagicMock()
    mock_repo.get_textract_job.return_value = {
        "job_id": "job-ok",
        "document_id": "doc-1",
        "user_id": "user-1",
        "filename": "report.pdf",
        "s3_raw_key": "rag-raw-uploads/user-1/doc-1.pdf",
    }
    mock_repo.get_rag_document.return_value = {"tags": ["finance"]}

    mock_rag = MagicMock()
    mock_rag.fetch_textract_text = AsyncMock(return_value="Extracted text from PDF.")
    mock_rag.ingest_document = AsyncMock(
        return_value=RagIngestResult(document_id="doc-1", chunks_ingested=3)
    )

    mock_s3 = MagicMock()
    mock_settings = MagicMock()
    mock_settings.s3_bucket_name = "test-bucket"

    event = _make_textract_sqs_event("job-ok", "SUCCEEDED")

    with (
        patch("app.worker_processor.get_repository", return_value=mock_repo),
        patch("app.worker_processor.get_rag_service", return_value=mock_rag),
        patch("app.worker_processor.get_s3_client", return_value=mock_s3),
        patch("app.worker_processor.get_settings", return_value=mock_settings),
    ):
        from app.worker_processor import handler

        handler(event, None)

    mock_rag.fetch_textract_text.assert_awaited_once_with("job-ok")
    mock_rag.ingest_document.assert_awaited_once_with(
        filename="report.pdf",
        content="Extracted text from PDF.",
        user_id="user-1",
        document_id="doc-1",
        tags=["finance"],
    )

    # DynamoDB status → ready
    mock_repo.update_rag_document_status.assert_called_once()
    call_args = mock_repo.update_rag_document_status.call_args[0]
    assert call_args[0] == "user-1"
    assert call_args[1] == "doc-1"
    assert call_args[2] == "ready"
    assert call_args[3] == 3

    # rag-raw-uploads file deleted
    mock_s3.delete_object.assert_called_once_with(
        Bucket="test-bucket", Key="rag-raw-uploads/user-1/doc-1.pdf"
    )


# ---------------------------------------------------------------------------
# Test: Textract non-SUCCEEDED notification
# ---------------------------------------------------------------------------


def test_processor_textract_non_succeeded_sets_failed() -> None:
    """Non-SUCCEEDED Textract notification → set status=failed, no embed call."""
    mock_repo = MagicMock()
    mock_repo.get_textract_job.return_value = {
        "job_id": "job-fail",
        "document_id": "doc-2",
        "user_id": "user-2",
        "filename": "bad.pdf",
        "s3_raw_key": "rag-raw-uploads/user-2/doc-2.pdf",
    }

    mock_rag = MagicMock()
    mock_rag.fetch_textract_text = AsyncMock()
    mock_rag.ingest_document = AsyncMock()

    event = _make_textract_sqs_event("job-fail", "FAILED")

    with (
        patch("app.worker_processor.get_repository", return_value=mock_repo),
        patch("app.worker_processor.get_rag_service", return_value=mock_rag),
        patch("app.worker_processor.get_s3_client"),
        patch("app.worker_processor.get_settings"),
    ):
        from app.worker_processor import handler

        handler(event, None)

    # Status → failed
    mock_repo.update_rag_document_status.assert_called_once()
    call_args = mock_repo.update_rag_document_status.call_args[0]
    assert call_args[2] == "failed"

    # No embedding or ingestion
    mock_rag.fetch_textract_text.assert_not_awaited()
    mock_rag.ingest_document.assert_not_awaited()


# ---------------------------------------------------------------------------
# Test: text file path
# ---------------------------------------------------------------------------


def test_processor_text_path_reads_s3_and_ingests() -> None:
    """Direct text payload → read from S3, ingest, update status=ready."""
    mock_repo = MagicMock()
    mock_repo.get_rag_document.return_value = {"tags": None}

    mock_rag = MagicMock()
    mock_rag.ingest_document = AsyncMock(
        return_value=RagIngestResult(document_id="doc-3", chunks_ingested=2)
    )

    mock_body = MagicMock()
    mock_body.read.return_value = b"Plain text file content."
    mock_s3 = MagicMock()
    mock_s3.get_object.return_value = {"Body": mock_body}

    event = _make_text_sqs_event(
        document_id="doc-3",
        user_id="user-3",
        filename="notes.txt",
        s3_key="staging/user-3/doc-3/notes.txt",
    )

    with (
        patch("app.worker_processor.get_repository", return_value=mock_repo),
        patch("app.worker_processor.get_rag_service", return_value=mock_rag),
        patch("app.worker_processor.get_s3_client", return_value=mock_s3),
        patch("app.worker_processor.get_settings"),
    ):
        from app.worker_processor import handler

        handler(event, None)

    mock_s3.get_object.assert_called_once_with(
        Bucket="test-bucket", Key="staging/user-3/doc-3/notes.txt"
    )
    mock_rag.ingest_document.assert_awaited_once_with(
        filename="notes.txt",
        content="Plain text file content.",
        user_id="user-3",
        document_id="doc-3",
        tags=None,
    )

    # Status → ready
    call_args = mock_repo.update_rag_document_status.call_args[0]
    assert call_args[2] == "ready"
    assert call_args[3] == 2

    # Staging file deleted
    mock_s3.delete_object.assert_called_once_with(
        Bucket="test-bucket", Key="staging/user-3/doc-3/notes.txt"
    )


# ---------------------------------------------------------------------------
# Test: processor failure → status=failed, staging still cleaned up
# ---------------------------------------------------------------------------


def test_processor_failure_sets_failed_and_cleans_staging() -> None:
    """If ingest_document raises, status→failed and staging file is still deleted."""
    mock_repo = MagicMock()
    mock_repo.get_rag_document.return_value = {"tags": None}

    mock_rag = MagicMock()
    mock_rag.ingest_document = AsyncMock(side_effect=RuntimeError("Embedding failed"))

    mock_body = MagicMock()
    mock_body.read.return_value = b"Some content."
    mock_s3 = MagicMock()
    mock_s3.get_object.return_value = {"Body": mock_body}

    event = _make_text_sqs_event(
        document_id="doc-4",
        user_id="user-4",
        filename="doc.txt",
        s3_key="staging/user-4/doc-4/doc.txt",
    )

    with (
        patch("app.worker_processor.get_repository", return_value=mock_repo),
        patch("app.worker_processor.get_rag_service", return_value=mock_rag),
        patch("app.worker_processor.get_s3_client", return_value=mock_s3),
        patch("app.worker_processor.get_settings"),
    ):
        from app.worker_processor import handler

        handler(event, None)

    # Status → failed
    mock_repo.update_rag_document_status.assert_called_once()
    call_args = mock_repo.update_rag_document_status.call_args[0]
    assert call_args[2] == "failed"

    # Staging file still deleted (finally block)
    mock_s3.delete_object.assert_called_once_with(
        Bucket="test-bucket", Key="staging/user-4/doc-4/doc.txt"
    )
