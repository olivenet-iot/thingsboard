"""Input guardrails — topic restriction and prompt injection protection."""

from __future__ import annotations

import re
import unicodedata

# ---------------------------------------------------------------------------
# Topic restriction
# ---------------------------------------------------------------------------

# Case-insensitive keyword sets that indicate an on-topic message
_TOPIC_KEYWORDS: list[re.Pattern] = [
    # Lighting
    re.compile(
        r"\b(lights?|lamps?|dim|dims|dimm|bright|brightness|led|dali|d4i|"
        r"fixture|luminaire|controller|driver|dimming|dimLevel|luminous|lux|"
        r"schedule|timer|automation|sunrise|sunset|timetable|program)\b",
        re.IGNORECASE,
    ),
    # Energy
    re.compile(
        r"\b(energy|power|watts?|kwh|wh|consumption|saving|savings|cost|"
        r"bill|carbon|co2|emission|efficiency|tariff|rate)\b",
        re.IGNORECASE,
    ),
    # Status / devices
    re.compile(
        r"\b(device|devices|site|sites|online|offline|fault|faults|alarm|"
        r"alarms|alert|alerts|status|health|temperature|active|inactive|"
        r"location|gps|coordinate|timezone|latitude|longitude)\b",
        re.IGNORECASE,
    ),
    # SignConnect / LoRaWAN
    re.compile(
        r"\b(signconnect|lorawan|lora|sign|gateway|gateways|mqtt|downlink|"
        r"uplink|sensor|sensors)\b",
        re.IGNORECASE,
    ),
    # Greetings / meta / confirmation
    re.compile(
        r"\b(hello|hi|hey|help|what can you|how do|thank|thanks|sorry|"
        r"please|who are you|can you|"
        # Confirmation / response (EN)
        r"yes|no|ok|okay|sure|confirm|confirmed|go ahead|do it|proceed|"
        r"cancel|stop|correct|right|exactly|approve|deny|reject|"
        r"absolutely|definitely|nope|yep|yeah|nah|affirmative|negative|"
        # Confirmation / response (TR)
        r"evet|hayır|tamam|onayla|onaylıyorum|iptal|devam|dur|lütfen|"
        r"doğru|yanlış|kesinlikle|olur|olmaz|yap|yapma|gönder)\b",
        re.IGNORECASE,
    ),
    # Operations
    re.compile(
        r"\b(compare|summary|overview|report|trend|history|schedule|"
        r"dashboard|chart|graph|total|average|aggregate)\b",
        re.IGNORECASE,
    ),
]

REJECTION_RESPONSE = (
    "I can only help with SignConnect lighting and energy queries. "
    "Please ask about your devices, energy consumption, or lighting control."
)

REJECTION_SUGGESTIONS = [
    "Show site overview",
    "Any active alarms?",
    "Energy savings today?",
]


def is_on_topic(message: str) -> bool:
    """Return True if the message matches any lighting/energy topic keyword."""
    for pattern in _TOPIC_KEYWORDS:
        if pattern.search(message):
            return True
    return False


# ---------------------------------------------------------------------------
# Prompt injection protection
# ---------------------------------------------------------------------------

_INJECTION_PATTERNS: list[re.Pattern] = [
    re.compile(r"ignore\s+(all\s+)?(previous|prior|above)", re.IGNORECASE),
    re.compile(r"forget\s+(your|all|previous)", re.IGNORECASE),
    re.compile(r"override\s+(your|the|system)", re.IGNORECASE),
    re.compile(r"pretend\s+(you|to\s+be)", re.IGNORECASE),
    re.compile(r"jailbreak", re.IGNORECASE),
    re.compile(r"you\s+are\s+now", re.IGNORECASE),
    re.compile(r"new\s+instructions", re.IGNORECASE),
    re.compile(r"disregard\s+(your|the|previous|all)", re.IGNORECASE),
    re.compile(r"system\s*prompt", re.IGNORECASE),
    re.compile(r"<\s*(system|admin|root)", re.IGNORECASE),
    re.compile(r"\]\s*\[?\s*(INST|SYS)", re.IGNORECASE),
]

INJECTION_RESPONSE = (
    "I'm not able to process that request. "
    "Please ask about your lighting or energy data."
)

MAX_MESSAGE_LENGTH = 2000

LENGTH_RESPONSE = "Please keep your message shorter (under 2,000 characters)."


def sanitize_input(message: str) -> tuple[bool, str]:
    """Check for prompt injection patterns and sanitize input.

    Returns (is_safe, cleaned_message_or_rejection_reason).
    """
    # Length check
    if len(message) > MAX_MESSAGE_LENGTH:
        return False, LENGTH_RESPONSE

    # Strip zero-width and control characters (keep newlines/tabs)
    cleaned = "".join(
        ch for ch in message
        if ch in ("\n", "\t", "\r")
        or not unicodedata.category(ch).startswith("C")
    )
    # Collapse excessive whitespace
    cleaned = re.sub(r"[ \t]{10,}", " ", cleaned)
    cleaned = re.sub(r"\n{4,}", "\n\n\n", cleaned)

    # Check injection patterns
    for pattern in _INJECTION_PATTERNS:
        if pattern.search(cleaned):
            return False, INJECTION_RESPONSE

    return True, cleaned
