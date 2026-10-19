"""
Email personalization and generation module.
Generates highly personalized, varied professional networking emails
to maximize inbox deliverability and response rates.
"""

import zlib


def _get_hash(key: str) -> int:
    """Deterministic hash for selecting variations."""
    return zlib.crc32(key.encode("utf-8"))


def _extract_first_name(full_name: str) -> tuple:
    """Extract first name from full name, ignoring titles."""
    if not full_name or not full_name.strip() or full_name.strip().lower() == "unknown":
        return "", False
    parts = full_name.strip().split()
    cleaned = [p for p in parts if p.lower() not in ("mr.", "ms.", "mrs.", "dr.", "prof.")]
    if cleaned:
        return cleaned[0].capitalize(), True
    return "", False


def generate_initial_email(contact: dict, settings: dict) -> dict:
    """
    Generate a personalized, varied initial networking email.
    Returns dict with 'subject' and 'body'.
    """
    email_str = contact.get("email", "")
    seed = _get_hash(email_str)

    full_name = contact.get("name", "")
    company = (contact.get("company") or "your company").strip()
    if not company or company.lower() == "unknown":
        company = "your company"

    title = (contact.get("title") or "").strip()

    candidate_name = settings.get("candidate_name", "Jaswanth")
    candidate_degree = settings.get("candidate_degree", "B.Tech CSE")
    candidate_college = settings.get("candidate_college", "NBKRIST")
    candidate_grad_year = settings.get("candidate_grad_year", "2027")
    linkedin_url = settings.get("linkedin_url", "")
    github_url = settings.get("github_url", "")

    first_name, has_name = _extract_first_name(full_name)

    # Greeting variation
    if has_name:
        greeting_options = [
            f"Dear {first_name},",
            f"Hi {first_name},",
            f"Hello {first_name},"
        ]
        greeting = greeting_options[seed % len(greeting_options)]
    else:
        greeting_options = [
            "Dear Hiring Team,",
            "Dear Recruiting Team,",
            "Hello Hiring Team,"
        ]
        greeting = greeting_options[seed % len(greeting_options)]

    # Subject line variation
    if has_name and (seed % 3 == 0):
        subject_options = [
            f"{first_name}, exploring Software Engineering opportunities at {company}",
            f"{first_name} — Inquiry regarding software engineering roles at {company}",
            f"{first_name}, quick inquiry on software engineering at {company}"
        ]
    else:
        subject_options = [
            f"Exploring Future Opportunities at {company}",
            f"Software Engineering Opportunities at {company}",
            f"Inquiry: Entry-Level Software Engineering at {company}",
            f"Connecting regarding Software Engineering roles at {company}",
            f"Future Software Engineering Opportunities — {company}"
        ]
    subject = subject_options[seed % len(subject_options)]

    # Role & Title context personalization
    role_context = _get_role_context(title, company, seed)

    # Body sentence variations
    openers = [
        "I hope you're doing well.",
        "I hope this message finds you well.",
        "I hope you're having a great week.",
        "Hope you're having a productive week."
    ]
    opener = openers[seed % len(openers)]

    interest_lines = [
        f"I am very interested in exploring Software Engineering internships and entry-level opportunities at {company}{role_context}.",
        f"I have been closely following {company}'s tech work and am eager to explore Software Engineering roles{role_context}.",
        f"I'm keen to explore entry-level Software Engineering positions at {company}{role_context} and would love to stay connected."
    ]
    interest_line = interest_lines[seed % len(interest_lines)]

    closing_lines = [
        "Thank you for your time. I look forward to staying connected.",
        "I truly appreciate your time and consideration. Hope to stay connected.",
        "Thank you for taking a moment to read this. Looking forward to staying in touch."
    ]
    closing_line = closing_lines[seed % len(closing_lines)]

    body = f"""{greeting}

{opener} My name is {candidate_name}, and I'm a final-year {candidate_degree} student graduating in {candidate_grad_year} from {candidate_college}.

{interest_line}

I completely understand if there are no immediate openings for my profile right now. Even a brief acknowledgment or a "please stay connected" would mean a lot. With your permission, I'd like to save your contact and reach out in the future whenever a suitable role opens up on the {company} careers page.

I'll make sure to reach out only when there is a relevant opportunity. {closing_line}

Best regards,
{candidate_name}
{candidate_degree} | {candidate_college}"""

    if linkedin_url:
        body += f"\nLinkedIn: {linkedin_url}"
    if github_url:
        body += f"\nGitHub: {github_url}"

    return {"subject": subject, "body": body}


def generate_followup_email(contact: dict, settings: dict, followup_number: int = 1) -> dict:
    """
    Generate a personalized, varied follow-up email.
    Returns dict with 'subject' and 'body'.
    """
    email_str = contact.get("email", "")
    seed = _get_hash(email_str + str(followup_number))

    full_name = contact.get("name", "")
    company = (contact.get("company") or "your company").strip()
    if not company or company.lower() == "unknown":
        company = "your company"

    candidate_name = settings.get("candidate_name", "Jaswanth")
    first_name, has_name = _extract_first_name(full_name)

    if has_name:
        greeting = f"Hi {first_name}," if (seed % 2 == 0) else f"Dear {first_name},"
    else:
        greeting = "Dear Hiring Team,"

    if followup_number == 1:
        subjects = [
            f"Following Up — Future Opportunities at {company}",
            f"Re: Software Engineering Opportunities at {company}",
            f"Brief Follow Up: Engineering roles at {company}"
        ]
        subject = subjects[seed % len(subjects)]

        body = f"""{greeting}

I hope you're doing well.

I wanted to briefly follow up on my previous message regarding potential Software Engineering internship or entry-level opportunities at {company}.

I completely understand that there may not be an immediate opening at the moment. I would be very grateful to stay connected for any future opportunities.

Thank you again for your time and consideration.

Best regards,
{candidate_name}"""
    else:
        subjects = [
            f"Final Follow Up — Software Engineering at {company}",
            f"Re: Opportunities at {company}",
            f"Staying Connected — {company}"
        ]
        subject = subjects[seed % len(subjects)]

        body = f"""{greeting}

I hope this message finds you well.

I wanted to reach out one final time regarding my interest in Software Engineering opportunities at {company}. I remain very interested in contributing to your team and would love to keep in touch for future openings.

I understand you have a busy schedule, and I truly appreciate any time you can spare. This will be my final follow-up, but please feel free to reach out if a suitable position opens up.

Thank you for your time and consideration.

Best regards,
{candidate_name}"""

    return {"subject": subject, "body": body}


def _get_role_context(title: str, company: str, seed: int) -> str:
    """Generate role-specific context based on the recipient's title."""
    if not title or title.lower() == "unknown":
        return ""

    t_lower = title.lower()

    if "campus" in t_lower or "university" in t_lower:
        return f", particularly through {company}'s campus recruitment and early career programs"
    elif "technical" in t_lower or "tech recruiter" in t_lower:
        return f", given your focus on technical hiring at {company}"
    elif "talent acquisition" in t_lower or "recruiter" in t_lower or "talent" in t_lower:
        return f", given your leadership in talent acquisition at {company}"
    elif "engineering manager" in t_lower or "lead" in t_lower or "cto" in t_lower:
        return f", given your work with engineering teams at {company}"
    elif "hr" in t_lower or "people" in t_lower:
        return f", given your HR role at {company}"

    return ""

