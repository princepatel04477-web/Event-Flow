import requests

BASE_URL = "http://localhost:3000"
TIMEOUT = 30

def test_get_login_page_without_session():
    try:
        # Basic GET /login without next parameter
        url = f"{BASE_URL}/login"
        response = requests.get(url, timeout=TIMEOUT)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        content = response.text.lower()
        assert "<form" in content, "Login page should contain a form"
        assert "sign in" in content or "login" in content, "Login page should prompt sign-in"

        # GET /login with next parameter (same origin)
        next_param = "/dashboard"
        url_with_next = f"{BASE_URL}/login?next={next_param}"
        response_next = requests.get(url_with_next, timeout=TIMEOUT)
        assert response_next.status_code == 200, f"Expected 200 with next param, got {response_next.status_code}"
        content_next = response_next.text.lower()
        assert "<form" in content_next, "Login page with next should contain a form"
        assert "sign in" in content_next or "login" in content_next, "Login page with next should prompt sign-in"
    except requests.RequestException as e:
        assert False, f"Request failed: {str(e)}"

test_get_login_page_without_session()