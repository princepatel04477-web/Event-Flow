import requests

BASE_URL = "http://localhost:3000"
TIMEOUT = 30

# Users credentials for login
USERS = {
    "admin": {"email": "admin@test.com", "password": "adminpass"},
    "team": {"email": "team@test.com", "password": "teampass"},
    "client": {"email": "client@test.com", "password": "clientpass"},
}

# Endpoint paths
LOGIN_ENDPOINT = f"{BASE_URL}/api/auth/login"
EVENT_RECORDS_ENDPOINT = f"{BASE_URL}/api/event_records"  # assumed example endpoint for event scoped records


def login(user_key):
    creds = USERS[user_key]
    resp = requests.post(
        LOGIN_ENDPOINT,
        json={"email": creds["email"], "password": creds["password"]},
        timeout=TIMEOUT,
    )
    # Check response status explicitly
    assert resp.status_code == 200, f"Login failed for {user_key} with status {resp.status_code}, response text: {resp.text}"
    content_type = resp.headers.get('Content-Type', '')
    assert 'application/json' in content_type.lower(), f"Login response Content-Type not JSON for {user_key}: {content_type}"
    assert resp.text.strip(), f"Login response empty for {user_key}"
    try:
        json_resp = resp.json()
    except Exception as e:
        assert False, f"Login response is not valid JSON: {e}, response text: {resp.text}"
    token = json_resp.get("token")
    assert token, f"Login for {user_key} should return a token"
    return token


def get_event_records(auth_token):
    headers = {"Authorization": f"Bearer {auth_token}"}
    resp = requests.get(EVENT_RECORDS_ENDPOINT, headers=headers, timeout=TIMEOUT)
    resp.raise_for_status()
    return resp.json()


def post_event_record(auth_token, event_id, record_payload):
    headers = {"Authorization": f"Bearer {auth_token}"}
    data = {"event_id": event_id}
    data.update(record_payload)
    resp = requests.post(EVENT_RECORDS_ENDPOINT, headers=headers, json=data, timeout=TIMEOUT)
    return resp


def test_geteventscopedrecordswithvalideventcontext():
    # Step 1: Login as admin to get all event records (admin sees all events)
    admin_token = login("admin")
    admin_records = get_event_records(admin_token)
    assert isinstance(admin_records, list)
    assert len(admin_records) > 0, "Admin must see records for multiple events"

    # Determine event IDs admin can see
    event_ids = set(record.get("event_id") for record in admin_records if record.get("event_id"))
    assert event_ids, "Admin should see at least one event_id"

    # We'll pick one event_id to use for testing team and client users
    test_event_id = next(iter(event_ids))

    # Step 2: Login as team user and verify only one event's records are returned
    team_token = login("team")
    team_records = get_event_records(team_token)
    assert isinstance(team_records, list)
    # Team sees records only for one event, and must not see other events' data
    team_event_ids = set(record.get("event_id") for record in team_records if record.get("event_id"))
    assert len(team_event_ids) <= 1
    if team_event_ids:
        # The team user's event_id must match their scoped event only
        # Since we do not know their event_id for sure, check that all records have same event_id
        assert all(eid == next(iter(team_event_ids)) for eid in team_event_ids)

    # Step 3: Login as client user, verify read-only and isolation (empty if no event record or only scoped)
    client_token = login("client")
    client_records = get_event_records(client_token)
    assert isinstance(client_records, list)
    # Client can only read, and must only see zero or records for exactly one event
    client_event_ids = set(record.get("event_id") for record in client_records if record.get("event_id"))
    assert len(client_event_ids) <= 1

    # Step 4: Team user tries to POST new record with matching event_id - expect success
    new_record_data = {
        "name": "Sample Record from Team User",
        "details": "Test details",
    }
    post_resp = post_event_record(team_token, test_event_id, new_record_data)
    assert post_resp.status_code == 201, f"Team user should successfully create record with status 201, got {post_resp.status_code}"
    created_record = post_resp.json()
    assert created_record.get("event_id") == test_event_id
    assert created_record.get("name") == new_record_data["name"]

    created_record_id = created_record.get("id")

    # Step 5: Team user tries to POST a record with a different event_id - expect rejection (400 or 403 or constraint failure)
    # Use an event_id that is different from their own (pick from admin's known event_ids)
    other_event_id = None
    for eid in event_ids:
        if eid != test_event_id:
            other_event_id = eid
            break
    if other_event_id is not None:
        invalid_post_resp = post_event_record(team_token, other_event_id, new_record_data)
        # Check that insertion is denied by status code; can be 400, 403, or 409 or similar constraint failure
        assert invalid_post_resp.status_code in {400, 403, 409}, f"Cross-event POST rejected, got {invalid_post_resp.status_code}"
        # No new record id expected
        assert invalid_post_resp.text != created_record_id

    # Clean up: delete the created record as admin (only admin can delete)
    if created_record_id:
        admin_headers = {"Authorization": f"Bearer {admin_token}"}
        delete_url = f"{EVENT_RECORDS_ENDPOINT}/{created_record_id}"
        del_resp = requests.delete(delete_url, headers=admin_headers, timeout=TIMEOUT)
        assert del_resp.status_code in {200, 204}, f"Admin should be able to delete record, got {del_resp.status_code}"


test_geteventscopedrecordswithvalideventcontext()