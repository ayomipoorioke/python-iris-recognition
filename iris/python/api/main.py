import logging
import os
import re
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel
from fastapi.staticfiles import StaticFiles
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from api.pipeline import MAX_IMAGE_BYTES, extract_upload
from api.security import require_api_token, validate_runtime_secrets
from api.store import AlreadyEnrolled, delete_template, initialize_store, load_template, save_template
from fnc.matching import calHammingDist


logging.basicConfig(level=os.environ.get("IRIS_LOG_LEVEL", "INFO"))
logger = logging.getLogger("iris_api")
limiter = Limiter(key_func=get_remote_address, default_limits=["30/minute"])


class HealthResponse(BaseModel):
    status: str
    mode: str


class EnrollmentResponse(BaseModel):
    status: str
    subject_id: str


class VerificationResponse(BaseModel):
    verified: bool


class DeletionResponse(BaseModel):
    status: str
    subject_id: str


def match_threshold() -> float:
    try:
        threshold = float(os.environ.get("IRIS_MATCH_THRESHOLD", "0.38"))
    except ValueError as error:
        raise RuntimeError("IRIS_MATCH_THRESHOLD must be a number from 0 to 1") from error
    if not 0 <= threshold <= 1:
        raise RuntimeError("IRIS_MATCH_THRESHOLD must be a number from 0 to 1")
    return threshold


@asynccontextmanager
async def lifespan(_app: FastAPI):
    validate_runtime_secrets()
    match_threshold()
    initialize_store()
    yield


app = FastAPI(
    title="Consent-Based Iris Research Demo",
    description="Local 1:1 verification prototype. Not suitable for production authentication.",
    lifespan=lifespan,
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


def validate_subject_id(subject_id: str):
    if not re.fullmatch(r"[A-Za-z0-9_-]{8,64}", subject_id):
        raise HTTPException(status_code=422, detail="Use an opaque 8-64 character subject ID")


async def read_upload(image: UploadFile) -> bytes:
    try:
        content = await image.read(MAX_IMAGE_BYTES + 1)
    finally:
        await image.close()
    if not content or len(content) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image must be non-empty and no larger than 5 MB")
    return content


def extract_or_reject(image_bytes: bytes):
    try:
        return extract_upload(image_bytes)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except Exception as error:
        logger.exception("Image processing failed")
        raise HTTPException(status_code=422, detail="Could not extract an iris template from this image") from error


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return {"status": "ok", "mode": "local-research-demo"}


@app.post("/v1/enroll", response_model=EnrollmentResponse, dependencies=[Depends(require_api_token)])
@limiter.limit("5/minute")
async def enroll(
    request: Request,
    subject_id: str = Form(...),
    consent: bool = Form(...),
    image: UploadFile = File(...),
):
    validate_subject_id(subject_id)
    if not consent:
        raise HTTPException(status_code=400, detail="Explicit informed consent is required")
    image_bytes = await read_upload(image)
    template, mask, _ = extract_or_reject(image_bytes)
    try:
        save_template(subject_id, template, mask)
    except AlreadyEnrolled as error:
        raise HTTPException(status_code=409, detail="Subject is already enrolled") from error
    return {"status": "enrolled", "subject_id": subject_id}


@app.post("/v1/verify", response_model=VerificationResponse, dependencies=[Depends(require_api_token)])
@limiter.limit("10/minute")
async def verify(
    request: Request,
    subject_id: str = Form(...),
    image: UploadFile = File(...),
):
    validate_subject_id(subject_id)
    registered = load_template(subject_id)
    if registered is None:
        raise HTTPException(status_code=404, detail="No enrolled template for this subject")
    image_bytes = await read_upload(image)
    template, mask, _ = extract_or_reject(image_bytes)
    distance = calHammingDist(template, mask, registered[0], registered[1])
    threshold = match_threshold()
    if not np.isfinite(distance):
        return {"verified": False}
    return {"verified": bool(distance <= threshold)}


@app.delete("/v1/templates/{subject_id}", response_model=DeletionResponse, dependencies=[Depends(require_api_token)])
@limiter.limit("10/minute")
def delete_enrollment(request: Request, subject_id: str):
    validate_subject_id(subject_id)
    if not delete_template(subject_id):
        raise HTTPException(status_code=404, detail="No enrolled template for this subject")
    return {"status": "deleted", "subject_id": subject_id}


ui_directory = Path(__file__).resolve().parent.parent / "ui"
app.mount("/", StaticFiles(directory=ui_directory, html=True), name="ui")