"""
Persistent SQLite database for contact management, email history, and follow-ups.
Uses aiosqlite for async operations with FastAPI.
"""

import aiosqlite
import os
from datetime import datetime, timezone

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "hr_email.db")


async def get_db():
    """Get database connection."""
    db = await aiosqlite.connect(DB_PATH)
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA journal_mode=WAL")
    await db.execute("PRAGMA foreign_keys=ON")
    return db


async def init_db():
    """Initialize database schema."""
    db = await get_db()
    try:
        await db.executescript("""
            CREATE TABLE IF NOT EXISTS contacts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT,
                email TEXT NOT NULL UNIQUE,
                title TEXT,
                company TEXT,
                status TEXT NOT NULL DEFAULT 'NOT_CONTACTED',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS email_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                contact_id INTEGER NOT NULL,
                gmail_message_id TEXT,
                gmail_thread_id TEXT,
                email_type TEXT NOT NULL DEFAULT 'INITIAL',
                subject TEXT,
                body TEXT,
                sent_at TEXT NOT NULL DEFAULT (datetime('now')),
                reply_received INTEGER NOT NULL DEFAULT 0,
                reply_at TEXT,
                reply_snippet TEXT,
                error TEXT,
                FOREIGN KEY (contact_id) REFERENCES contacts(id)
            );

            CREATE TABLE IF NOT EXISTS followups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                contact_id INTEGER NOT NULL,
                followup_number INTEGER NOT NULL DEFAULT 1,
                eligible_at TEXT NOT NULL,
                sent_at TEXT,
                status TEXT NOT NULL DEFAULT 'PENDING',
                FOREIGN KEY (contact_id) REFERENCES contacts(id)
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS daily_send_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                count INTEGER NOT NULL DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);
            CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts(status);
            CREATE INDEX IF NOT EXISTS idx_email_history_contact ON email_history(contact_id);
            CREATE INDEX IF NOT EXISTS idx_followups_contact ON followups(contact_id);
            CREATE INDEX IF NOT EXISTS idx_daily_send_log_date ON daily_send_log(date);
        """)

        # Insert default settings
        defaults = {
            "daily_limit": "20",
            "cooldown_days": "30",
            "max_followups": "2",
            "send_delay_seconds": "15",
            "linkedin_url": "https://linkedin.com/in/jaswanth",
            "github_url": "https://github.com/jaswanth",
            "candidate_name": "Jaswanth",
            "candidate_college": "NBKRIST",
            "candidate_degree": "B.Tech CSE",
            "candidate_grad_year": "2027",
        }
        for key, value in defaults.items():
            await db.execute(
                "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
                (key, value),
            )

        await db.commit()
    finally:
        await db.close()


async def get_setting(key: str) -> str:
    """Get a setting value."""
    db = await get_db()
    try:
        cursor = await db.execute("SELECT value FROM settings WHERE key = ?", (key,))
        row = await cursor.fetchone()
        return row["value"] if row else None
    finally:
        await db.close()


async def update_setting(key: str, value: str):
    """Update a setting value."""
    db = await get_db()
    try:
        await db.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
            (key, value),
        )
        await db.commit()
    finally:
        await db.close()


async def get_all_settings() -> dict:
    """Get all settings as a dictionary."""
    db = await get_db()
    try:
        cursor = await db.execute("SELECT key, value FROM settings")
        rows = await cursor.fetchall()
        return {row["key"]: row["value"] for row in rows}
    finally:
        await db.close()


