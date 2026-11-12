# Local Iris API Demo

This is a research/demo wrapper around the upstream classical iris pipeline. It performs 1:1 matching against a claimed subject ID; it does not capture from a camera, perform liveness detection, or provide production-grade authentication. Use only images from people who gave informed consent. Never use the result as the only factor protecting an account or device.

## Project map

```text
iris/python/
|-- api/
|   |-- main.py             FastAPI routes, validation, throttling, lifecycle
|   |-- pipeline.py         In-memory upload decoding and feature extraction
|   |-- security.py         Bearer-token check and Fernet key handling
|   `-- store.py            Encrypted-template SQLite operations
|-- ui/
|   |-- index.html          Welcome, registration, verification, settings/help screens
|   |-- styles.css          Responsive, accessible visual styles
|   |-- app.js               Screen flow, consent, status and cleanup
|   |-- api.js               Authenticated API calls and account-ID hashing
|   `-- camera.js            Camera preview and temporary image capture
|-- fnc/                    Upstream segmentation, normalization, encoding, matching
|-- tests/test_api.py       Synthetic-data security, storage, and validation tests
|-- instance/                Generated SQLite database (ignored by Git)
|-- requirements-api.txt    Modern dependencies for the API demo and tests
|-- requirements.txt        Upstream legacy CLI dependency pins
|-- .env.example            Names of configuration variables; placeholder values only
|-- .gitignore              Excludes secrets, local database, and virtual environment
`-- README_API.md           Setup, run, API, privacy, and Flutter notes
```

## Requirements and setup (Windows PowerShell)

Python 3.11 or newer is recommended. From `iris/python`:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements-api.txt
```

The API uses the existing code under `fnc/`. Its separate dependency file avoids trying to install the obsolete pins in `requirements.txt` (for the original scripts).

For a fresh local database, set secrets in the PowerShell terminal that will run the server. Keep the encryption key stable for any database with registrations; do not generate a replacement key for an existing database.

```powershell
$token = .\.venv\Scripts\python.exe -c "import secrets; print(secrets.token_urlsafe(32))"
$env:IRIS_API_TOKEN = $token.Trim()
$key = .\.venv\Scripts\python.exe -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
$env:IRIS_ENCRYPTION_KEY = $key.Trim()
$env:IRIS_DB_PATH = ".\instance\iris.sqlite3"
Write-Output "API token for the UI: $env:IRIS_API_TOKEN"
Write-Output "Save this encryption key privately: $env:IRIS_ENCRYPTION_KEY"
```

Enter the API token in the UI's **Settings & Help** screen. The UI holds it in memory for the current tab only. Save the encryption key separately in an approved password manager; losing it makes stored registrations unrecoverable. Do not put either secret in source control or a Flutter app.

The default database is `iris/python/instance/iris.sqlite3`, regardless of the directory used to launch the API. `run-local.ps1` explicitly uses this database. For an existing database, the script prompts for its saved encryption key and refuses to replace it. It generates a new API token each launch unless `IRIS_API_TOKEN` is already set in that PowerShell session to a random value of at least 32 characters; enter the displayed or provided token in the UI. You can override the database path with `IRIS_DB_PATH` when intentionally using a different database.

## Run

```powershell
python -m uvicorn api.main:app --host 127.0.0.1 --port 8000
```

The app UI is at `http://127.0.0.1:8000`; interactive API docs are at `/docs`, and health is at `/health`. The health route is public. Enrollment, verification, and deletion require `Authorization: Bearer <IRIS_API_TOKEN>`. The token protects access to this local demo API; it is not an end-user identity system.

The UI asks for consent before camera access. Registration has three steps: account identifier and consent, camera/image scan, then confirmation before saving. Verification returns only a success/failure message. The UI can use a camera or a selected BMP/JPEG/PNG image. Camera access requires browser permission; if unavailable, choose an image instead.

The UI normalizes and SHA-256 transforms the entered account identifier in the browser so that email/username text is not sent as the API subject ID. This is pseudonymous, not anonymous: do not use highly sensitive identifiers. The backend accepts only opaque 8-64 character IDs. The API decodes uploaded images in memory and applies a coarse OpenCV eye-region detector before feature extraction. It stores no raw image; only its encrypted binary iris representation is retained in SQLite after consent and confirmation. A captured/selected image remains temporary in browser memory until the request finishes or the user leaves the flow.

Example with a consenting test subject and a local research image:

