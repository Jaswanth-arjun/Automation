"""
Gmail integration module — Simplified with App Password (SMTP).
No complex OAuth setup needed. Just Gmail address + App Password.
"""

import smtplib
import imaplib
import email as email_lib
import os
import json
import base64
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, timezone

CREDENTIALS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "credentials")
CREDS_PATH = os.path.join(CREDENTIALS_DIR, "gmail_creds.json")


class GmailService:
    """Gmail service using SMTP (App Password) — simple setup."""

    def __init__(self):
        self.email_address = None
        self.app_password = None
        self._load_credentials()

    def _load_credentials(self):
        """Load saved credentials from file."""
        if os.path.exists(CREDS_PATH):
            try:
                with open(CREDS_PATH, "r") as f:
                    data = json.load(f)
                    self.email_address = data.get("email")
                    self.app_password = data.get("app_password")
            except Exception:
                pass

    def save_credentials(self, email_addr: str, app_password: str):
        """Save Gmail credentials."""
        os.makedirs(CREDENTIALS_DIR, exist_ok=True)
        with open(CREDS_PATH, "w") as f:
            json.dump({"email": email_addr, "app_password": app_password}, f)
        self.email_address = email_addr
        self.app_password = app_password

    def is_authenticated(self) -> bool:
        """Check if credentials are saved."""
        return bool(self.email_address and self.app_password)

    def get_user_email(self) -> str:
        """Get the configured email address."""
        return self.email_address

    def test_connection(self) -> dict:
        """Test if the credentials work by connecting to Gmail SMTP."""
        if not self.is_authenticated():
            return {"success": False, "error": "No credentials configured"}
        try:
            server = smtplib.SMTP("smtp.gmail.com", 587, timeout=10)
            server.ehlo()
            server.starttls()
            server.login(self.email_address, self.app_password)
            server.quit()
            return {"success": True, "message": "Connection successful!"}
        except smtplib.SMTPAuthenticationError:
            return {"success": False, "error": "Invalid email or app password. Make sure you're using an App Password, not your regular Gmail password."}
        except Exception as e:
            return {"success": False, "error": f"Connection failed: {str(e)}"}

    def send_email(self, to: str, subject: str, body: str, thread_id: str = None) -> dict:
        """Send an email via Gmail SMTP."""
        if not self.is_authenticated():
            return {"error": "Not authenticated. Configure Gmail in Settings."}

        try:
            message = MIMEMultipart("alternative")
            message["From"] = self.email_address
            message["To"] = to
            message["Subject"] = subject

            # Plain text
            text_part = MIMEText(body, "plain")
            message.attach(text_part)

            # HTML version
            html_body = body.replace("\n", "<br>")
            html_content = f"""
            <div style="font-family: 'Segoe UI', Arial, sans-serif; font-size: 14px; line-height: 1.7; color: #333;">
                {html_body}
            </div>"""
            html_part = MIMEText(html_content, "html")
            message.attach(html_part)

            # Add Message-ID for tracking
            import uuid
            msg_id = f"<{uuid.uuid4()}@hr-email-agent>"
            message["Message-ID"] = msg_id

            # If following up, add References header for threading
            if thread_id:
                message["References"] = thread_id
                message["In-Reply-To"] = thread_id

            # Send via SMTP
            server = smtplib.SMTP("smtp.gmail.com", 587, timeout=15)
            server.ehlo()
            server.starttls()
            server.login(self.email_address, self.app_password)
            server.sendmail(self.email_address, to, message.as_string())
            server.quit()

            return {
                "message_id": msg_id,
                "thread_id": msg_id,  # Use message_id as thread_id for first email
            }

        except smtplib.SMTPAuthenticationError:
            return {"error": "Gmail authentication failed. Check your App Password in Settings."}
        except smtplib.SMTPRecipientsRefused:
            return {"error": f"Recipient rejected: {to}"}
        except Exception as e:
            return {"error": f"Failed to send: {str(e)}"}

    def check_replies(self, thread_id: str) -> list:
        """
        Check for replies using IMAP.
        Searches for emails that reference our thread_id.
        """
        if not self.is_authenticated():
            return []

        try:
            mail = imaplib.IMAP4_SSL("imap.gmail.com", timeout=10)
            mail.login(self.email_address, self.app_password)
            mail.select("INBOX")

            # Search for replies referencing our message
            # Use a simplified search by looking at recent emails from the recipient
            _, messages = mail.search(None, "ALL")
            
            if not messages[0]:
                mail.logout()
                return []

            replies = []
            msg_nums = messages[0].split()
            
            # Check last 50 messages for efficiency
            recent = msg_nums[-50:] if len(msg_nums) > 50 else msg_nums

            for num in recent:
                _, data = mail.fetch(num, "(RFC822)")
                if not data or not data[0]:
                    continue
                
                raw = data[0][1]
                msg = email_lib.message_from_bytes(raw)
                
                references = msg.get("References", "") + " " + msg.get("In-Reply-To", "")
                if thread_id and thread_id in references:
                    replies.append({
                        "message_id": msg.get("Message-ID", ""),
                        "thread_id": thread_id,
                        "from": msg.get("From", ""),
                        "subject": msg.get("Subject", ""),
                        "date": msg.get("Date", ""),
                        "snippet": self._get_snippet(msg),
                    })

            mail.logout()
            return replies

        except Exception as e:
            print(f"IMAP error: {e}")
            return []

    def _get_snippet(self, msg) -> str:
        """Extract a text snippet from an email message."""
        if msg.is_multipart():
            for part in msg.walk():
                if part.get_content_type() == "text/plain":
                    try:
                        return part.get_payload(decode=True).decode("utf-8", errors="ignore")[:200]
                    except Exception:
                        pass
        else:
            try:
                return msg.get_payload(decode=True).decode("utf-8", errors="ignore")[:200]
            except Exception:
                pass
        return ""

    def disconnect(self):
        """Remove saved credentials."""
        if os.path.exists(CREDS_PATH):
            os.remove(CREDS_PATH)
        self.email_address = None
        self.app_password = None


# Global instance
gmail_service = GmailService()
