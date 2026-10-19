"""
HR Email Automation Agent — FastAPI Backend
Main application with all API endpoints for the email automation workflow.
"""

import os
import json
import asyncio
import random
from datetime import datetime, timezone
from fastapi import FastAPI, UploadFile, File, HTTPException, Query, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List

from database import (
    init_db, get_db, get_all_settings, update_setting,
    upsert_contact, get_contact_by_email, get_contact_by_id,
    get_all_contacts, update_contact_status,
    record_email_sent, get_email_history, get_last_email,
    record_reply, get_followup_eligible_contacts,
    record_followup, mark_followup_sent,
    get_daily_send_count, increment_daily_send_count,
    get_dashboard_stats,
)
from pdf_parser import extract_contacts_from_pdf
from email_generator import generate_initial_email, generate_followup_email
from gmail_service import gmail_service, CREDENTIALS_DIR
from rag_engine import process_rag_query, get_detailed_replies

app = FastAPI(title="HR Email Automation Agent", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve frontend
FRONTEND_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend")


@app.on_event("startup")
async def startup():
    await init_db()
    os.makedirs(CREDENTIALS_DIR, exist_ok=True)
    asyncio.create_task(auto_sync_background_loop())


async def auto_sync_background_loop():
    """Silently auto-sync Gmail replies in background every 120 seconds."""
    while True:
        try:
            await asyncio.sleep(120)
            await sync_replies_from_gmail()
        except Exception:
            pass


async def sync_replies_from_gmail() -> list:
    """Silently check Gmail threads for all sent emails and update DB automatically."""
    if not gmail_service.is_authenticated():
        return []
    
    contacts = await get_all_contacts()
    new_replies = []
    
    for contact in contacts:
        if contact["status"] in ("REPLIED", "DO_NOT_CONTACT"):
            continue
        
        history = await get_email_history(contact["id"])
        for email_record in history:
            if email_record.get("reply_received"):
                continue
            
            thread_id = email_record.get("gmail_thread_id")
            if not thread_id:
                continue
            
            try:
                replies = await asyncio.to_thread(gmail_service.check_replies, thread_id)
                if replies:
                    latest_reply = replies[-1]
                    await record_reply(
                        contact["id"],
                        reply_snippet=latest_reply.get("snippet"),
                        gmail_thread_id=thread_id,
                        gmail_message_id=latest_reply.get("message_id"),
                    )
                    new_replies.append({
                        "contact_id": contact["id"],
                        "contact_name": contact["name"],
                        "contact_email": contact["email"],
                        "reply_snippet": latest_reply.get("snippet"),
                        "reply_date": latest_reply.get("date"),
                    })
                    break
            except Exception:
                continue

    return new_replies


# ─── Pydantic Models ───────────────────────────────────────────────────────

class SettingsUpdate(BaseModel):
    daily_limit: Optional[str] = None
    cooldown_days: Optional[str] = None
    max_followups: Optional[str] = None
    send_delay_seconds: Optional[str] = None
    linkedin_url: Optional[str] = None
    github_url: Optional[str] = None
    candidate_name: Optional[str] = None
    candidate_college: Optional[str] = None
    candidate_degree: Optional[str] = None
    candidate_grad_year: Optional[str] = None


class TestEmailRequest(BaseModel):
    email: str
    contact_name: Optional[str] = "Test Contact"
    contact_title: Optional[str] = "HR Manager"
    contact_company: Optional[str] = "Test Company"


class SendEmailsRequest(BaseModel):
    contact_ids: List[int]
    email_type: str = "INITIAL"  # INITIAL or FOLLOWUP


class ContactStatusUpdate(BaseModel):
    status: str


class ManualReplyRecord(BaseModel):
    reply_snippet: Optional[str] = None


class RAGQueryRequest(BaseModel):
    query: str


# ─── Auth Endpoints ────────────────────────────────────────────────────────

class GmailConnectRequest(BaseModel):
    email: str
    app_password: str


@app.get("/api/auth/status")
async def auth_status():
    """Check Gmail authentication status."""
    is_authed = gmail_service.is_authenticated()
    return {
        "is_authenticated": is_authed,
        "user_email": gmail_service.get_user_email() if is_authed else None,
    }


@app.post("/api/auth/connect")
async def connect_gmail(req: GmailConnectRequest):
    """Connect Gmail with email + app password."""
    gmail_service.save_credentials(req.email, req.app_password)
    result = gmail_service.test_connection()
    if not result["success"]:
        gmail_service.disconnect()  # Remove bad credentials
        raise HTTPException(status_code=400, detail=result["error"])
    return {"status": "connected", "email": req.email}


@app.post("/api/auth/test")
async def test_gmail():
    """Test the saved Gmail connection."""
    if not gmail_service.is_authenticated():
        raise HTTPException(status_code=401, detail="No Gmail credentials configured")
    result = gmail_service.test_connection()
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@app.post("/api/auth/disconnect")
async def disconnect_gmail():
    """Disconnect Gmail account."""
    gmail_service.disconnect()
    return {"status": "disconnected"}


# ─── Settings Endpoints ────────────────────────────────────────────────────

@app.get("/api/settings")
async def get_settings():
    """Get all application settings."""
    return await get_all_settings()


@app.put("/api/settings")
async def update_settings(settings: SettingsUpdate):
    """Update application settings."""
    data = settings.dict(exclude_none=True)
    for key, value in data.items():
        await update_setting(key, value)
    return await get_all_settings()


# ─── PDF Upload & Contact Extraction ───────────────────────────────────────

@app.post("/api/upload-pdf")
async def upload_pdf(file: UploadFile = File(...)):
    """Upload a PDF and extract contacts."""
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="File must be a PDF")
    
    content = await file.read()
    result = extract_contacts_from_pdf(content)
    
    if "error" in result.get("stats", {}):
        raise HTTPException(status_code=400, detail=result["stats"]["error"])
    
    # Compare with database and automatically save new contacts
    new_contacts = []
    existing_contacts = []
    invalid_contacts = result.get("invalid_contacts", [])
    
    for contact in result["contacts"]:
        existing = await get_contact_by_email(contact["email"])
        if existing:
            existing_contacts.append({**contact, "db_status": existing["status"], "db_id": existing["id"]})
        else:
            cid = await upsert_contact(
                contact.get("name"),
                contact["email"],
                contact.get("title"),
                contact.get("company")
            )
            new_contacts.append({**contact, "db_id": cid})
    
    return {
        "stats": {
            **result["stats"],
            "new": len(new_contacts),
            "existing": len(existing_contacts),
            "invalid": len(invalid_contacts),
            "auto_imported": len(new_contacts),
        },
        "new_contacts": new_contacts,
        "existing_contacts": existing_contacts,
        "invalid_contacts": invalid_contacts,
    }