```powershell
$headers = @{ Authorization = "Bearer $env:IRIS_API_TOKEN" }
$subject = "test_subject_01"
curl.exe -X POST http://127.0.0.1:8000/v1/enroll -H "Authorization: Bearer $env:IRIS_API_TOKEN" -F "subject_id=$subject" -F "consent=true" -F "image=@..\CASIA1\1\001_1_1.jpg"
curl.exe -X POST http://127.0.0.1:8000/v1/verify -H "Authorization: Bearer $env:IRIS_API_TOKEN" -F "subject_id=$subject" -F "image=@..\CASIA1\1\001_1_2.jpg"
curl.exe -X DELETE http://127.0.0.1:8000/v1/templates/$subject -H "Authorization: Bearer $env:IRIS_API_TOKEN"
```

Replace the example paths with files that actually exist in the dataset you have permission to use. Responses reveal only a boolean match, not a similarity score. Limits are per-process and per-IP, so they are not adequate for a multi-worker or public deployment.

Run the API control/storage test suite with synthetic image data:

```powershell
python -m unittest discover -s tests -v
```

## Pipeline and storage

The upstream code detects pupil/iris circles and eyelid/eyelash noise (`fnc/segment.py`), unwraps the annular iris to a fixed polar array (`fnc/normalize.py`), creates a phase-quantized binary code and mask (`fnc/encode.py`), then compares the code with shifted masked Hamming distance (`fnc/matching.py`). There is no neural-network model or camera integration. A camera would need suitable near-infrared hardware and a separately validated capture/liveness subsystem.

SQLite stores only an HMAC-derived subject lookup key and Fernet-encrypted NumPy template/mask data. `IRIS_DB_PATH` selects the local database. Deleting a record is best effort; SQLite journaling, backups, SSD wear leveling, and filesystem snapshots mean software cannot promise forensic erasure. For test cleanup, call the delete endpoint, stop the service, remove the database and its SQLite journal/WAL files, and remove any backups using the storage provider's documented deletion process. Keep raw research images outside this app and delete copies according to their dataset terms and consent.

## Security and privacy limits

- Use HTTPS, managed per-user authentication, authorization, a shared rate-limit store, monitored audit events, key rotation, encrypted backups, and a threat model before any deployment beyond localhost.
- Do not embed the bearer token in Flutter. A mobile client needs a real user login/session to a backend; the backend must independently authorize the account before invoking this demo. TLS is mandatory outside localhost.
- The eye-region check is a coarse Haar-cascade filter, not proof of an iris; it can miss valid eyes or detect eye-like patterns. The bundled matcher has no liveness or presentation-attack detection and the threshold is not calibrated for real users. It can accept photographs/replays and must not unlock a device, authorize payment, or replace a password/passkey.
- Biometric collection can trigger heightened legal requirements (for example, GDPR special-category data and state biometric privacy laws). Obtain jurisdiction-specific legal review, provide clear purpose/retention/deletion notices, obtain explicit informed consent where required, minimize collection, and offer a non-biometric alternative. The public sample datasets have separate terms; check them before reuse.
- Template encryption helps at rest but does not make biometrics anonymous or revokeable. Restrict key access, keep keys outside the database and source control, and treat templates and derived match outcomes as sensitive data.

## Flutter client boundary

This demo binds to `127.0.0.1`, which is reachable only from the same computer. A phone cannot call that address. Do not copy `IRIS_API_TOKEN` into Flutter: it is a shared operator secret. A real mobile deployment first needs an HTTPS backend reachable by the phone, per-user login/session tokens (for example, OIDC), and server-side authorization tying the logged-in account to the requested opaque subject ID. The backend must replace the demo's shared-token dependency with that session validation.

After that server-side authentication is in place, Flutter can send a multipart request with the `http` package. The session token below must come from the user's login flow, not a hard-coded API key:

```dart
final request = http.MultipartRequest(
	'POST',
	Uri.parse('$baseUrl/v1/verify'),
)
	..headers['Authorization'] = 'Bearer $sessionToken'
	..fields['subject_id'] = subjectId
	..files.add(await http.MultipartFile.fromPath('image', imagePath));

final response = await request.send();
```

For enrollment, use `/v1/enroll` and add `request.fields['consent'] = 'true'` only after the person has reviewed and affirmatively accepted the consent notice. The server must still authorize that account and retain consent/retention records appropriate to the applicable law.