"""
PDF contact extraction module.
Extracts HR/Recruiter contact information from uploaded PDFs using pdfplumber.
Handles tabular data, semi-structured text, and various PDF formats.
"""

import re
import pdfplumber
from io import BytesIO
from email_validator import validate_email, EmailNotValidError


# Common email patterns
EMAIL_REGEX = re.compile(
    r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}", re.IGNORECASE
)

# Common HR titles
HR_TITLES = [
    "recruiter", "talent acquisition", "hr manager", "hr director",
    "human resources", "hiring manager", "staffing", "people operations",
    "talent partner", "recruitment", "hr specialist", "hr coordinator",
    "head of hr", "chief people officer", "vp of hr", "hr lead",
    "technical recruiter", "campus recruiter", "senior recruiter",
    "associate recruiter", "recruitment specialist", "hr business partner",
    "talent specialist", "people & culture",
]


def validate_email_address(email: str) -> bool:
    """Validate an email address."""
    try:
        validate_email(email, check_deliverability=False)
        return True
    except EmailNotValidError:
        return False


def normalize_email(email: str) -> str:
    """Normalize email to lowercase and strip whitespace."""
    return email.strip().lower()


def extract_contacts_from_pdf(pdf_bytes: bytes) -> dict:
    """
    Extract contacts from a PDF file.
    Returns a dict with 'contacts' list and 'stats' dict.
    """
    contacts = []
    raw_text = ""
    
    try:
        pdf = pdfplumber.open(BytesIO(pdf_bytes))
    except Exception as e:
        return {
            "contacts": [],
            "stats": {"error": f"Failed to open PDF: {str(e)}"},
        }

    # Strategy 1: Try extracting from tables
    table_contacts = _extract_from_tables(pdf)
    if table_contacts:
        contacts.extend(table_contacts)

    # Strategy 2: Extract from raw text (catches contacts not in tables)
    for page in pdf.pages:
        text = page.extract_text() or ""
        raw_text += text + "\n"

    text_contacts = _extract_from_text(raw_text)
    
    # Merge text contacts (avoid duplicates by email)
    existing_emails = {c["email"] for c in contacts}
    for tc in text_contacts:
        if tc["email"] not in existing_emails:
            contacts.append(tc)
            existing_emails.add(tc["email"])

    pdf.close()

    # Validate and categorize
    valid_contacts = []
    invalid_contacts = []
    
    for contact in contacts:
        contact["email"] = normalize_email(contact["email"])
        if validate_email_address(contact["email"]):
            valid_contacts.append(contact)
        else:
            invalid_contacts.append(contact)

    stats = {
        "total_extracted": len(contacts),
        "valid": len(valid_contacts),
        "invalid": len(invalid_contacts),
    }

    return {
        "contacts": valid_contacts,
        "invalid_contacts": invalid_contacts,
        "stats": stats,
    }


def _extract_from_tables(pdf) -> list:
    """Extract contacts from PDF tables."""
    contacts = []
    
    for page in pdf.pages:
        tables = page.extract_tables()
        if not tables:
            continue
            
        for table in tables:
            if not table or len(table) < 2:
                continue
                
            # Try to identify header row
            header = table[0]
            if not header:
                continue
                
            col_map = _identify_columns(header)
            
            if "email" not in col_map:
                # Try without header, scan for emails
                for row in table:
                    contact = _extract_contact_from_row(row)
                    if contact:
                        contacts.append(contact)
                continue
            
            # Extract using column mapping
            for row in table[1:]:
                if not row or len(row) <= max(col_map.values()):
                    continue
                    
                email = row[col_map["email"]] if col_map.get("email") is not None else None
                if not email or not EMAIL_REGEX.search(str(email)):
                    continue
                    
                email_match = EMAIL_REGEX.search(str(email))
                contact = {
                    "name": _clean_text(row[col_map["name"]]) if col_map.get("name") is not None else None,
                    "email": email_match.group(0) if email_match else str(email).strip(),
                    "title": _clean_text(row[col_map["title"]]) if col_map.get("title") is not None else None,
                    "company": _clean_text(row[col_map["company"]]) if col_map.get("company") is not None else None,
                }
                contacts.append(contact)
    
    return contacts


