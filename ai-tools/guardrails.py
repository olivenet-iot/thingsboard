"""Input guardrails — topic restriction and prompt injection protection."""

from __future__ import annotations

import re
import unicodedata
from enum import Enum


# ---------------------------------------------------------------------------
# Message tier classification (for smart tool routing)
# ---------------------------------------------------------------------------

class MessageTier(str, Enum):
    OFF_TOPIC = "off_topic"
    GREETING = "greeting"      # Tier 0 — no tools
    DATA_QUERY = "data_query"  # Tier 1 — read-only tools (7)
    COMMAND = "command"         # Tier 2 — all tools (12)


# Positive confirmation words
_POSITIVE_CONFIRMATION = re.compile(
    r"\b(yes|ok|okay|sure|confirm|confirmed|go\s+ahead|do\s+it|proceed|"
    r"approve|yep|yeah|absolutely|definitely|affirmative|correct|exactly|right|"
    r"evet|tamam|onayla|onaylıyorum|olur|yap|gönder|kesinlikle|doğru|devam)\b",
    re.IGNORECASE,
)

# Command action verbs (EN + TR)
_COMMAND_KEYWORDS = re.compile(
    r"\b(dim|dims|dimm|bright|brightness|"
    r"set\s+(?:to|the|dim|level|brightness|location|timezone|coordinates?)|"
    r"change|turn\s+(?:on|off)|switch|schedule|timer|automat|"
    r"control|configure|adjust|deploy|delete|remove|update|"
    r"send|execute|apply|activate|deactivate|"
    # Turkish command verbs
    r"kıs|kapat|aç|ayarla|değiştir|sil|kaldır|kurulum)\b",
    re.IGNORECASE,
)

# Data keywords — topic patterns MINUS greetings/confirmation
_DATA_KEYWORDS = re.compile(
    r"\b(lights?|lamps?|led|dali|d4i|fixture|luminaire|controller|"
    r"driver|dimming|luminous|lux|sunrise|sunset|timetable|program|"
    r"energy|power|watts?|kwh|wh|consumption|saving|savings|cost|bill|"
    r"carbon|co2|emission|efficiency|tariff|rate|"
    r"device|devices|site|sites|online|offline|fault|faults|alarm|alarms|"
    r"alert|alerts|status|health|temperature|active|inactive|"
    r"location|gps|coordinate|timezone|latitude|longitude|"
    r"signconnect|lorawan|lora|gateway|gateways|mqtt|downlink|uplink|sensor|sensors|"
    r"compare|summary|overview|report|trend|history|dashboard|chart|graph|"
    r"total|average|aggregate)\b",
    re.IGNORECASE,
)


def classify_message(
    message: str,
    has_pending_confirmation: bool = False,
) -> MessageTier:
    """Classify message to determine which tool tier to use.

    Priority: COMMAND > DATA_QUERY > GREETING.
    Called AFTER is_on_topic() has already rejected off-topic messages.
    """
    text = message.strip()

    # Short positive confirmation with pending command → need all tools
    if has_pending_confirmation and len(text) < 60:
        if _POSITIVE_CONFIRMATION.search(text):
            return MessageTier.COMMAND

    # Command action verbs → all tools
    if _COMMAND_KEYWORDS.search(text):
        return MessageTier.COMMAND

    # Data/topic keywords → read-only tools
    if _DATA_KEYWORDS.search(text):
        return MessageTier.DATA_QUERY

    # Pure greeting, confirmation without pending, meta → no tools
    return MessageTier.GREETING

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
