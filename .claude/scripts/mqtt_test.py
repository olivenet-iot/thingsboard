#!/usr/bin/env python3
"""
Manual MQTT test: subscribe + publish to TTN broker.

Credentials: source /opt/thingsboard/.claude/credentials.env before running.
"""
import os
import paho.mqtt.client as mqtt
import ssl, json, time, threading

BROKER = os.environ.get("TTN_MQTT_HOST", "YOUR_TTN_HOST")
USER = os.environ.get("TTN_MQTT_USER", "YOUR_TTN_USER")
PASS = os.environ.get("TTN_MQTT_PASS", "YOUR_TTN_PASS")
TTN_APP_ID = os.environ.get("TTN_APP_ID", "lumosoft-test")
PUB_TOPIC = f"v3/{TTN_APP_ID}/devices/zenopix-test/down/push"
SUB_TOPIC = f"v3/{TTN_APP_ID}/devices/zenopix-test/down/+"

received = []

def on_connect_sub(client, userdata, flags, rc, properties=None):
    print(f"[SUB] Connected rc={rc}")
    client.subscribe(SUB_TOPIC)
    print(f"[SUB] Subscribed to {SUB_TOPIC}")

def on_message(client, userdata, msg):
    print(f"[SUB] RECEIVED on {msg.topic}: {msg.payload.decode()}")
    received.append(msg)

def on_connect_pub(client, userdata, flags, rc, properties=None):
    print(f"[PUB] Connected rc={rc}")

# --- Subscriber (non-TLS, port 1883) ---
sub_client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="test-sub")
sub_client.username_pw_set(USER, PASS)
sub_client.on_connect = on_connect_sub
sub_client.on_message = on_message

print("[SUB] Connecting to port 1883 (non-TLS)...")
try:
    sub_client.connect(BROKER, 1883, 60)
except Exception as e:
    print(f"[SUB] Non-TLS failed: {e}, trying TLS on 8883...")
    sub_client.tls_set(ca_certs="/etc/ssl/certs/ca-certificates.crt")
    sub_client.connect(BROKER, 8883, 60)

sub_client.loop_start()
time.sleep(3)

# --- Publisher (TLS, port 8883) ---
pub_client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="test-pub")
pub_client.username_pw_set(USER, PASS)
pub_client.tls_set(ca_certs="/etc/ssl/certs/ca-certificates.crt")
pub_client.on_connect = on_connect_pub

print("[PUB] Connecting to port 8883 (TLS)...")
pub_client.connect(BROKER, 8883, 60)
pub_client.loop_start()
time.sleep(2)

# Publish test downlink (dim 50%)
payload = json.dumps({"downlinks": [{"f_port": 8, "frm_payload": "hAEy", "priority": "NORMAL"}]})
print(f"[PUB] Publishing to {PUB_TOPIC}: {payload}")
result = pub_client.publish(PUB_TOPIC, payload)
result.wait_for_publish()
print(f"[PUB] Published, rc={result.rc}")

# Wait for subscriber to receive
time.sleep(5)

pub_client.loop_stop()
pub_client.disconnect()
sub_client.loop_stop()
sub_client.disconnect()

print(f"\n=== RESULT: Received {len(received)} messages ===")
for m in received:
    print(f"  Topic: {m.topic}")
    print(f"  Payload: {m.payload.decode()}")
print("MQTT connectivity test PASSED" if received else "WARNING: No messages received on subscriber")
