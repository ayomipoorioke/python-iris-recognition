import io
import os
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

import numpy as np
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from PIL import Image

from api.main import app
from api.pipeline import extract_upload
from api.store import database_path


class ApiFlowTests(unittest.TestCase):
    def test_default_database_path_is_independent_of_working_directory(self):
        expected = Path(__file__).resolve().parents[1] / "instance" / "iris.sqlite3"
        with patch.dict(os.environ):
            os.environ.pop("IRIS_DB_PATH", None)
            self.assertEqual(database_path(), expected)

    def test_upload_validation_rejects_bad_and_oversized_images(self):
        with self.assertRaisesRegex(ValueError, "valid supported image"):
            extract_upload(b"not an image")
        with self.assertRaisesRegex(ValueError, "no larger than 5 MB"):
            extract_upload(b"x" * (5 * 1024 * 1024 + 1))

    def test_upload_validation_rejects_image_without_detectable_eye(self):
        image_buffer = io.BytesIO()
        Image.new("L", (128, 128), color=90).save(image_buffer, format="PNG")

        with self.assertRaisesRegex(ValueError, "detectable eye region"):
            extract_upload(image_buffer.getvalue())

    def test_upload_validation_accepts_casia_eye_image(self):
        dataset_root = Path(__file__).resolve().parents[2]
        image_paths = (
            dataset_root / "CASIA1" / "1" / "001_1_1.jpg",
            dataset_root / "MMU2" / "1" / "010101.bmp",
        )

        for image_path in image_paths:
            with self.subTest(image=image_path.name):
                template, mask, _ = extract_upload(image_path.read_bytes())
                self.assertEqual(template.shape, (20, 480))
                self.assertEqual(mask.shape, template.shape)

    def test_consent_auth_enrollment_verification_and_deletion(self):
        token = "test-token-that-is-long-enough-for-the-api"
        key = Fernet.generate_key().decode("ascii")
        subject_id = "test_subject_01"
        template = np.zeros((20, 480), dtype=bool)
        mask = np.zeros((20, 480), dtype=bool)
        image_buffer = io.BytesIO()
        Image.new("L", (128, 128), color=90).save(image_buffer, format="PNG")
        image_bytes = image_buffer.getvalue()

        with tempfile.TemporaryDirectory() as data_dir:
            environment = {
                "IRIS_API_TOKEN": token,
                "IRIS_ENCRYPTION_KEY": key,
                "IRIS_DB_PATH": str(Path(data_dir) / "templates.sqlite3"),
            }
            with patch.dict(os.environ, environment):
                with patch("api.main.extract_or_reject", return_value=(template, mask, None)):
                    with TestClient(app) as client:
                        ui_response = client.get("/")
                        self.assertEqual(ui_response.status_code, 200)
                        self.assertIn("Iris Access", ui_response.text)
                        for asset_path in ("/styles.css", "/app.js", "/api.js", "/camera.js"):
                            asset_response = client.get(asset_path)
                            self.assertEqual(asset_response.status_code, 200, asset_path)

                        files = {"image": ("synthetic.png", image_bytes, "image/png")}
                        no_auth = client.post(
                            "/v1/enroll",
                            data={"subject_id": subject_id, "consent": "true"},
                            files=files,
                        )
                        self.assertEqual(no_auth.status_code, 401)

                        headers = {"Authorization": f"Bearer {token}"}
                        no_consent = client.post(
                            "/v1/enroll",
                            data={"subject_id": subject_id, "consent": "false"},
                            files=files,
                            headers=headers,
                        )
                        self.assertEqual(no_consent.status_code, 400)

                        enrolled = client.post(
                            "/v1/enroll",
                            data={"subject_id": subject_id, "consent": "true"},
                            files=files,
                            headers=headers,
                        )
                        self.assertEqual(enrolled.status_code, 200)

                        verified = client.post(
                            "/v1/verify",
                            data={"subject_id": subject_id},
                            files=files,
                            headers=headers,
                        )
                        self.assertEqual(verified.status_code, 200)
                        self.assertTrue(verified.json()["verified"])

                        duplicate = client.post(
                            "/v1/enroll",
                            data={"subject_id": subject_id, "consent": "true"},
                            files=files,
                            headers=headers,
                        )
                        self.assertEqual(duplicate.status_code, 409)

                        with closing(sqlite3.connect(environment["IRIS_DB_PATH"])) as connection:
                            encrypted = connection.execute(
                                "SELECT encrypted_template FROM templates"
                            ).fetchone()[0]
                        self.assertTrue(Fernet(key.encode("ascii")).decrypt(encrypted).startswith(b"PK"))

                        deleted = client.delete(
                            f"/v1/templates/{subject_id}",
                            headers=headers,
                        )
                        self.assertEqual(deleted.status_code, 200)


if __name__ == "__main__":
    unittest.main()