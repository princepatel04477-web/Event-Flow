import requests
import os

BASE_URL = "http://localhost:3000"
TIMEOUT = 30

admin_credentials = {
    "email": "admin@test",
    "password": "adminpassword"  # Assuming the password; replace if known
}

# For the import preview and commit, we need to upload an Excel file.
# Prepare a minimal valid Excel file bytes for testing.
# Since we cannot create a real Excel file here, we will simulate with a dummy byte content.
# In real environment, replace with an actual Excel file path or bytes.
DUMMY_EXCEL_CONTENT = b"PK\x03\x04\x14\x00\x06\x00"  # Beginning of a zip/xlsx file header

def login_as_admin():
    session = requests.Session()
    resp = session.post(
        f"{BASE_URL}/api/auth/login",
        json=admin_credentials,
        timeout=TIMEOUT
    )
    assert resp.status_code == 200, f"Login failed: {resp.text}"
    # Do not parse JSON token, assume session cookie is set
    return session

def test_post_api_import_preview_and_commit():
    session = login_as_admin()

    # 1. POST /api/import/preview with an Excel file
    files = {
        "file": ("import.xlsx", DUMMY_EXCEL_CONTENT, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    }

    resp_preview = session.post(
        f"{BASE_URL}/api/import/preview",
        files=files,
        timeout=TIMEOUT
    )

    assert resp_preview.status_code == 200, f"Preview failed: {resp_preview.text}"
    preview_data = resp_preview.json()

    # Validate preview response contains inserts, updates, skips arrays or counts
    assert "inserts" in preview_data or "inserts_count" in preview_data, "Preview missing inserts info"
    assert "updates" in preview_data or "updates_count" in preview_data, "Preview missing updates info"
    assert "skips" in preview_data or "skips_count" in preview_data, "Preview missing skips info"

    # 2. POST /api/import/commit with confirmation data
    # Re-send the file for commit (commonly required)
    files_commit = {
        "file": ("import.xlsx", DUMMY_EXCEL_CONTENT, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    }

    resp_commit = session.post(
        f"{BASE_URL}/api/import/commit",
        files=files_commit,
        timeout=TIMEOUT
    )
    assert resp_commit.status_code in (200, 201), f"Commit failed: {resp_commit.text}"
    commit_data = resp_commit.json()

    # Validate commit response contains import batch info: counts and operator metadata
    assert "import_batch_id" in commit_data or "id" in commit_data, "Commit response missing import batch ID"
    assert "inserts" in commit_data or "inserts_count" in commit_data, "Commit missing inserts count"
    assert "updates" in commit_data or "updates_count" in commit_data, "Commit missing updates count"
    assert "skips" in commit_data or "skips_count" in commit_data, "Commit missing skips count"

    # 3. Idempotency check: Re-commit the same file again, expect no duplicate inserts
    resp_recommit = session.post(
        f"{BASE_URL}/api/import/commit",
        files=files_commit,
        timeout=TIMEOUT
    )
    assert resp_recommit.status_code in (200, 201), f"Re-commit failed: {resp_recommit.text}"
    recommit_data = resp_recommit.json()

    # Existing rows remain unchanged; mostly skips or no changes
    # Assert that inserts count is zero or skipped on recommit, indicating idempotency preserved
    inserts = recommit_data.get("inserts") or recommit_data.get("inserts_count")
    assert inserts == 0 or inserts == "0", f"Idempotency failed, inserts count on re-commit: {inserts}"

test_post_api_import_preview_and_commit()