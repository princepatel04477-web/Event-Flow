import requests


def test_get_root_without_session():
    base_url = "http://localhost:3000"
    url = f"{base_url}/"

    session = requests.Session()
    try:
        # Do not send any authentication cookies or tokens (unauthenticated)
        response = session.get(url, allow_redirects=False, timeout=30)

        # Validate response status code is 307 redirect
        assert response.status_code == 307, f"Expected 307 redirect but got {response.status_code}"

        # Validate 'Location' header points to /login or /login with next parameter
        location = response.headers.get("Location")
        assert location is not None, "Missing Location header in redirect response"
        assert location.startswith("/login"), f"Expected redirect location starting with /login but got {location}"

    except requests.RequestException as e:
        assert False, f"Request failed: {e}"


test_get_root_without_session()