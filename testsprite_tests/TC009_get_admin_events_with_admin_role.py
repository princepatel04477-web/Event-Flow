import requests

def test_get_admin_events_with_admin_role():
    base_url = "http://localhost:3000"
    supabase_auth_url = "http://127.0.0.1:54321"
    login_email = "admin@eventflow.test"
    login_password = "TestSprite!2026"
    session = requests.Session()
    timeout = 30

    try:
        # Step 1: Get login page to establish initial cookies if needed
        login_page_resp = session.get(f"{base_url}/login", timeout=timeout)
        assert login_page_resp.status_code == 200
        assert "text/html" in login_page_resp.headers.get("Content-Type", "")

        # Step 2: Authenticate via Supabase GoTrue REST API to get access_token and refresh_token
        auth_payload = {
            "email": login_email,
            "password": login_password
        }
        auth_resp = requests.post(f"{supabase_auth_url}/auth/v1/token?grant_type=password",
                                  json=auth_payload, timeout=timeout)
        assert auth_resp.status_code == 200
        auth_data = auth_resp.json()
        access_token = auth_data.get("access_token")
        refresh_token = auth_data.get("refresh_token")
        assert access_token and refresh_token

        # Step 3: Set the correct cookie to simulate authenticated Next.js session
        # Use '_supabase_auth_token' cookie containing access_token
        session.cookies.set("_supabase_auth_token", access_token, path="/")

        # Step 4: Access /admin/events with the authenticated session
        admin_events_resp = session.get(f"{base_url}/admin/events", timeout=timeout, allow_redirects=False)
        assert admin_events_resp.status_code == 200
        content_type = admin_events_resp.headers.get("Content-Type", "")
        assert "text/html" in content_type.lower()
        body = admin_events_resp.text
        # Basic content checks for event list and create-event form presence
        assert ("Create Event" in body or "create-event" in body or "<form" in body)
        assert ("Event List" in body or "event-list" in body or "<ul" in body or "<table" in body)

    finally:
        pass

test_get_admin_events_with_admin_role()