@app.post("/api/import-contacts")
async def import_contacts(contacts: List[dict]):
    """Import extracted contacts into the database."""
    imported = []
    skipped = []
    
    for contact in contacts:
        result, is_new = await upsert_contact(
            name=contact.get("name"),
            email=contact.get("email"),
            title=contact.get("title"),
            company=contact.get("company"),
        )
        if is_new:
            imported.append(result)
        else:
            skipped.append(result)
    
    return {
        "imported": len(imported),
        "skipped": len(skipped),
        "contacts": imported,
    }


# ─── Contact Management ───────────────────────────────────────────────────

@app.get("/api/contacts")
async def list_contacts(
    status: Optional[str] = None,
    company: Optional[str] = None,
    search: Optional[str] = None,
):
    """List all contacts with optional filters."""
    contacts = await get_all_contacts(status=status, company=company, search=search)
    
    # Enrich with email history info
    for contact in contacts:
        history = await get_email_history(contact["id"])
        contact["emails_sent"] = len([h for h in history if not h.get("error")])
        contact["last_email_sent"] = history[0]["sent_at"] if history else None
        contact["has_reply"] = any(h.get("reply_received") for h in history)
        
        # Calculate next eligible date
        last_email = await get_last_email(contact["id"])
        if last_email:
            settings = await get_all_settings()
            cooldown = int(settings.get("cooldown_days", 30))
            from datetime import timedelta
            try:
                last_sent = datetime.fromisoformat(last_email["sent_at"])
                next_eligible = last_sent + timedelta(days=cooldown)
                contact["next_eligible"] = next_eligible.isoformat()
            except Exception:
                contact["next_eligible"] = None
        else:
            contact["next_eligible"] = None
    
    return contacts


