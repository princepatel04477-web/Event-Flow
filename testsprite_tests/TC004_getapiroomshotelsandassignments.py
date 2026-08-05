import requests
import uuid

BASE_URL = "http://localhost:3000"
TIMEOUT = 30


def admin_login():
    session = requests.Session()
    login_url = f"{BASE_URL}/api/auth/login"
    credentials = {"email": "admin@test", "password": "admin_password"}
    headers = {"Content-Type": "application/json"}
    response = session.post(login_url, json=credentials, headers=headers, timeout=TIMEOUT)
    assert response.status_code == 200, f"Admin login failed: {response.text}"
    # No token extraction; use session cookies for auth
    return session


def get_available_hotels(session):
    url = f"{BASE_URL}/api/rooms/hotels"
    resp = session.get(url, timeout=TIMEOUT)
    assert resp.status_code == 200, f"Failed to get hotels: {resp.text}"
    try:
        hotels = resp.json()
    except Exception as e:
        assert False, f"Failed to decode hotels JSON: {resp.text}"
    assert isinstance(hotels, list), "Hotels response is not a list"
    assert len(hotels) > 0, "Hotels list is empty"
    return hotels


def get_available_rooms(session):
    url = f"{BASE_URL}/api/rooms/rooms"
    resp = session.get(url, timeout=TIMEOUT)
    assert resp.status_code == 200, f"Failed to get rooms: {resp.text}"
    try:
        rooms = resp.json()
    except Exception as e:
        assert False, f"Failed to decode rooms JSON: {resp.text}"
    assert isinstance(rooms, list), "Rooms response is not a list"
    assert len(rooms) > 0, "Rooms list is empty"
    return rooms


def create_room_assignment(session, assignment_data):
    url = f"{BASE_URL}/api/rooms/assignments"
    resp = session.post(url, json=assignment_data, timeout=TIMEOUT)
    return resp


def delete_room_assignment(session, assignment_id):
    url = f"{BASE_URL}/api/rooms/assignments/{assignment_id}"
    resp = session.delete(url, timeout=TIMEOUT)
    return resp


def test_getapiroomshotelsandassignments():
    session = admin_login()

    hotels = get_available_hotels(session)
    rooms = get_available_rooms(session)

    hotel = hotels[0]
    hotel_id = hotel.get("id")
    assert hotel_id, "Hotel has no id"

    room = None
    for r in rooms:
        if r.get("hotel_id") == hotel_id:
            room = r
            break
    assert room is not None, "No room found for the hotel"
    room_id = room.get("id")
    capacity = room.get("capacity")
    assert capacity is not None and capacity > 0, "Room capacity invalid"

    group_id = str(uuid.uuid4())
    pax = capacity
    date_start = "2026-09-01"
    date_end = "2026-09-05"

    assignment_data = {
        "group_id": group_id,
        "room_id": room_id,
        "pax": pax,
        "date_start": date_start,
        "date_end": date_end,
        "is_override": False,
        "override_reason": ""
    }

    assignment_id = None
    try:
        resp = create_room_assignment(session, assignment_data)
        assert resp.status_code == 201, f"Expected 201 Created for valid assignment, got {resp.status_code}: {resp.text}"
        assignment = resp.json()
        assignment_id = assignment.get("id")
        assert assignment_id, "Created assignment response missing id"

        over_capacity_data = assignment_data.copy()
        over_capacity_data["pax"] = capacity + 1
        resp2 = create_room_assignment(session, over_capacity_data)
        assert resp2.status_code == 400 or resp2.status_code == 409, (
            f"Expected 400 or 409 for over-capacity assignment, got {resp2.status_code}: {resp2.text}"
        )

        overlap_data = assignment_data.copy()
        overlap_data["group_id"] = str(uuid.uuid4())
        overlap_data["date_start"] = "2026-09-03"
        overlap_data["date_end"] = "2026-09-07"
        overlap_resp = create_room_assignment(session, overlap_data)
        assert overlap_resp.status_code == 400 or overlap_resp.status_code == 409, (
            f"Expected 400 or 409 for overlapping assignment, got {overlap_resp.status_code}: {overlap_resp.text}"
        )

        override_blank_reason = assignment_data.copy()
        override_blank_reason["pax"] = capacity + 1
        override_blank_reason["is_override"] = True
        override_blank_reason["override_reason"] = ""
        resp_override_blank = create_room_assignment(session, override_blank_reason)
        assert resp_override_blank.status_code == 400, (
            f"Expected 400 for override with blank reason, got {resp_override_blank.status_code}: {resp_override_blank.text}"
        )

        override_good = assignment_data.copy()
        override_good["pax"] = capacity + 1
        override_good["is_override"] = True
        override_good["override_reason"] = "Special VIP guest accommodation"
        resp_override_good = create_room_assignment(session, override_good)
        assert resp_override_good.status_code == 201, (
            f"Expected 201 for override with good reason, got {resp_override_good.status_code}: {resp_override_good.text}"
        )
        override_assignment = resp_override_good.json()
        override_assignment_id = override_assignment.get("id")
        assert override_assignment_id, "Override assignment response missing id"

    finally:
        if assignment_id:
            delete_room_assignment(session, assignment_id)
        if 'override_assignment_id' in locals() and override_assignment_id:
            delete_room_assignment(session, override_assignment_id)


test_getapiroomshotelsandassignments()