async def upsert_contact(name: str, email: str, title: str, company: str) -> dict:
    """
    Insert or update a contact. Uses normalized email as dedup key.
    Returns the contact dict and whether it was newly created.
    """
    normalized_email = email.strip().lower()
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT * FROM contacts WHERE email = ?", (normalized_email,)
        )
        existing = await cursor.fetchone()

        if existing:
            # Update name/title/company if new data is better
            update_fields = []
            update_values = []
            if name and (not existing["name"] or existing["name"] == "Unknown"):
                update_fields.append("name = ?")
                update_values.append(name)
            if title and (not existing["title"] or existing["title"] == "Unknown"):
                update_fields.append("title = ?")
                update_values.append(title)
            if company and (
                not existing["company"] or existing["company"] == "Unknown"
            ):
                update_fields.append("company = ?")
                update_values.append(company)

            if update_fields:
                update_fields.append("updated_at = ?")
                update_values.append(datetime.now(timezone.utc).isoformat())
                update_values.append(existing["id"])
                await db.execute(
                    f"UPDATE contacts SET {', '.join(update_fields)} WHERE id = ?",
                    update_values,
                )
                await db.commit()

            cursor = await db.execute(
                "SELECT * FROM contacts WHERE id = ?", (existing["id"],)
            )
            updated = await cursor.fetchone()
            return dict(updated), False
        else:
            now = datetime.now(timezone.utc).isoformat()
            cursor = await db.execute(
                """INSERT INTO contacts (name, email, title, company, status, created_at, updated_at)
                   VALUES (?, ?, ?, ?, 'NOT_CONTACTED', ?, ?)""",
                (name or "Unknown", normalized_email, title, company, now, now),
            )
            await db.commit()
            contact_id = cursor.lastrowid
            cursor = await db.execute(
                "SELECT * FROM contacts WHERE id = ?", (contact_id,)
            )
            new_contact = await cursor.fetchone()
            return dict(new_contact), True
    finally:
        await db.close()


async def get_contact_by_email(email: str) -> dict:
    """Get a contact by normalized email."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT * FROM contacts WHERE email = ?", (email.strip().lower(),)
        )
        row = await cursor.fetchone()
        return dict(row) if row else None
    finally:
        await db.close()


async def get_contact_by_id(contact_id: int) -> dict:
    """Get a contact by ID."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT * FROM contacts WHERE id = ?", (contact_id,)
        )
        row = await cursor.fetchone()
        return dict(row) if row else None
    finally:
        await db.close()


async def get_all_contacts(
    status: str = None,
    company: str = None,
    search: str = None,
) -> list:
    """Get all contacts with optional filters, sorted by ID with 1-indexed S.No."""
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM contacts ORDER BY id ASC")
        all_rows = [dict(row) for row in await cursor.fetchall()]
        
        # Attach 1-based serial number (sno) based on insertion order
        for idx, c in enumerate(all_rows, 1):
            c["sno"] = idx

        filtered = all_rows
        if status:
            filtered = [c for c in filtered if c["status"] == status]
        if company:
            filtered = [c for c in filtered if c.get("company") and company.lower() in c["company"].lower()]
        if search:
            s_lower = search.lower()
            filtered = [
                c for c in filtered
                if (c.get("name") and s_lower in c["name"].lower()) or
                   (c.get("email") and s_lower in c["email"].lower()) or
                   (c.get("company") and s_lower in c["company"].lower()) or
                   (c.get("title") and s_lower in c["title"].lower())
            ]

        return filtered
    finally:
        await db.close()


async def update_contact_status(contact_id: int, status: str):
    """Update contact status."""
    db = await get_db()
    try:
        await db.execute(
            "UPDATE contacts SET status = ?, updated_at = ? WHERE id = ?",
            (status, datetime.now(timezone.utc).isoformat(), contact_id),
        )
        await db.commit()
    finally:
        await db.close()


async def record_email_sent(
    contact_id: int,
    email_type: str,
    subject: str,
    body: str,
    gmail_message_id: str = None,
    gmail_thread_id: str = None,
    error: str = None,
) -> int:
    """Record an email being sent."""
    db = await get_db()
    try:
        now = datetime.now(timezone.utc).isoformat()
        cursor = await db.execute(
            """INSERT INTO email_history
               (contact_id, gmail_message_id, gmail_thread_id, email_type, subject, body, sent_at, error)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                contact_id,
                gmail_message_id,
                gmail_thread_id,
                email_type,
                subject,
                body,
                now,
                error,
            ),
        )
        email_id = cursor.lastrowid

        if not error:
            new_status = "EMAIL_SENT" if email_type == "INITIAL" else "FOLLOW_UP_SENT"
            await db.execute(
                "UPDATE contacts SET status = ?, updated_at = ? WHERE id = ?",
                (new_status, now, contact_id),
            )

        await db.commit()
        return email_id
    finally:
        await db.close()


async def get_email_history(contact_id: int) -> list:
    """Get email history for a contact."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT * FROM email_history WHERE contact_id = ? ORDER BY sent_at DESC",
            (contact_id,),
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]
    finally:
        await db.close()


