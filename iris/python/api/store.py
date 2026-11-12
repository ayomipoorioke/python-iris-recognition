import base64
import hashlib
import hmac
import io
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

import numpy as np

from api.security import decrypt_template, get_fernet


class AlreadyEnrolled(Exception):
    pass


def database_path() -> Path:
    default_path = Path(__file__).resolve().parent.parent / "instance" / "iris.sqlite3"
    return Path(os.environ.get("IRIS_DB_PATH", default_path)).resolve()


def _connect():
    path = database_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=5)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA secure_delete = ON")
    return connection


@contextmanager
def _connection():
    connection = _connect()
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def initialize_store():
    with _connection() as connection:
        connection.execute(
            """CREATE TABLE IF NOT EXISTS templates (
                subject_digest TEXT PRIMARY KEY,
                encrypted_template BLOB NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )"""
        )


def _subject_digest(subject_id: str) -> str:
    raw_key = base64.urlsafe_b64decode(os.environ["IRIS_ENCRYPTION_KEY"])
    key = hashlib.sha256(b"iris-template-index-v1" + raw_key[:16]).digest()
    return hmac.new(key, subject_id.encode("utf-8"), hashlib.sha256).hexdigest()


def save_template(subject_id: str, template: np.ndarray, mask: np.ndarray):
    buffer = io.BytesIO()
    np.savez_compressed(
        buffer,
        template=np.asarray(template, dtype=np.uint8),
        mask=np.asarray(mask, dtype=np.uint8),
    )
    encrypted = get_fernet().encrypt(buffer.getvalue())
    try:
        with _connection() as connection:
            connection.execute(
                "INSERT INTO templates (subject_digest, encrypted_template) VALUES (?, ?)",
                (_subject_digest(subject_id), encrypted),
            )
    except sqlite3.IntegrityError as error:
        raise AlreadyEnrolled from error


def load_template(subject_id: str):
    with _connection() as connection:
        row = connection.execute(
            "SELECT encrypted_template FROM templates WHERE subject_digest = ?",
            (_subject_digest(subject_id),),
        ).fetchone()
    if row is None:
        return None

    with np.load(io.BytesIO(decrypt_template(row["encrypted_template"])), allow_pickle=False) as data:
        template = data["template"].astype(bool)
        mask = data["mask"].astype(bool)
    if template.ndim != 2 or template.shape != mask.shape:
        raise RuntimeError("Stored template has an invalid shape")
    return template, mask


def delete_template(subject_id: str) -> bool:
    with _connection() as connection:
        result = connection.execute(
            "DELETE FROM templates WHERE subject_digest = ?",
            (_subject_digest(subject_id),),
        )
    return result.rowcount > 0