import requests
from urllib.parse import urljoin

BASE_URL = "http://localhost:3000"
SUPABASE_AUTH_URL = "http://127.0.0.1:54321"
ADMIN_EMAIL = "admin@eventflow.test"
ADMIN_PASSWORD = "TestSprite!2026"
EVENT_CODE = "TSTEST"
TIMEOUT = 30

def test_get_event_dashboard_with_authorized_user():
    session = requests.Session()

    try:
        # Step 1: Get login page to obtain any initial cookies if set
        login_page_resp = session.get(urljoin(BASE_URL, "/login"), timeout=TIMEOUT)
        assert login_page_resp.status_code == 200

        # Step 2: Authenticate via Supabase GoTrue authentication (email/password)
        auth_payload = {"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}
        auth_response = session.post(
            urljoin(SUPABASE_AUTH_URL, "/auth/v1/token?grant_type=password"),
            json=auth_payload,
            timeout=TIMEOUT
        )
        assert auth_response.status_code == 200
        auth_data = auth_response.json()
        access_token = auth_data.get("access_token")
        refresh_token = auth_data.get("refresh_token")
        assert access_token is not None
        assert refresh_token is not None

        session.headers.update({"Authorization": f"Bearer {access_token}"})

        session.cookies.set("sb-access-token", access_token, domain="localhost")
        session.cookies.set("sb-refresh-token", refresh_token, domain="localhost")

        event_dashboard_url = urljoin(BASE_URL + "/", EVENT_CODE)
        resp = session.get(event_dashboard_url, timeout=TIMEOUT, allow_redirects=False)

        # Accept 200 OK or 307 redirect to /login as per PRD
        assert resp.status_code in (200, 307), f"Expected 200 OK or 307 Redirect, got {resp.status_code}"

        if resp.status_code == 200:
            content_type = resp.headers.get("Content-Type", "")
            assert "text/html" in content_type.lower()
            content = resp.text.lower()
            assert "dashboard" in content or "counters" in content or "event" in content
        else:
            # 307 redirect, check location header starts with /login (query params allowed)
            location = resp.headers.get("Location", "")
            assert location.startswith("/login"), f"Expected redirect to /login or /login with query params, got {location}"

    finally:
        session.close()

test_get_event_dashboard_with_authorized_user()