@app.get("/api/contacts/{contact_id}")
async def get_contact(contact_id: int):
    """Get a specific contact with full history."""
    contact = await get_contact_by_id(contact_id)
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    
    contact["email_history"] = await get_email_history(contact_id)
    return contact


@app.put("/api/contacts/{contact_id}/status")
async def change_contact_status(contact_id: int, body: ContactStatusUpdate):
    """Update a contact's status."""
    valid_statuses = [
        "NOT_CONTACTED", "EMAIL_SENT", "REPLIED", "FOLLOW_UP_ELIGIBLE",
        "FOLLOW_UP_SENT", "DO_NOT_CONTACT", "INVALID_EMAIL", "UNSUBSCRIBED",
    ]
    if body.status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {valid_statuses}")
    
    contact = await get_contact_by_id(contact_id)
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    
    await update_contact_status(contact_id, body.status)
    return {"status": "updated", "new_status": body.status}


@app.post("/api/contacts/{contact_id}/reply")
async def mark_reply(contact_id: int, body: ManualReplyRecord):
    """Manually mark a contact as having replied."""
    contact = await get_contact_by_id(contact_id)
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    
    await record_reply(contact_id, reply_snippet=body.reply_snippet)
    return {"status": "marked_as_replied"}


# ─── Email Preview & Generation ───────────────────────────────────────────

@app.get("/api/preview-emails")
async def preview_emails(contact_ids: str = Query(...)):
    """Preview generated emails for given contact IDs."""
    ids = [int(x) for x in contact_ids.split(",") if x.strip()]
    settings = await get_all_settings()
    previews = []
    
    for cid in ids:
        contact = await get_contact_by_id(cid)
        if not contact:
            continue
        
        if contact["status"] in ("REPLIED", "DO_NOT_CONTACT", "INVALID_EMAIL", "UNSUBSCRIBED"):
            continue
        
        if contact["status"] == "NOT_CONTACTED":
            email = generate_initial_email(contact, settings)
            email_type = "INITIAL"
        else:
            # Determine followup number
            history = await get_email_history(cid)
            followup_num = len([h for h in history if h["email_type"] == "FOLLOWUP" and not h.get("error")]) + 1
            email = generate_followup_email(contact, settings, followup_num)
            email_type = "FOLLOWUP"
        
        previews.append({
            "contact_id": cid,
            "contact": contact,
            "email_type": email_type,
            "subject": email["subject"],
            "body": email["body"],
        })
    
    return previews


@app.post("/api/preview-all-new")
async def preview_all_new():
    """Preview emails for all new (un-contacted) contacts."""
    contacts = await get_all_contacts(status="NOT_CONTACTED")
    settings = await get_all_settings()
    previews = []
    
    for contact in contacts:
        email = generate_initial_email(contact, settings)
        previews.append({
            "contact_id": contact["id"],
            "contact": contact,
            "email_type": "INITIAL",
            "subject": email["subject"],
            "body": email["body"],
        })
    
    return previews


# ─── Email Sending ─────────────────────────────────────────────────────────

