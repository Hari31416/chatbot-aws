from __future__ import annotations

import logging
from dataclasses import dataclass

logger = logging.getLogger(__name__)

_MIME_EXTENSION_MAP = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
}


@dataclass(frozen=True)
class UploadResult:
    s3_key: str
    mime_type: str
    size_bytes: int


class StorageService:
    def __init__(self, s3_client, bucket_name: str):
        self._s3 = s3_client
        self._bucket = bucket_name
        logger.info("StorageService initialised bucket=%s", bucket_name)

    def upload_image(self, key: str, data: bytes, mime_type: str) -> UploadResult:
        logger.debug(
            "Uploading image key=%s mime_type=%s size=%d", key, mime_type, len(data)
        )
        self._s3.put_object(
            Bucket=self._bucket,
            Key=key,
            Body=data,
            ContentType=mime_type,
        )
        logger.info("Image uploaded key=%s size_bytes=%d", key, len(data))
        return UploadResult(s3_key=key, mime_type=mime_type, size_bytes=len(data))

    def upload_bytes(self, key: str, data: bytes, mime_type: str) -> None:
        logger.debug(
            "Uploading raw bytes key=%s mime_type=%s size=%d", key, mime_type, len(data)
        )
        self._s3.put_object(
            Bucket=self._bucket,
            Key=key,
            Body=data,
            ContentType=mime_type,
        )
        logger.info("Raw bytes uploaded key=%s size_bytes=%d", key, len(data))

    def generate_presigned_url(self, key: str, expiration_seconds: int = 3600) -> str:
        try:
            url = self._s3.generate_presigned_url(
                "get_object",
                Params={"Bucket": self._bucket, "Key": key},
                ExpiresIn=expiration_seconds,
            )
            logger.debug("Presigned URL generated key=%s", key)
            return url
        except Exception:
            fallback = f"https://{self._bucket}.s3.amazonaws.com/{key}"
            logger.warning(
                "Failed to generate presigned URL key=%s; using fallback url=%s",
                key,
                fallback,
                exc_info=True,
            )
            return fallback


def extension_for_mime(mime_type: str) -> str:
    extension = _MIME_EXTENSION_MAP.get(mime_type)
    if not extension:
        raise ValueError(f"Unsupported mime type: {mime_type}")
    return extension


def build_image_key(conversation_id: str, message_id: str, extension: str) -> str:
    return f"{conversation_id}/{message_id}.{extension}"
