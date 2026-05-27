from __future__ import annotations

import time
from unittest.mock import patch

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException

from app.dependencies import _verify_clerk_token, get_settings


def _generate_rsa_keypair() -> tuple[bytes, dict]:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    public_numbers = private_key.public_key().public_numbers()
    jwk = {
        "kty": "RSA",
        "kid": "test-kid",
        "use": "sig",
        "alg": "RS256",
        "n": jwt.utils.base64url_encode(
            public_numbers.n.to_bytes(
                (public_numbers.n.bit_length() + 7) // 8, byteorder="big"
            )
        ).decode(),
        "e": jwt.utils.base64url_encode(
            public_numbers.e.to_bytes(
                (public_numbers.e.bit_length() + 7) // 8, byteorder="big"
            )
        ).decode(),
    }
    return private_pem, jwk


@pytest.fixture
def clerk_keypair(
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[bytes, dict, str]:
    private_pem, jwk = _generate_rsa_keypair()
    issuer = "https://test-instance.clerk.accounts.dev"
    monkeypatch.setenv("CLERK_ISSUER", issuer)
    monkeypatch.setenv("CLERK_JWKS_URL", f"{issuer}/.well-known/jwks.json")
    monkeypatch.setenv("CLERK_AUTHORIZED_PARTIES", "http://localhost:3000")
    get_settings.cache_clear()
    return private_pem, jwk, issuer


def _make_token(
    private_pem: bytes, issuer: str, azp: str, sub: str = "user_clerk_test_123"
) -> str:
    now = int(time.time())
    return jwt.encode(
        {
            "sub": sub,
            "iss": issuer,
            "azp": azp,
            "iat": now,
            "exp": now + 3600,
        },
        private_pem,
        algorithm="RS256",
        headers={"kid": "test-kid"},
    )


def test_clerk_jwt_verified(clerk_keypair: tuple[bytes, dict, str]) -> None:
    private_pem, jwk, issuer = clerk_keypair
    token = _make_token(private_pem, issuer, "http://localhost:3000")
    settings = get_settings()

    with patch("app.dependencies.get_jwks", return_value={"keys": [jwk]}):
        payload = _verify_clerk_token(token, settings)

    assert payload["sub"] == "user_clerk_test_123"


def test_clerk_invalid_azp_rejected(clerk_keypair: tuple[bytes, dict, str]) -> None:
    private_pem, jwk, issuer = clerk_keypair
    token = _make_token(private_pem, issuer, "https://evil.example.com")
    settings = get_settings()

    with patch("app.dependencies.get_jwks", return_value={"keys": [jwk]}):
        with pytest.raises(HTTPException) as exc_info:
            _verify_clerk_token(token, settings)

    assert exc_info.value.status_code == 401


def test_clerk_jwt_leeway(clerk_keypair: tuple[bytes, dict, str]) -> None:
    private_pem, jwk, issuer = clerk_keypair
    now = int(time.time())
    # Generate token that expired 10 seconds ago
    token = jwt.encode(
        {
            "sub": "user_clerk_test_123",
            "iss": issuer,
            "azp": "http://localhost:3000",
            "iat": now - 70,
            "exp": now - 10,
        },
        private_pem,
        algorithm="RS256",
        headers={"kid": "test-kid"},
    )
    settings = get_settings()

    with patch("app.dependencies.get_jwks", return_value={"keys": [jwk]}):
        payload = _verify_clerk_token(token, settings)

    assert payload["sub"] == "user_clerk_test_123"


def test_clerk_jwt_trailing_slash_issuer(clerk_keypair: tuple[bytes, dict, str], monkeypatch: pytest.MonkeyPatch) -> None:
    private_pem, jwk, issuer = clerk_keypair
    # Set settings issuer WITH trailing slash
    monkeypatch.setenv("CLERK_ISSUER", issuer + "/")
    get_settings.cache_clear()
    settings = get_settings()
    
    # Token has issuer WITHOUT trailing slash
    token = _make_token(private_pem, issuer, "http://localhost:3000")

    with patch("app.dependencies.get_jwks", return_value={"keys": [jwk]}):
        payload = _verify_clerk_token(token, settings)

    assert payload["sub"] == "user_clerk_test_123"


def test_clerk_jwt_azp_trailing_slash(clerk_keypair: tuple[bytes, dict, str], monkeypatch: pytest.MonkeyPatch) -> None:
    private_pem, jwk, issuer = clerk_keypair
    # Configure expected party with trailing slash
    monkeypatch.setenv("CLERK_AUTHORIZED_PARTIES", "http://localhost:3000/")
    get_settings.cache_clear()
    settings = get_settings()
    
    # Token has azp WITHOUT trailing slash
    token = _make_token(private_pem, issuer, "http://localhost:3000")

    with patch("app.dependencies.get_jwks", return_value={"keys": [jwk]}):
        payload = _verify_clerk_token(token, settings)

    assert payload["sub"] == "user_clerk_test_123"
