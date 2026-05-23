from __future__ import annotations

from functools import lru_cache

import boto3
from botocore.config import Config

from .repositories.conversation_repository import ConversationRepository
from .services.llm import LlmClient
from .services.storage import StorageService
from .settings import Settings


@lru_cache
def get_settings() -> Settings:
    return Settings()


@lru_cache
def get_dynamodb_table():
    settings = get_settings()
    resource = boto3.resource(
        "dynamodb",
        region_name=settings.aws_region,
        endpoint_url=settings.dynamodb_endpoint_url,
    )
    return resource.Table(settings.dynamodb_table_name)


@lru_cache
def get_s3_client():
    settings = get_settings()
    config = None
    if settings.s3_force_path_style:
        config = Config(s3={"addressing_style": "path"})
    return boto3.client(
        "s3",
        region_name=settings.aws_region,
        endpoint_url=settings.s3_endpoint_url,
        config=config,
    )


def get_repository() -> ConversationRepository:
    table = get_dynamodb_table()
    return ConversationRepository(table)


def get_storage() -> StorageService:
    settings = get_settings()
    client = get_s3_client()
    return StorageService(client, settings.s3_bucket_name)


import os


@lru_cache
def get_ssm_parameter(param_name: str) -> str | None:
    try:
        ssm = boto3.client("ssm", region_name=get_settings().aws_region)
        response = ssm.get_parameter(Name=param_name, WithDecryption=True)
        return response["Parameter"]["Value"]
    except Exception:
        return None


def get_llm_client() -> LlmClient:
    settings = get_settings()
    api_key = settings.litellm_api_key

    ssm_param_name = os.getenv("LITELLM_API_KEY_PARAMETER")
    if ssm_param_name:
        ssm_key = get_ssm_parameter(ssm_param_name)
        if ssm_key:
            api_key = ssm_key

    return LlmClient(
        model=settings.litellm_model,
        api_key=api_key,
        base_url=settings.litellm_base_url,
    )