async def get_last_email(contact_id: int) -> dict:
    """Get the last sent email for a contact."""
    db = await get_db()
    try:
        cursor = await db.execute(
            """SELECT * FROM email_history
               WHERE contact_id = ? AND error IS NULL
               ORDER BY sent_at DESC LIMIT 1""",
            (contact_id,),
        )
        row = await cursor.fetchone()
        return dict(row) if row else None
    finally:
        await db.close()


async def record_reply(contact_id: int, reply_snippet: str = None,
                       gmail_thread_id: str = None, gmail_message_id: str = None):
    """Record that a contact replied."""
    db = await get_db()
    try:
        now = datetime.now(timezone.utc).isoformat()
        # Update contact status
        await db.execute(
            "UPDATE contacts SET status = 'REPLIED', updated_at = ? WHERE id = ?",
            (now, contact_id),
        )
        # Update the latest email history entry
        if gmail_thread_id:
            await db.execute(
                """UPDATE email_history SET reply_received = 1, reply_at = ?,
                   reply_snippet = ? WHERE contact_id = ? AND gmail_thread_id = ?""",
                (now, reply_snippet, contact_id, gmail_thread_id),
            )
        else:
            await db.execute(
                """UPDATE email_history SET reply_received = 1, reply_at = ?,
                   reply_snippet = ? WHERE contact_id = ?
                   AND id = (SELECT id FROM email_history WHERE contact_id = ?
                             ORDER BY sent_at DESC LIMIT 1)""",
                (now, reply_snippet, contact_id, contact_id),
            )
        # Cancel pending followups
        await db.execute(
            "UPDATE followups SET status = 'CANCELLED' WHERE contact_id = ? AND status = 'PENDING'",
            (contact_id,),
        )
        await db.commit()
    finally:
        await db.close()


async def get_followup_eligible_contacts(cooldown_days: int = 30, max_followups: int = 2) -> list:
    """Get contacts eligible for follow-up."""
    db = await get_db()
    try:
        cursor = await db.execute(
            """SELECT c.*, 
                      (SELECT COUNT(*) FROM email_history WHERE contact_id = c.id AND error IS NULL) as emails_sent,
                      (SELECT MAX(sent_at) FROM email_history WHERE contact_id = c.id AND error IS NULL) as last_sent,
                      (SELECT COUNT(*) FROM followups WHERE contact_id = c.id AND status = 'SENT') as followups_sent
               FROM contacts c
               WHERE c.status IN ('EMAIL_SENT', 'FOLLOW_UP_SENT', 'FOLLOW_UP_ELIGIBLE')
               AND c.status NOT IN ('REPLIED', 'DO_NOT_CONTACT', 'INVALID_EMAIL', 'UNSUBSCRIBED')
               AND (SELECT COUNT(*) FROM followups WHERE contact_id = c.id AND status = 'SENT') < ?
               AND (SELECT MAX(sent_at) FROM email_history WHERE contact_id = c.id AND error IS NULL) 
                   <= datetime('now', ? || ' days')
            """,
            (max_followups, f"-{cooldown_days}"),
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]
    finally:
        await db.close()


async def record_followup(contact_id: int, followup_number: int, eligible_at: str):
    """Create a follow-up record."""
    db = await get_db()
    try:
        await db.execute(
            """INSERT INTO followups (contact_id, followup_number, eligible_at, status)
               VALUES (?, ?, ?, 'PENDING')""",
            (contact_id, followup_number, eligible_at),
        )
        await db.commit()
    finally:
        await db.close()


async def mark_followup_sent(contact_id: int, followup_number: int):
    """Mark a follow-up as sent."""
    db = await get_db()
    try:
        now = datetime.now(timezone.utc).isoformat()
        await db.execute(
            """UPDATE followups SET status = 'SENT', sent_at = ?
               WHERE contact_id = ? AND followup_number = ?""",
            (now, contact_id, followup_number),
        )
        await db.commit()
    finally:
        await db.close()


