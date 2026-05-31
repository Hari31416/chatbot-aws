"""Tests for the Ingestion Initializer Lambda (worker_initializer.handler)."""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch, call


def _make_s3_event(bucket: str, key: str) -> dict:
    """Build a minimal S3 direct-invoke event (not SQS-wrapped)."""
    return {
        "Records": [
            {
                "s3": {
                    "bucket": {"name": bucket},
                    "object": {"key": key},
                }
            }
        ]
    }


# ---------------------------------------------------------------------------
# Test: binary file path
# ---------------------------------------------------------------------------


def test_initializer_binary_file_starts_textract_and_saves_job() -> None:
    """A .pdf upload should: copy file, start Textract, save TEXTRACT# record."""
    mock_repo = MagicMock()
    mock_s3 = MagicMock()
    mock_textract = MagicMock()
    mock_textract.start_document_text_detection.return_value = {"JobId": "job-abc"}
    mock_settings = MagicMock()
    mock_settings.textract_sns_role_arn = "arn:aws:iam::123:role/TextractSNSRole"
    mock_settings.textract_sns_topic_arn = "arn:aws:sns:us-east-1:123:topic"
    mock_settings.s3_bucket_name = "test-bucket"
    mock_settings.processor_queue_url = "https://sqs.us-east-1.amazonaws.com/123/queue"

    event = _make_s3_event("test-bucket", "staging/user-1/doc-1/report.pdf")

    with (
        patch("app.worker_initializer.get_repository", return_value=mock_repo),
        patch("app.worker_initializer.get_s3_client", return_value=mock_s3),
        patch("app.worker_initializer.get_textract_client", return_value=mock_textract),
        patch("app.worker_initializer.get_settings", return_value=mock_settings),
        patch("app.worker_initializer.get_sqs_client"),
    ):
        from app.worker_initializer import handler

        handler(event, None)

    # Status should be set to "processing" first
    mock_repo.update_rag_document_status.assert_any_call(
        "user-1",
        "doc-1",
        "processing",
        0,
        mock_repo.update_rag_document_status.call_args_list[0][0][4],
    )

    # File should be copied to rag-raw-uploads/
    mock_s3.copy_object.assert_called_once()
    copy_args = mock_s3.copy_object.call_args[1]
    assert copy_args["Bucket"] == "test-bucket"
    assert copy_args["Key"] == "rag-raw-uploads/user-1/doc-1.pdf"

    # Textract should be started
    mock_textract.start_document_text_detection.assert_called_once()

    # TEXTRACT# record should be saved
    mock_repo.save_textract_job.assert_called_once()
    save_args = mock_repo.save_textract_job.call_args[1]
    assert save_args["job_id"] == "job-abc"
    assert save_args["document_id"] == "doc-1"
    assert save_args["user_id"] == "user-1"
    assert save_args["filename"] == "report.pdf"


# ---------------------------------------------------------------------------
# Test: text file path
# ---------------------------------------------------------------------------


def test_initializer_text_file_enqueues_to_processor_queue() -> None:
    """A .txt upload should enqueue a 'text' payload to ProcessorQueue via SQS."""
    mock_repo = MagicMock()
    mock_s3 = MagicMock()
    mock_sqs = MagicMock()
    mock_settings = MagicMock()
    mock_settings.processor_queue_url = (
        "https://sqs.us-east-1.amazonaws.com/123/processor"
    )
    mock_settings.s3_bucket_name = "test-bucket"
    # Return valid UTF-8 bytes for the head read
    mock_body = MagicMock()
    mock_body.read.return_value = b"Hello world"
    mock_s3.get_object.return_value = {"Body": mock_body}

    event = _make_s3_event("test-bucket", "staging/user-2/doc-2/notes.txt")

    with (
        patch("app.worker_initializer.get_repository", return_value=mock_repo),
        patch("app.worker_initializer.get_s3_client", return_value=mock_s3),
        patch("app.worker_initializer.get_textract_client"),
        patch("app.worker_initializer.get_settings", return_value=mock_settings),
        patch("app.worker_initializer.get_sqs_client", return_value=mock_sqs),
    ):
        from app.worker_initializer import handler

        handler(event, None)

    mock_sqs.send_message.assert_called_once()
    send_args = mock_sqs.send_message.call_args[1]
    assert send_args["QueueUrl"] == "https://sqs.us-east-1.amazonaws.com/123/processor"
    payload = json.loads(send_args["MessageBody"])
    assert payload["source"] == "text"
    assert payload["document_id"] == "doc-2"
    assert payload["user_id"] == "user-2"
    assert payload["filename"] == "notes.txt"
    assert payload["s3_key"] == "staging/user-2/doc-2/notes.txt"


# ---------------------------------------------------------------------------
# Test: malformed key
# ---------------------------------------------------------------------------


