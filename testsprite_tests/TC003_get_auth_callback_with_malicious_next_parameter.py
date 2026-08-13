import requests

def test_get_auth_callback_with_malicious_next_parameter():
    base_url = "http://localhost:3000"
    valid_code = "valid_code"  # Assumed valid code scenario
    malicious_next = "https://evil.example.com"
    params = {
        "code": valid_code,
        "next": malicious_next
    }
    try:
        response = requests.get(
            f"{base_url}/auth/callback",
            params=params,
            allow_redirects=False,
            timeout=30
        )
    except requests.RequestException as e:
        assert False, f"Request to /auth/callback failed: {e}"

    # Assert the status code is 307 redirect
    assert response.status_code == 307, f"Expected 307 redirect, got {response.status_code}"

    # The Location header should be redirect to login with error parameter due to malicious next
    location = response.headers.get("Location", "")
    assert location == "http://localhost:3000/login?error=link", f"Expected redirect Location to 'http://localhost:3000/login?error=link', got '{location}'"


test_get_auth_callback_with_malicious_next_parameter()