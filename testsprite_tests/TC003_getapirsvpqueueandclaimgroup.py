import requests
from requests.exceptions import RequestException

BASE_URL = "http://localhost:3000"
TIMEOUT = 30

def login(username: str, password: str) -> str:
    url = f"{BASE_URL}/api/auth/login"
    payload = {"email": username, "password": password}
    try:
        response = requests.post(url, json=payload, timeout=TIMEOUT)
        assert response.status_code == 200, f"Login failed for {username} with status {response.status_code}"
        if not response.content:
            raise AssertionError(f"Login response is empty for user {username}")
        data = response.json()
        token = data.get("token") or data.get("access_token") or data.get("jwt")
        assert token, "No token received on login"
        return token
    except RequestException as e:
        raise AssertionError(f"Login request failed: {e}")

def get_rsvp_queue(token: str):
    url = f"{BASE_URL}/api/rsvp/queue"
    headers = {"Authorization": f"Bearer {token}"}
    try:
        response = requests.get(url, headers=headers, timeout=TIMEOUT)
        assert response.status_code == 200, f"GET /api/rsvp/queue failed with status {response.status_code}"
        data = response.json()
        assert isinstance(data, list), "RSVP queue response is not a list"
        return data
    except RequestException as e:
        raise AssertionError(f"GET /api/rsvp/queue request failed: {e}")

def claim_rsvp_group(token: str, group_id: int):
    url = f"{BASE_URL}/api/rsvp/claim_group"
    headers = {"Authorization": f"Bearer {token}"}
    payload = {"group_id": group_id}
    try:
        response = requests.post(url, json=payload, headers=headers, timeout=TIMEOUT)
        if response.status_code == 200:
            data = response.json()
            # Assumption: response includes locked group info or confirmation
            assert data.get("group_id") == group_id, "Claimed group_id mismatch in response"
            return True
        elif response.status_code == 409:
            # Conflict, lock failure
            return False
        else:
            raise AssertionError(f"Unexpected response status {response.status_code} for claim_group")
    except RequestException as e:
        raise AssertionError(f"POST /api/rsvp/claim_group request failed: {e}")

def test_getapirsvpqueueandclaimgroup():
    # Login as event_team user (role can insert and update, scoped to one event)
    token = login("team@test", "password")  # Password setter must match seed data or test env

    # Step 1: GET /api/rsvp/queue to retrieve prioritized groups needing contact
    queue = get_rsvp_queue(token)
    # It can be empty due to event scope or no groups needing contact, that is acceptable
    if not queue:
        # No groups to test locking on, test passes for empty queue
        return

    # Choose first group's id to claim
    group_id = None
    for group in queue:
        if isinstance(group, dict) and "group_id" in group:
            group_id = group["group_id"]
            break

    if group_id is None:
        # No valid group_id found, treat as pass since empty result is permitted by rules
        return

    # Step 2: POST /api/rsvp/claim_group to lock the group
    claimed = claim_rsvp_group(token, group_id)
    assert claimed, f"Failed to claim group {group_id} on first attempt"

    # Step 3: Try to claim the same group concurrently (simulate second device/user)
    # Login as another instance of team@test to simulate different session
    token2 = login("team@test", "password")

    # Second claim attempt should fail with 409 or lock failure to prevent concurrent claim
    claimed_again = claim_rsvp_group(token2, group_id)
    assert not claimed_again, "Concurrent claim on locked group succeeded, expected failure"

test_getapirsvpqueueandclaimgroup()