def test_initializer_malformed_key_does_not_crash() -> None:
    """A key that doesn't match staging/{user}/{doc}/{file} should be skipped silently."""
    mock_repo = MagicMock()

    event = _make_s3_event("test-bucket", "not-staging/some-file.txt")

    with (
        patch("app.worker_initializer.get_repository", return_value=mock_repo),
        patch("app.worker_initializer.get_s3_client"),
        patch("app.worker_initializer.get_textract_client"),
        patch("app.worker_initializer.get_settings"),
        patch("app.worker_initializer.get_sqs_client"),
    ):
        from app.worker_initializer import handler

        handler(event, None)  # Must not raise

    # Repository should NOT have been called for a malformed key
    mock_repo.update_rag_document_status.assert_not_called()
    mock_repo.save_textract_job.assert_not_called()


# ---------------------------------------------------------------------------
# Test: UTF-8 decode failure → fallback to binary path
# ---------------------------------------------------------------------------


def test_initializer_utf8_failure_falls_back_to_binary() -> None:
    """If the head read returns non-UTF-8 bytes, the file is treated as binary."""
    mock_repo = MagicMock()
    mock_s3 = MagicMock()
    mock_textract = MagicMock()
    mock_textract.start_document_text_detection.return_value = {"JobId": "job-bin"}
    mock_settings = MagicMock()
    mock_settings.textract_sns_role_arn = "arn:aws:iam::123:role/TextractSNSRole"
    mock_settings.textract_sns_topic_arn = "arn:aws:sns:us-east-1:123:topic"
    mock_settings.s3_bucket_name = "test-bucket"
    mock_settings.processor_queue_url = (
        "https://sqs.us-east-1.amazonaws.com/123/processor"
    )

    # Return bytes that cannot be decoded as UTF-8
    mock_body = MagicMock()
    mock_body.read.return_value = b"\xff\xfe invalid utf-8"
    mock_s3.get_object.return_value = {"Body": mock_body}

    # File extension is .dat (not a known binary extension → enters text branch first)
    event = _make_s3_event("test-bucket", "staging/user-3/doc-3/data.dat")

    with (
        patch("app.worker_initializer.get_repository", return_value=mock_repo),
        patch("app.worker_initializer.get_s3_client", return_value=mock_s3),
        patch("app.worker_initializer.get_textract_client", return_value=mock_textract),
        patch("app.worker_initializer.get_settings", return_value=mock_settings),
        patch("app.worker_initializer.get_sqs_client"),
    ):
        from app.worker_initializer import handler

        handler(event, None)

    # Should have fallen back to binary path → Textract started
    mock_textract.start_document_text_detection.assert_called_once()
    mock_repo.save_textract_job.assert_called_once()


def test_initializer_image_file_routes_to_sqs() -> None:
    """An image upload should: copy file, and enqueue to SQS with source=image."""
    mock_repo = MagicMock()
    mock_s3 = MagicMock()
    mock_sqs = MagicMock()
    mock_settings = MagicMock()
    mock_settings.processor_queue_url = (
        "https://sqs.us-east-1.amazonaws.com/123/processor"
    )
    mock_settings.s3_bucket_name = "test-bucket"

    event = _make_s3_event("test-bucket", "staging/user-4/doc-4/photo.png")

    with (
        patch("app.worker_initializer.get_repository", return_value=mock_repo),
        patch("app.worker_initializer.get_s3_client", return_value=mock_s3),
        patch("app.worker_initializer.get_settings", return_value=mock_settings),
        patch("app.worker_initializer.get_sqs_client", return_value=mock_sqs),
    ):
        from app.worker_initializer import handler

        handler(event, None)

    # Status should be set to "processing" first
    mock_repo.update_rag_document_status.assert_any_call(
        "user-4",
        "doc-4",
        "processing",
        0,
        mock_repo.update_rag_document_status.call_args_list[0][0][4],
    )

    # Image should be copied to rag-raw-uploads/
    mock_s3.copy_object.assert_called_once()
    copy_args = mock_s3.copy_object.call_args[1]
    assert copy_args["Bucket"] == "test-bucket"
    assert copy_args["Key"] == "rag-raw-uploads/user-4/doc-4.png"

    # Enqueued message checks
    mock_sqs.send_message.assert_called_once()
    send_args = mock_sqs.send_message.call_args[1]
    assert send_args["QueueUrl"] == "https://sqs.us-east-1.amazonaws.com/123/processor"
    payload = json.loads(send_args["MessageBody"])
    assert payload["source"] == "image"
    assert payload["document_id"] == "doc-4"
    assert payload["user_id"] == "user-4"
    assert payload["filename"] == "photo.png"
    assert payload["s3_raw_key"] == "rag-raw-uploads/user-4/doc-4.png"
    assert payload["staging_key"] == "staging/user-4/doc-4/photo.png"
