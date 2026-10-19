"""
RAG & Campaign Intelligence Engine for HR Email Automation Agent.
Answers natural language questions about email campaign stats, replies, contacts, and sentiment.
"""

from datetime import datetime
from database import (
    get_db, get_dashboard_stats, get_all_contacts,
    get_email_history, get_all_settings
)

def classify_reply_sentiment(snippet: str) -> str:
    """Classify reply snippet into INTERESTED, REFERRAL, NOT_INTERESTED, or GENERAL."""
    if not snippet:
        return "GENERAL"
    s = snippet.lower()
    
    # Referral indicators
    if any(k in s for k in ["reach out to", "contact my colleague", "forwarded", "forwarding", "talk to", "refer", "cc'd", "another team"]):
        return "REFERRAL"
    
    # Positive / Interested indicators
    if any(k in s for k in ["interview", "schedule", "call", "phone", "resume", "cv", "openings", "available", "discuss", "interested", "connect", "share your", "send your", "next steps", "happy to", "look forward"]):
        return "INTERESTED"
        
    # Negative / Not interested indicators
    if any(k in s for k in ["no openings", "not hiring", "no positions", "filled", "unfortunately", "regret", "cannot", "not looking", "not taking"]):
        return "NOT_INTERESTED"
        
    return "GENERAL"


async def get_detailed_replies() -> list:
    """Get all contacts who replied with full context and classified sentiment."""
    db = await get_db()
    try:
        cursor = await db.execute("""
            SELECT c.id, c.name, c.email, c.company, c.title, c.status,
                   h.reply_at, h.reply_snippet, h.subject, h.sent_at
            FROM contacts c
            JOIN email_history h ON c.id = h.contact_id
            WHERE h.reply_received = 1 OR c.status = 'REPLIED'
            ORDER BY h.reply_at DESC
        """)
        rows = await cursor.fetchall()
        replies = []
        for r in rows:
            d = dict(r)
            d["sentiment"] = classify_reply_sentiment(d.get("reply_snippet", ""))
            replies.append(d)
        return replies
    finally:
        await db.close()


async def process_rag_query(query: str) -> dict:
    """
    Process a natural language query against campaign data.
    Returns structured answer with text, stats, and relevant data items.
    """
    q_lower = query.lower().strip()
    stats = await get_dashboard_stats()
    all_contacts = await get_all_contacts()
    replies = await get_detailed_replies()
    settings = await get_all_settings()

    # Calculate Response Rate
    total_sent = stats.get("emails_sent", 0)
    total_replies = len(replies)
    response_rate = round((total_replies / total_sent * 100), 1) if total_sent > 0 else 0.0

    # Categorize replies by sentiment
    interested = [r for r in replies if r["sentiment"] == "INTERESTED"]
    referrals = [r for r in replies if r["sentiment"] == "REFERRAL"]
    not_interested = [r for r in replies if r["sentiment"] == "NOT_INTERESTED"]
    general = [r for r in replies if r["sentiment"] == "GENERAL"]

    # 1. Replies / Responses query
    if any(k in q_lower for k in ["reply", "replies", "response", "responded", "who answered"]):
        if "interested" in q_lower or "positive" in q_lower or "interview" in q_lower:
            target_list = interested
            label = "Interested / Positive Replies"
        elif "referral" in q_lower or "refer" in q_lower:
            target_list = referrals
            label = "Referral Replies"
        elif "not interested" in q_lower or "negative" in q_lower or "rejected" in q_lower:
            target_list = not_interested
            label = "Not Interested Replies"
        else:
            target_list = replies
            label = "All Recruiter Replies"

        if not target_list:
            text = f"No {label.lower()} recorded yet. Total sent: **{total_sent}** emails."
        else:
            text = f"Found **{len(target_list)}** {label.lower()}:\n"
            for r in target_list:
                snippet_text = f'"{r["reply_snippet"]}"' if r.get("reply_snippet") else "No snippet available"
                text += f"- **{r['name']}** ({r['company']}) — `{r['email']}` | Sentiment: **{r['sentiment']}**\n  > Snippet: {snippet_text}\n"

        return {
            "answer": text,
            "category": "replies",
            "stats": {"total_replies": total_replies, "interested": len(interested), "response_rate": f"{response_rate}%"},
            "data": target_list
        }

    # 2. Stats / Summary query
    if any(k in q_lower for k in ["stat", "summary", "progress", "overview", "rate", "how many"]):
        text = f"""### 📊 Campaign Intelligence Summary

- **Total Contacts in DB:** {stats.get('total_contacts', 0)}
- **Emails Sent Total:** {stats.get('emails_sent', 0)}
- **Sent Today:** {stats.get('sent_today', 0)} / {stats.get('daily_limit', 20)} daily limit
- **Total Replies Received:** {total_replies} (Response Rate: **{response_rate}%**)
  - 🌟 **Interested / Positive:** {len(interested)}
  - 🔄 **Referrals:** {len(referrals)}
  - ❌ **Not Interested:** {len(not_interested)}
  - 💬 **General Replies:** {len(general)}
- **Pending (Not Contacted):** {stats.get('new_contacts', 0)}
- **Eligible for Follow-up:** {stats.get('followups_eligible', 0)}
"""
        return {
            "answer": text,
            "category": "summary",
            "stats": stats,
            "data": []
        }

    # 3. Company specific search
    company_matches = [c for c in all_contacts if c.get("company") and c.get("company").lower() in q_lower]
    if not company_matches:
        # Check individual words for company matching
        words = [w for w in q_lower.split() if len(w) > 3 and w not in ["show", "find", "search", "mail", "email", "status", "company", "about", "did", "have", "with", "from"]]
        for w in words:
            matches = [c for c in all_contacts if c.get("company") and w in c.get("company").lower()]
            if matches:
                company_matches = matches
                break

    if company_matches:
        comp_name = company_matches[0].get("company", "Company")
        text = f"Found **{len(company_matches)}** contacts at **{comp_name}**:\n"
        for c in company_matches:
            history = await get_email_history(c["id"])
            has_reply = "REPLIED" if c["status"] == "REPLIED" else ("EMAIL_SENT" if history else "NOT_CONTACTED")
            text += f"- **{c['name']}** (`{c['email']}`) - Title: *{c.get('title', 'N/A')}* | Status: **{has_reply}**\n"

        return {
            "answer": text,
            "category": "company_search",
            "stats": {"matches": len(company_matches)},
            "data": company_matches
        }

    # 4. Default Smart Fallback Summary
    text = f"""### 🤖 Campaign Overview & Assistant

I analyzed your email campaign data for **{settings.get('candidate_name', 'Candidate')}** (`{gmail_service_user(settings)}`):

- **Total Contacts:** {stats.get('total_contacts', 0)}
- **Sent Today:** {stats.get('sent_today', 0)} / {stats.get('daily_limit', 20)}
- **Replies Received:** {total_replies} ({response_rate}% response rate)
- **Interested Recruiters:** {len(interested)}

You can ask me questions like:
- *"Who replied to my emails?"*
- *"Show interested recruiters"*
- *"Did anyone from Google respond?"*
- *"What are my campaign stats?"*
"""
    return {
        "answer": text,
        "category": "general",
        "stats": stats,
        "data": []
    }


def gmail_service_user(settings):
    from gmail_service import gmail_service
    return gmail_service.get_user_email() or settings.get("candidate_name", "your account")
