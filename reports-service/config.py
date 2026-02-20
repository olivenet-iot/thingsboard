import os
from dotenv import load_dotenv

load_dotenv()

# ThingsBoard connection
TB_URL = os.getenv("TB_URL", "http://localhost:8080")
TB_USERNAME = os.getenv("TB_USERNAME", "tenant@thingsboard.org")
TB_PASSWORD = os.getenv("TB_PASSWORD", "tenant")

# SMTP settings
SMTP_HOST = os.getenv("SMTP_HOST", "smtp.example.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USERNAME = os.getenv("SMTP_USERNAME", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM = os.getenv("SMTP_FROM", "")

# Service settings
SERVICE_PORT = int(os.getenv("SERVICE_PORT", "5000"))
PDF_STORAGE_PATH = os.getenv("PDF_STORAGE_PATH", "./data")
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