@app.post("/api/send-test")
async def send_test_email(req: TestEmailRequest):
    """Send a test email to verify everything works."""
    if not gmail_service.is_authenticated():
        raise HTTPException(status_code=401, detail="Gmail not authenticated")
    
    settings = await get_all_settings()
    test_contact = {
        "name": req.contact_name,
        "email": req.email,
        "title": req.contact_title,
        "company": req.contact_company,
    }
    
    email = generate_initial_email(test_contact, settings)
    result = gmail_service.send_email(req.email, email["subject"], email["body"])
    
    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])
    
    return {
        "status": "sent",
        "message_id": result.get("message_id"),
        "subject": email["subject"],
        "body": email["body"],
    }


@app.post("/api/send-emails")
async def send_emails(req: SendEmailsRequest):
    """Send emails to selected contacts with daily limit enforcement."""
    if not gmail_service.is_authenticated():
        raise HTTPException(status_code=401, detail="Gmail not authenticated")
    
    settings = await get_all_settings()
    daily_limit = int(settings.get("daily_limit", 20))
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    sent_today = await get_daily_send_count(today)
    remaining = daily_limit - sent_today
    
    if remaining <= 0:
        return {
            "status": "daily_limit_reached",
            "sent": 0,
            "failed": 0,
            "remaining_today": 0,
            "message": f"Daily limit of {daily_limit} emails reached. Try again tomorrow.",
        }
    
    results = {"sent": 0, "failed": 0, "errors": [], "details": []}
    
    for cid in req.contact_ids:
        if results["sent"] >= remaining:
            results["details"].append({
                "contact_id": cid,
                "status": "skipped",
                "reason": "Daily limit reached",
            })
            continue
        
        contact = await get_contact_by_id(cid)
        if not contact:
            results["details"].append({
                "contact_id": cid,
                "status": "failed",
                "reason": "Contact not found",
            })
            results["failed"] += 1
            continue
        
        # Safety checks
        if contact["status"] in ("REPLIED", "DO_NOT_CONTACT", "INVALID_EMAIL", "UNSUBSCRIBED"):
            results["details"].append({
                "contact_id": cid,
                "status": "skipped",
                "reason": f"Contact status is {contact['status']}",
            })
            continue
        
        # Determine email type
        if req.email_type == "FOLLOWUP" or contact["status"] in ("EMAIL_SENT", "FOLLOW_UP_SENT", "FOLLOW_UP_ELIGIBLE"):
            history = await get_email_history(cid)
            followup_num = len([h for h in history if h["email_type"] == "FOLLOWUP" and not h.get("error")]) + 1
            max_followups = int(settings.get("max_followups", 2))
            
            if followup_num > max_followups:
                results["details"].append({
                    "contact_id": cid,
                    "status": "skipped",
                    "reason": f"Max follow-ups ({max_followups}) reached",
                })
                continue
            
            email = generate_followup_email(contact, settings, followup_num)
            email_type = "FOLLOWUP"
            
            # Get existing thread ID for threading
            last = await get_last_email(cid)
            thread_id = last.get("gmail_thread_id") if last else None
        else:
            # Check if already contacted
            existing_email = await get_last_email(cid)
            if existing_email:
                results["details"].append({
                    "contact_id": cid,
                    "status": "skipped",
                    "reason": "Already contacted",
                })
                continue
            
            email = generate_initial_email(contact, settings)
            email_type = "INITIAL"
            thread_id = None
        
        # Send the email
        result = gmail_service.send_email(
            contact["email"],
            email["subject"],
            email["body"],
            thread_id=thread_id,
        )
        
        if "error" in result:
            await record_email_sent(
                cid, email_type, email["subject"], email["body"],
                error=result["error"],
            )
            results["failed"] += 1
            results["errors"].append({
                "contact_id": cid,
                "email": contact["email"],
                "error": result["error"],
            })
            results["details"].append({
                "contact_id": cid,
                "status": "failed",
                "reason": result["error"],
            })
        else:
            await record_email_sent(
                cid, email_type, email["subject"], email["body"],
                gmail_message_id=result.get("message_id"),
                gmail_thread_id=result.get("thread_id"),
            )
            await increment_daily_send_count(today)
            results["sent"] += 1
            
            if email_type == "FOLLOWUP":
                await mark_followup_sent(cid, followup_num)
            
            results["details"].append({
                "contact_id": cid,
                "status": "sent",
                "message_id": result.get("message_id"),
            })
        
        # Humanized randomized pause between emails to protect account deliverability
        base_delay = float(settings.get("send_delay_seconds", "15"))
        # Add random jitter between -20% and +40%
        jitter = random.uniform(-0.2 * base_delay, 0.4 * base_delay)
        actual_delay = max(1.0, base_delay + jitter)
        await asyncio.sleep(actual_delay)
    
    results["remaining_today"] = remaining - results["sent"]
    results["status"] = "completed"
    return results