def _identify_columns(header: list) -> dict:
    """Identify which columns contain name, email, title, company."""
    col_map = {}
    
    name_patterns = ["name", "contact", "person", "hr name", "recruiter"]
    email_patterns = ["email", "e-mail", "mail", "email address"]
    title_patterns = ["title", "role", "position", "designation", "job title"]
    company_patterns = ["company", "organization", "org", "employer", "firm"]
    
    for i, cell in enumerate(header):
        if cell is None:
            continue
        cell_lower = str(cell).lower().strip()
        
        if any(p in cell_lower for p in email_patterns):
            col_map["email"] = i
        elif any(p in cell_lower for p in name_patterns):
            col_map["name"] = i
        elif any(p in cell_lower for p in title_patterns):
            col_map["title"] = i
        elif any(p in cell_lower for p in company_patterns):
            col_map["company"] = i
    
    return col_map


def _extract_contact_from_row(row: list) -> dict:
    """Try to extract a contact from a table row without known headers."""
    if not row:
        return None
        
    email = None
    for cell in row:
        if cell and EMAIL_REGEX.search(str(cell)):
            email = EMAIL_REGEX.search(str(cell)).group(0)
            break
    
    if not email:
        return None
    
    # Heuristic: first non-email text is name, etc.
    remaining = [str(c).strip() for c in row if c and str(c).strip() != email and not EMAIL_REGEX.search(str(c))]
    
    name = remaining[0] if len(remaining) > 0 else None
    title = None
    company = None
    
    for text in remaining[1:]:
        text_lower = text.lower()
        if any(t in text_lower for t in HR_TITLES):
            title = text
        elif not company:
            company = text
    
    if not title and len(remaining) > 1:
        title = remaining[1]
    if not company and len(remaining) > 2:
        company = remaining[2]
    
    return {
        "name": name,
        "email": email,
        "title": title,
        "company": company,
    }


def _extract_from_text(text: str) -> list:
    """Extract contacts from raw text using regex and heuristics."""
    contacts = []
    emails_found = EMAIL_REGEX.findall(text)
    
    for email in emails_found:
        # Try to find context around the email
        # Look for name, title, company near the email
        lines = text.split("\n")
        context_lines = []
        
        for i, line in enumerate(lines):
            if email in line:
                # Get surrounding lines for context
                start = max(0, i - 2)
                end = min(len(lines), i + 3)
                context_lines = lines[start:end]
                break
        
        context = " ".join(context_lines)
        
        # Try to extract name
        name = _extract_name_near_email(context, email)
        title = _extract_title_from_context(context)
        company = _extract_company_from_context(context)
        
        contacts.append({
            "name": name,
            "email": email,
            "title": title,
            "company": company,
        })
    
    return contacts


def _extract_name_near_email(context: str, email: str) -> str:
    """Try to extract a person's name near an email address."""
    # Remove the email from context
    clean = context.replace(email, "").strip()
    
    # Look for capitalized words that could be names
    name_pattern = re.compile(r"\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\b")
    matches = name_pattern.findall(clean)
    
    if matches:
        # Filter out common non-name words
        non_names = {"The", "This", "That", "From", "Dear", "Subject", "Company",
                     "Email", "Phone", "Address", "Title", "Role", "Position",
                     "Name", "Contact", "Recruiter", "Manager", "Director"}
        for match in matches:
            words = match.split()
            if not any(w in non_names for w in words):
                return match
    
    return None


def _extract_title_from_context(context: str) -> str:
    """Extract job title from context."""
    context_lower = context.lower()
    for title in HR_TITLES:
        if title in context_lower:
            # Find the full title text
            idx = context_lower.index(title)
            # Get surrounding text
            start = max(0, idx - 20)
            end = min(len(context), idx + len(title) + 20)
            segment = context[start:end].strip()
            # Clean up
            words = segment.split()
            title_words = []
            for w in words:
                if w[0].isupper() or w.lower() in ["of", "and", "&", "the"]:
                    title_words.append(w)
                elif title_words:
                    break
            if title_words:
                return " ".join(title_words)
            return title.title()
    return None


def _extract_company_from_context(context: str) -> str:
    """Extract company name from context."""
    # Look for patterns like "at CompanyName" or "Company: Name"
    patterns = [
        re.compile(r"(?:at|@)\s+([A-Z][A-Za-z\s&.]+(?:Inc|LLC|Ltd|Corp|Technologies|Solutions|Systems|Labs|Tech)?)", re.IGNORECASE),
        re.compile(r"[Cc]ompany[:\s]+([A-Z][A-Za-z\s&.]+)"),
    ]
    
    for pattern in patterns:
        match = pattern.search(context)
        if match:
            return match.group(1).strip().rstrip(".,;:")
    
    return None


def _clean_text(text) -> str:
    """Clean extracted text."""
    if text is None:
        return None
    text = str(text).strip()
    # Remove extra whitespace
    text = re.sub(r"\s+", " ", text)
    return text if text else None
