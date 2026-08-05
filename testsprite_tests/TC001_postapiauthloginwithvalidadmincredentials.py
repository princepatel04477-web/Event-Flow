import requests

BASE_URL = "http://localhost:3000"
LOGIN_ENDPOINT = "/api/auth/login"
PROFILE_ENDPOINT = "/api/auth/profile"

def test_postapiauthloginwithvalidadmincredentials():
    session = requests.Session()
    try:
        # 1. POST /api/auth/login with valid admin credentials
        login_payload = {
            "email": "admin@test",
            "password": "admin"  # Assuming "admin" is the valid password for seed data
        }
        login_headers = {
            "Content-Type": "application/json"
        }

        login_response = session.post(
            BASE_URL + LOGIN_ENDPOINT,
            json=login_payload,
            headers=login_headers,
            timeout=30
        )
        assert login_response.status_code == 200, \
            f"Expected 200 on login, got {login_response.status_code}"

        # Check content-type header before parsing JSON
        content_type = login_response.headers.get("Content-Type", "")
        if "application/json" in content_type:
            json_resp = login_response.json()
            has_jwt = any(
                key in json_resp and isinstance(json_resp[key], str) and len(json_resp[key]) > 0
                for key in ["token", "jwt"]
            )
        else:
            json_resp = None
            has_jwt = False

        has_cookie = any(
            k.lower() == "set-cookie" for k in login_response.headers.keys()
        )
        assert has_jwt or has_cookie, "No JWT token or session cookie returned on login"

        # 2. Use the authenticated session to GET the user profile or routing context
        profile_response = session.get(
            BASE_URL + PROFILE_ENDPOINT,
            timeout=30
        )
        assert profile_response.status_code == 200, \
            f"Expected 200 on profile fetch, got {profile_response.status_code}"

        profile_json = profile_response.json()
        # Validate that the profile contains admin routing context and full access
        assert isinstance(profile_json, dict), "Profile response is not a JSON object"

        role = profile_json.get("role")
        assert role == "admin", f"Expected role 'admin', got '{role}'"

        perms = profile_json.get("permissions") or profile_json.get("access") or profile_json.get("routing_context")
        assert perms is not None, "Profile missing access/permissions/routing context for admin"

    finally:
        session.close()

test_postapiauthloginwithvalidadmincredentials()
