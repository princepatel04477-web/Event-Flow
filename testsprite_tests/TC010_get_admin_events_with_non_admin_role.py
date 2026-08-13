import requests

BASE_URL = "http://localhost:3000"
SUPABASE_AUTH_URL = "http://127.0.0.1:54321"
EVENT_TEAM_EMAIL = "event_team@eventflow.test"
EVENT_TEAM_PASSWORD = "TestSprite!2026"  # assumed password same as admin for example
TIMEOUT = 30


def test_get_admin_events_with_non_admin_role():
    session = requests.Session()
    try:
        # Step 1: Authenticate as event_team user via Supabase GoTrue (email/password)
        # Supabase GoTrue sign-in requires application/x-www-form-urlencoded data
        auth_response = session.post(
            f"{SUPABASE_AUTH_URL}/auth/v1/token",
            data={
                "email": EVENT_TEAM_EMAIL,
                "password": EVENT_TEAM_PASSWORD,
                "grant_type": "password"
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=TIMEOUT,
        )
        assert auth_response.status_code == 200, f"Login failed with status {auth_response.status_code}"
        auth_data = auth_response.json()
        access_token = auth_data.get("access_token")
        assert access_token, "No access_token returned on login"

        # Set Authorization header with Bearer token to simulate authenticated session
        session.headers.update({"Authorization": f"Bearer {access_token}"})

        # Step 2: Access /admin/events endpoint with event_team session
        response = session.get(
            f"{BASE_URL}/admin/events",
            allow_redirects=False,
            timeout=TIMEOUT,
        )

        # Step 3: Verify response status is 307 redirect and Location header is "/"
        assert response.status_code == 307, f"Expected 307 redirect, got {response.status_code}"
        location = response.headers.get("Location")
        assert location == "/", f"Expected redirect location '/', got '{location}'"

    finally:
        session.close()


test_get_admin_events_with_non_admin_role()
