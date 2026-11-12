from io import BytesIO
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, UnidentifiedImageError

from fnc.extractFeature import extractFeatureFromImage


MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_IMAGE_PIXELS = 16_000_000
SUPPORTED_FORMATS = {"BMP", "JPEG", "PNG"}
MIN_EYE_REGION_FRACTION = 0.03

_eye_detector = cv2.CascadeClassifier(
    str(Path(cv2.data.haarcascades) / "haarcascade_eye.xml")
)
if _eye_detector.empty():
    raise RuntimeError("OpenCV's eye-detection cascade could not be loaded")


def _contains_eye_region(grayscale: np.ndarray) -> bool:
    detections = _eye_detector.detectMultiScale(
        grayscale,
        scaleFactor=1.05,
        minNeighbors=1,
        minSize=(12, 12),
    )
    image_area = grayscale.shape[0] * grayscale.shape[1]
    return any(
        width * height / image_area >= MIN_EYE_REGION_FRACTION
        for _, _, width, height in detections
    )


def extract_upload(image_bytes: bytes):
    if not image_bytes or len(image_bytes) > MAX_IMAGE_BYTES:
        raise ValueError("Image must be non-empty and no larger than 5 MB")

    try:
        with Image.open(BytesIO(image_bytes)) as image:
            if image.format not in SUPPORTED_FORMATS:
                raise ValueError("Image must be BMP, JPEG, or PNG")
            width, height = image.size
            if width < 100 or height < 100 or width * height > MAX_IMAGE_PIXELS:
                raise ValueError("Image dimensions are outside the accepted range")
            image.load()
            grayscale = np.asarray(image.convert("L"), dtype=np.uint8)
    except (UnidentifiedImageError, OSError) as error:
        raise ValueError("Uploaded file is not a valid supported image") from error

    if not _contains_eye_region(grayscale):
        raise ValueError("Image does not contain a detectable eye region")

    return extractFeatureFromImage(grayscale, use_multiprocess=False)