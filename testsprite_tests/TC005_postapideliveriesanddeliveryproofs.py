import requests

BASE_URL = "http://localhost:3000"
TIMEOUT = 30

ADMIN_AUTH = {
    "email": "admin@test",
    "password": "adminpassword"  # Assuming password; replace with correct if known
}

def login(email, password):
    url = f"{BASE_URL}/api/auth/login"
    payload = {"email": email, "password": password}
    resp = requests.post(url, json=payload, timeout=TIMEOUT)
    assert resp.status_code == 200, f"Login failed for {email}: {resp.text}"
    json_data = resp.json()
    token = json_data.get("token") or json_data.get("access_token")
    assert token, f"No token received in response fields: {list(json_data.keys())}"
    return token

def test_post_api_deliveries_and_delivery_proofs():
    token = login(ADMIN_AUTH["email"], ADMIN_AUTH["password"])
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }

    created_delivery_id = None
    created_proof_id = None

    try:
        delivery_payload = {
            "event_id": 1,
            "recipient_name": "John Doe",
            "address": "123 Wedding Venue Rd",
            "delivered_by": "Courier Service A",
            "delivery_notes": "Left at front desk",
            "photo_capture": {
                "filename": "capture.jpg",
                "content_type": "image/jpeg",
                "data_base64": "iVBORw0KGgoAAAANSUhEUgAAAAUA"
            }
        }
        delivery_resp = requests.post(f"{BASE_URL}/api/deliveries", json=delivery_payload, headers=headers, timeout=TIMEOUT)
        assert delivery_resp.status_code == 201, f"Failed to create delivery: {delivery_resp.text}"
        delivery_data = delivery_resp.json()
        created_delivery_id = delivery_data.get("id")
        assert created_delivery_id is not None, "No delivery ID returned"

        proof_payload = {
            "delivery_id": created_delivery_id,
            "proof_image": {
                "filename": "proof.jpg",
                "content_type": "image/jpeg",
                "data_base64": "iVBORw0KGgoAAAANSUhEUgAAAAUA"
            }
        }
        proof_resp = requests.post(f"{BASE_URL}/api/delivery_proofs", json=proof_payload, headers=headers, timeout=TIMEOUT)
        assert proof_resp.status_code == 201, f"Failed to create delivery proof: {proof_resp.text}"
        proof_data = proof_resp.json()
        created_proof_id = proof_data.get("id")
        recorded_at = proof_data.get("recorded_at")
        assert created_proof_id is not None, "No delivery proof ID returned"
        assert recorded_at is not None, "No server-stamped timestamp recorded_at returned"

        patch_resp = requests.patch(f"{BASE_URL}/api/delivery_proofs/{created_proof_id}",
                                    json={"proof_image": {"filename": "new.jpg"}}, headers=headers, timeout=TIMEOUT)
        assert patch_resp.status_code in (403, 405), f"PATCH should be disallowed: {patch_resp.status_code}"

        delete_resp = requests.delete(f"{BASE_URL}/api/delivery_proofs/{created_proof_id}", headers=headers, timeout=TIMEOUT)
        assert delete_resp.status_code in (403, 405), f"DELETE should be disallowed: {delete_resp.status_code}"

    finally:
        if created_proof_id is not None:
            requests.delete(f"{BASE_URL}/api/delivery_proofs/{created_proof_id}", headers=headers, timeout=TIMEOUT)
        if created_delivery_id is not None:
            requests.delete(f"{BASE_URL}/api/deliveries/{created_delivery_id}", headers=headers, timeout=TIMEOUT)


test_post_api_deliveries_and_delivery_proofs()