# ─── Follow-up Management ──────────────────────────────────────────────────

@app.get("/api/followups/eligible")
async def get_eligible_followups():
    """Get contacts eligible for follow-up."""
    settings = await get_all_settings()
    cooldown = int(settings.get("cooldown_days", 30))
    max_fu = int(settings.get("max_followups", 2))
    
    eligible = await get_followup_eligible_contacts(cooldown, max_fu)
    
    # Generate preview for each
    previews = []
    for contact in eligible:
        followup_num = contact.get("followups_sent", 0) + 1
        email = generate_followup_email(contact, settings, followup_num)
        previews.append({
            "contact": contact,
            "followup_number": followup_num,
            "subject": email["subject"],
            "body": email["body"],
        })
    
    return {
        "count": len(previews),
        "eligible": previews,
    }


# ─── Reply Detection ──────────────────────────────────────────────────────

@app.post("/api/check-replies")
async def check_replies():
    """Silently check for replies across all sent emails in background."""
    asyncio.create_task(sync_replies_from_gmail())
    return {
        "status": "sync_started",
        "message": "Gmail reply sync running silently in background."
    }


@app.get("/api/replies")
async def list_replies():
    """Get all recruiter replies with classified sentiment (instant response from DB)."""
    asyncio.create_task(sync_replies_from_gmail())
    replies = await get_detailed_replies()
    return {"count": len(replies), "replies": replies}


@app.post("/api/ai-assistant/query")
async def ai_assistant_query(req: RAGQueryRequest):
    """Process natural language query against campaign database using RAG engine."""
    if not req.query or not req.query.strip():
        raise HTTPException(status_code=400, detail="Query string cannot be empty")
    return await process_rag_query(req.query)


# ─── Dashboard ─────────────────────────────────────────────────────────────

@app.get("/api/dashboard")
async def dashboard():
    """Get dashboard statistics."""
    stats = await get_dashboard_stats()
    settings = await get_all_settings()
    stats["daily_limit"] = int(settings.get("daily_limit", 20))
    return stats


# ─── Email History ─────────────────────────────────────────────────────────

@app.get("/api/contacts/{contact_id}/history")
async def contact_email_history(contact_id: int):
    """Get email history for a contact."""
    contact = await get_contact_by_id(contact_id)
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    
    history = await get_email_history(contact_id)
    return {"contact": contact, "history": history}


# ─── Serve Frontend ────────────────────────────────────────────────────────

# Mount static files
app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")

@app.get("/")
async def serve_frontend():
    """Serve the main frontend HTML."""
    index_path = os.path.join(FRONTEND_DIR, "index.html")
    if os.path.exists(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            return HTMLResponse(f.read())
    return HTMLResponse("<h1>Frontend not found</h1>")

# Mount root directory so relative asset requests (/styles.css, /app.js, etc.) work directly
app.mount("/", StaticFiles(directory=FRONTEND_DIR), name="root_static")



if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
