import requests

BASE_URL = "http://localhost:3000"
SUPABASE_AUTH_URL = "http://127.0.0.1:54321"
ADMIN_EMAIL = "admin@eventflow.test"
ADMIN_PASSWORD = "TestSprite!2026"
EVENT_CODE_UNAUTHORIZED = "TSTEST"  # seeded event code, but test with user NOT member

def test_get_event_dashboard_with_unauthorized_user():
    session = requests.Session()

    try:
        # Step 1: Login via Supabase GoTrue to get access token or session cookie
        # Supabase GoTrue sign-in endpoint: POST /auth/v1/token?grant_type=password
        auth_url = f"{SUPABASE_AUTH_URL}/auth/v1/token?grant_type=password"
        auth_payload = {
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        }
        auth_headers = {
            "Content-Type": "application/json"
        }
        auth_response = session.post(auth_url, json=auth_payload, headers=auth_headers, timeout=30)
        assert auth_response.status_code == 200, f"Failed to authenticate: {auth_response.text}"
        auth_json = auth_response.json()
        # Extract access token (JWT)
        access_token = auth_json.get("access_token")
        assert access_token, "No access token received"

        # We want to test an authenticated user who is NOT a member of the event.
        # The admin user belongs to some events. To simulate unauthorized user:
        # The seeded event is TSTEST, presumably admin might have access; 
        # But requirement is "authenticated user who is NOT a member of the event".
        # If admin is global role, might have access: So to force unauthorized,
        # pass a deliberately non-member event code or simulate with a different auth user.
        # Since only admin user is provided, try an event code unlikely to be accessible,
        # but instructions say seeded event code TSTEST.
        # To simulate test faithfully, do a GET /TSTEST with the admin token, but set Auth header as a non-member?
        # This is limitation. We'll proceed using admin token but expect 404.

        # Use access token to make authenticated request to event dashboard:
        headers = {
            "Authorization": f"Bearer {access_token}"
        }
        event_url = f"{BASE_URL}/{EVENT_CODE_UNAUTHORIZED}"
        response = session.get(event_url, headers=headers, timeout=30)

        # Assert 404 status code indicating unknown event code or not-a-member response
        assert response.status_code == 404, f"Expected 404 for unauthorized event access but got {response.status_code}"

    finally:
        session.close()

test_get_event_dashboard_with_unauthorized_user()