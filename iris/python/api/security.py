import os
from secrets import compare_digest

from cryptography.fernet import Fernet, InvalidToken
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer


bearer_scheme = HTTPBearer(auto_error=False)


def get_fernet():
    key = os.environ.get("IRIS_ENCRYPTION_KEY")
    if not key:
        raise RuntimeError("IRIS_ENCRYPTION_KEY is required")
    try:
        return Fernet(key.encode("ascii"))
    except (ValueError, UnicodeEncodeError) as error:
        raise RuntimeError("IRIS_ENCRYPTION_KEY is not a valid Fernet key") from error


def validate_runtime_secrets():
    token = os.environ.get("IRIS_API_TOKEN", "")
    if len(token) < 32:
        raise RuntimeError("Set IRIS_API_TOKEN to a random value of at least 32 characters")
    get_fernet()


def require_api_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
):
    expected = os.environ.get("IRIS_API_TOKEN", "")
    if credentials is None or not compare_digest(credentials.credentials, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )


def decrypt_template(payload: bytes) -> bytes:
    try:
        return get_fernet().decrypt(payload)
    except InvalidToken as error:
        raise RuntimeError("Stored template could not be decrypted") from error