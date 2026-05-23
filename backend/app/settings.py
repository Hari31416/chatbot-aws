from __future__ import annotations

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    aws_region: str = Field(default="us-east-1", validation_alias="AWS_REGION")
    dynamodb_table_name: str = Field(
        default="chatbot", validation_alias="DYNAMODB_TABLE_NAME"
    )
    dynamodb_endpoint_url: str | None = Field(
        default=None, validation_alias="DYNAMODB_ENDPOINT_URL"
    )
    s3_bucket_name: str = Field(
        default="chatbot-uploads", validation_alias="S3_BUCKET_NAME"
    )
    s3_endpoint_url: str | None = Field(
        default=None, validation_alias="S3_ENDPOINT_URL"
    )
    s3_force_path_style: bool = Field(
        default=False, validation_alias="S3_FORCE_PATH_STYLE"
    )

    context_ttl_seconds: int = Field(
        default=3600, validation_alias="CONTEXT_TTL_SECONDS"
    )
    max_image_bytes: int = Field(
        default=5 * 1024 * 1024, validation_alias="MAX_IMAGE_BYTES"
    )
    allowed_image_mime_types: list[str] | str = Field(
        default_factory=lambda: ["image/png", "image/jpeg", "image/webp"],
        validation_alias="ALLOWED_IMAGE_MIME_TYPES",
    )
    max_history_messages: int = Field(
        default=10, validation_alias="MAX_HISTORY_MESSAGES"
    )

    litellm_model: str = Field(default="gpt-4o-mini", validation_alias="LITELLM_MODEL")
    litellm_api_key: str | None = Field(
        default=None, validation_alias="LITELLM_API_KEY"
    )
    litellm_base_url: str | None = Field(
        default=None, validation_alias="LITELLM_BASE_URL"
    )

    @field_validator("allowed_image_mime_types", mode="before")
    @classmethod
    def _parse_mime_types(cls, value: object) -> list[str] | object:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value
