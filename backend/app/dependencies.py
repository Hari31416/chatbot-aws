from __future__ import annotations

import json
import logging
import urllib.request
from functools import lru_cache

import boto3
from botocore.config import Config
from fastapi import Depends, HTTPException, status

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


def get_vision_llm_client() -> LlmClient:
    settings = get_settings()
    api_key = settings.litellm_vision_api_key

    ssm_param_name = os.getenv("LITELLM_VISION_API_KEY_PARAMETER")
    if ssm_param_name:
        ssm_key = get_ssm_parameter(ssm_param_name)
        if ssm_key:
            api_key = ssm_key

    # Fallback to standard key if no vision API key is configured
    if not api_key:
        api_key = settings.litellm_api_key
        ssm_param_name_std = os.getenv("LITELLM_API_KEY_PARAMETER")
        if ssm_param_name_std:
            ssm_key_std = get_ssm_parameter(ssm_param_name_std)
            if ssm_key_std:
                api_key = ssm_key_std

    return LlmClient(
        model=settings.litellm_vision_model,
        api_key=api_key,
        base_url=settings.litellm_vision_base_url,
    )


from fastapi import Request

logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def get_jwks(jwks_url: str) -> dict:
    try:
        with urllib.request.urlopen(jwks_url, timeout=5) as response:
            return json.loads(response.read().decode("utf-8"))
    except Exception as e:
        logger.warning("Failed to fetch JWKS from %s: %s", jwks_url, e)
        return {"keys": []}


def get_current_user_id(request: Request, settings: Settings = Depends(get_settings)) -> str:
    # 1. AWS Lambda Environment: Extract Cognito claims from API Gateway (if present)
    aws_event = request.scope.get("aws.event")
    if aws_event and isinstance(aws_event, dict):
        request_context = aws_event.get("requestContext", {})
        authorizer = request_context.get("authorizer", {})
        jwt_data = authorizer.get("jwt", {})
        claims = jwt_data.get("claims", {})
        # Cognito passes user ID/username inside JWT claims
        cognito_user = claims.get("username") or claims.get("sub")
        if cognito_user:
            return cognito_user

    # 2. Extract and Validate Bearer Token from Authorization Header
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.split(" ")[1]

        # Local development fallback for short dummy tokens (e.g., "admin")
        if token and (len(token) < 50 or token.count(".") != 2):
            if settings.cognito_user_pool_id:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid token format"
                )
            return token

        # If it looks like a JWT token, attempt to parse and verify it
        try:
            import jwt

            # Unverified header to find key ID (kid)
            unverified_header = jwt.get_unverified_header(token)
            kid = unverified_header.get("kid")

            # Try to fetch and match public keys from Cognito
            if settings.cognito_user_pool_id:
                jwks_url = f"https://cognito-idp.{settings.aws_region}.amazonaws.com/{settings.cognito_user_pool_id}/.well-known/jwks.json"
                jwks = get_jwks(jwks_url)

                public_key = None
                for key in jwks.get("keys", []):
                    if key.get("kid") == kid:
                        from jwt.algorithms import RSAAlgorithm
                        public_key = RSAAlgorithm.from_jwk(key)
                        break

                if public_key:
                    payload = jwt.decode(
                        token,
                        public_key,
                        algorithms=["RS256"],
                        audience=settings.cognito_client_id,
                        options={"verify_exp": True},
                    )
                    return payload.get("sub") or payload.get("email") or payload.get("cognito:username")
                
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Token key ID not found in Cognito JWKS"
                )

            # Fallback 1: Decode without signature verification (useful for local dev)
            logger.warning("JWKS validation skipped or key not found. Performing unverified decode for fallback.")
            payload = jwt.decode(token, options={"verify_signature": False})
            return payload.get("sub") or payload.get("email") or payload.get("cognito:username") or "admin"

        except Exception as e:
            logger.warning("JWT validation failed: %s", e)
            if settings.cognito_user_pool_id:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail=f"Signature verification failed: {str(e)}"
                )
            try:
                import jwt
                payload = jwt.decode(token, options={"verify_signature": False})
                return payload.get("sub") or payload.get("email") or "admin"
            except Exception:
                return "admin"

    # 3. Custom Local Headers
    x_user = request.headers.get("X-User-ID")
    if x_user:
        return x_user

    # Enforce strict auth in production if no authorization header is provided
    if settings.cognito_user_pool_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header is required"
        )

    return "admin"


