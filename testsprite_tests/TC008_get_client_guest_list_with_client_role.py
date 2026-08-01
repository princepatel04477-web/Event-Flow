import requests


def test_get_client_guest_list_with_client_role():
    base_url = "http://localhost:3000"
    event_code = "TSTEST"

    admin_email = "admin@eventflow.test"
    admin_password = "TestSprite!2026"

    session = requests.Session()
    session.timeout = 30

    try:
        # Step 1: Access GET /login to get CSRF token if any (simulated here by getting the page)
        login_get = session.get(f"{base_url}/login", timeout=30)
        assert login_get.status_code == 200, "/login page not reachable"

        # Step 2: POST credentials to /login to establish session cookie
        # According to PRD, login is email/password email/password sign-in via Supabase GoTrue,
        # but the app's login page accepts credentials and sets a cookie
        login_payload = {
            "email": admin_email,
            "password": admin_password
        }

        # The exact form fields are not specified; assuming JSON POST with fields 'email' and 'password'
        login_post = session.post(f"{base_url}/login", json=login_payload, allow_redirects=True, timeout=30)
        # Allow redirects because login flow redirects on success

        # Accept either 200 or redirect response after login
        assert login_post.status_code in (200, 302, 303), f"Login POST expected 200 or redirect but got {login_post.status_code}"

        # Step 3: Now session should have cookie established, do GET to /{eventCode}/guests
        resp = session.get(f"{base_url}/{event_code}/guests", timeout=30, allow_redirects=False)
        # Should now get 200 with guest list
        assert resp.status_code == 200, f"Expected 200 OK but got {resp.status_code} (possible redirect to login)"

        # Assert content-type HTML
        content_type = resp.headers.get("Content-Type", "")
        assert "text/html" in content_type.lower(), f"Expected text/html content-type, got {content_type}"

        # Minimal check for guest list content
        assert "guest" in resp.text.lower(), "Response HTML does not appear to contain guest list content"

    finally:
        session.close()


test_get_client_guest_list_with_client_role()