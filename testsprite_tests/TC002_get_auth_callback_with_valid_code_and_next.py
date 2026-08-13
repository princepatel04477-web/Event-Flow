import requests
from urllib.parse import urljoin, urlparse

BASE_URL = "http://localhost:3000"
TIMEOUT = 30

def test_get_auth_callback_with_valid_code_and_next():
    # This test verifies that a GET request to /auth/callback with a valid code and a same-origin next parameter
    # sets a session cookie and responds with a 307 redirect to the next URL or to / if invalid.
    session = requests.Session()
    try:
        valid_code = "valid_code"  # Placeholder: should be obtained by pre-auth or mocking
        next_path = "/dashboard"
        callback_url = f"/auth/callback?code={valid_code}&next={next_path}"
        full_url = urljoin(BASE_URL, callback_url)
        response = session.get(full_url, allow_redirects=False, timeout=TIMEOUT)
        assert response.status_code == 307, f"Expected status 307, got {response.status_code}"
        location = response.headers.get("Location", "")
        parsed_location = urlparse(location)
        # Accept redirect to next_path or root / as sanitized fallback
        assert (parsed_location.path == next_path) or (parsed_location.path == "/"), \
            f"Expected redirect to {next_path} or /, got {location}"
        set_cookie = response.headers.get("Set-Cookie", "")
        assert set_cookie, "No Set-Cookie header found for session"
        # Attempt to follow next_url only if redirect was to next_path
        if parsed_location.path == next_path:
            next_url = urljoin(BASE_URL, next_path)
            follow_response = session.get(next_url, timeout=TIMEOUT)
            assert follow_response.status_code in (200, 307), f"Expected status 200 or 307 when accessing {next_path}, got {follow_response.status_code}"
    finally:
        session.close()

test_get_auth_callback_with_valid_code_and_next()
