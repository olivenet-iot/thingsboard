#!/usr/bin/env python3
"""
End-to-end test: RPC -> Rule Chain -> MQTT -> TTN, verify payloads and dimLevel attribute.

Credentials: source /opt/thingsboard/.claude/credentials.env before running.
"""
import os
import paho.mqtt.client as mqtt
import requests, json, time, ssl, threading, base64

BASE = os.environ.get("TB_URL", "http://localhost:8080")
DEVICE_ID = os.environ.get("ZENOPIX_DEVICE_ID", "YOUR_DEVICE_ID")
BROKER = os.environ.get("TTN_MQTT_HOST", "YOUR_TTN_HOST")
MQTT_USER = os.environ.get("TTN_MQTT_USER", "YOUR_TTN_USER")
MQTT_PASS = os.environ.get("TTN_MQTT_PASS", "YOUR_TTN_PASS")
TTN_APP_ID = os.environ.get("TTN_APP_ID", "lumosoft-test")
SUB_TOPIC = f"v3/{TTN_APP_ID}/devices/zenopix-test/down/+"

# Login
TB_USERNAME = os.environ.get("TB_USERNAME", "YOUR_TB_USERNAME")
TB_PASSWORD = os.environ.get("TB_PASSWORD", "YOUR_TB_PASSWORD")
r = requests.post(f"{BASE}/api/auth/login", json={"username": TB_USERNAME, "password": TB_PASSWORD})
r.raise_for_status()
TOKEN = r.json()["token"]
headers = {"X-Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}
print("TB Login OK\n")

# Setup MQTT subscriber
received_messages = []
sub_ready = threading.Event()

def on_connect(client, userdata, flags, rc, properties=None):
    client.subscribe(SUB_TOPIC)
    sub_ready.set()

def on_message(client, userdata, msg):
    received_messages.append({"topic": msg.topic, "payload": json.loads(msg.payload.decode())})

sub = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="e2e-test-sub")
sub.username_pw_set(MQTT_USER, MQTT_PASS)
sub.on_connect = on_connect
sub.on_message = on_message
sub.connect(BROKER, 1883, 60)
sub.loop_start()
sub_ready.wait(timeout=5)
print("MQTT subscriber ready\n")

# Test cases
tests = [
    {"label": "Dim 0%",   "params": 0,     "expected_b64": "hAEA", "expected_dim": 0},
    {"label": "Dim 50%",  "params": 50,    "expected_b64": "hAEy", "expected_dim": 50},
    {"label": "Dim 100%", "params": 100,   "expected_b64": "hAFk", "expected_dim": 100},
    {"label": "ON (str)",  "params": "on",  "expected_b64": "hAFk", "expected_dim": 100},
    {"label": "OFF (str)", "params": "off", "expected_b64": "hAEA", "expected_dim": 0},
]

results = []
for test in tests:
    received_messages.clear()
    print(f"--- Test: {test['label']} (params={test['params']}) ---")

    # Send one-way RPC
    rpc_body = {"method": "setDim", "params": test["params"]}
    r = requests.post(f"{BASE}/api/plugins/rpc/oneway/{DEVICE_ID}", headers=headers, json=rpc_body)
    rpc_ok = r.status_code == 200
    print(f"  RPC: {r.status_code} {'OK' if rpc_ok else r.text[:200]}")

    # Wait for MQTT messages
    time.sleep(5)

    # Check MQTT received
    queued_msgs = [m for m in received_messages if "queued" in m["topic"]]
    mqtt_ok = False
    actual_b64 = None
    if queued_msgs:
        dq = queued_msgs[0]["payload"].get("downlink_queued", {})
        actual_b64 = dq.get("frm_payload")
        mqtt_ok = actual_b64 == test["expected_b64"]
        print(f"  MQTT: frm_payload={actual_b64} {'MATCH' if mqtt_ok else 'MISMATCH (expected ' + test['expected_b64'] + ')'}")

        if actual_b64:
            decoded = base64.b64decode(actual_b64)
            hex_str = decoded.hex()
            print(f"  Decoded: {hex_str} ({' '.join(f'{b:02x}' for b in decoded)})")
    else:
        print(f"  MQTT: NO queued message received!")

    # Check dimLevel server attribute
    attr_r = requests.get(
        f"{BASE}/api/plugins/telemetry/DEVICE/{DEVICE_ID}/values/attributes/SERVER_SCOPE",
        headers=headers, params={"keys": "dimLevel"}
    )
    dim_attr = None
    if attr_r.status_code == 200:
        attrs = attr_r.json()
        for a in attrs:
            if a["key"] == "dimLevel":
                dim_attr = a["value"]
    attr_ok = dim_attr == test["expected_dim"]
    print(f"  Attribute dimLevel={dim_attr} {'MATCH' if attr_ok else 'MISMATCH (expected ' + str(test['expected_dim']) + ')'}")

    passed = rpc_ok and mqtt_ok and attr_ok
    results.append({"test": test["label"], "rpc": rpc_ok, "mqtt": mqtt_ok, "attr": attr_ok, "passed": passed})
    print(f"  Result: {'PASS' if passed else 'FAIL'}\n")

# Cleanup
sub.loop_stop()
sub.disconnect()

# Summary
print("=" * 60)
print("END-TO-END TEST SUMMARY")
print("=" * 60)
all_pass = True
for r in results:
    status = "PASS" if r["passed"] else "FAIL"
    details = f"RPC={'OK' if r['rpc'] else 'FAIL'} MQTT={'OK' if r['mqtt'] else 'FAIL'} ATTR={'OK' if r['attr'] else 'FAIL'}"
    print(f"  [{status}] {r['test']:12s} | {details}")
    if not r["passed"]:
        all_pass = False

print("=" * 60)
if all_pass:
    print("ALL TESTS PASSED!")
else:
    print("SOME TESTS FAILED - check details above")