async def get_daily_send_count(date_str: str = None) -> int:
    """Get the number of emails sent today."""
    if not date_str:
        date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT count FROM daily_send_log WHERE date = ?", (date_str,)
        )
        row = await cursor.fetchone()
        return row["count"] if row else 0
    finally:
        await db.close()


async def increment_daily_send_count(date_str: str = None):
    """Increment daily send count."""
    if not date_str:
        date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT count FROM daily_send_log WHERE date = ?", (date_str,)
        )
        row = await cursor.fetchone()
        if row:
            await db.execute(
                "UPDATE daily_send_log SET count = count + 1 WHERE date = ?",
                (date_str,),
            )
        else:
            await db.execute(
                "INSERT INTO daily_send_log (date, count) VALUES (?, 1)", (date_str,)
            )
        await db.commit()
    finally:
        await db.close()


async def get_dashboard_stats() -> dict:
    """Get dashboard statistics."""
    db = await get_db()
    try:
        stats = {}
        cursor = await db.execute("SELECT COUNT(*) as c FROM contacts")
        stats["total_contacts"] = (await cursor.fetchone())["c"]

        cursor = await db.execute(
            "SELECT COUNT(*) as c FROM contacts WHERE status = 'NOT_CONTACTED'"
        )
        stats["new_contacts"] = (await cursor.fetchone())["c"]

        cursor = await db.execute(
            "SELECT COUNT(*) as c FROM email_history WHERE error IS NULL"
        )
        stats["emails_sent"] = (await cursor.fetchone())["c"]

        cursor = await db.execute(
            "SELECT COUNT(*) as c FROM contacts WHERE status = 'REPLIED'"
        )
        stats["replies_received"] = (await cursor.fetchone())["c"]

        cursor = await db.execute(
            "SELECT COUNT(*) as c FROM contacts WHERE status = 'FOLLOW_UP_ELIGIBLE'"
        )
        stats["followups_eligible"] = (await cursor.fetchone())["c"]

        cursor = await db.execute(
            "SELECT COUNT(*) as c FROM contacts WHERE status = 'FOLLOW_UP_SENT'"
        )
        stats["followups_sent"] = (await cursor.fetchone())["c"]

        cursor = await db.execute(
            "SELECT COUNT(*) as c FROM contacts WHERE status = 'DO_NOT_CONTACT'"
        )
        stats["do_not_contact"] = (await cursor.fetchone())["c"]

        cursor = await db.execute(
            "SELECT COUNT(*) as c FROM contacts WHERE status = 'INVALID_EMAIL'"
        )
        stats["invalid_emails"] = (await cursor.fetchone())["c"]

        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        cursor = await db.execute(
            "SELECT count FROM daily_send_log WHERE date = ?", (today,)
        )
        row = await cursor.fetchone()
        stats["sent_today"] = row["count"] if row else 0

        # Calculate S.No metrics
        all_c = await get_all_contacts()
        sent_contacts = [c for c in all_c if c["status"] in ("EMAIL_SENT", "REPLIED", "FOLLOW_UP_SENT", "FOLLOW_UP_ELIGIBLE")]
        pending_contacts = [c for c in all_c if c["status"] == "NOT_CONTACTED"]

        if sent_contacts:
            last = max(sent_contacts, key=lambda x: x["sno"])
            stats["last_sent_sno"] = last["sno"]
            stats["last_sent_name"] = last.get("name") or last.get("email")
            stats["last_sent_email"] = last.get("email")
        else:
            stats["last_sent_sno"] = 0
            stats["last_sent_name"] = "None"
            stats["last_sent_email"] = ""

        if pending_contacts:
            nxt = min(pending_contacts, key=lambda x: x["sno"])
            stats["next_pending_sno"] = nxt["sno"]
            stats["next_pending_name"] = nxt.get("name") or nxt.get("email")
            stats["next_pending_email"] = nxt.get("email")
        else:
            stats["next_pending_sno"] = 0
            stats["next_pending_name"] = "All contacts sent!"
            stats["next_pending_email"] = ""

        return stats
    finally:
        await db.close()
