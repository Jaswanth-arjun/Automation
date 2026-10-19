"""
Generate a sample test PDF with HR contact data for testing the application.
"""
import os

try:
    from reportlab.lib.pagesizes import letter
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib import colors
except ImportError:
    print("reportlab not installed. Install with: pip install reportlab")
    print("Creating a simple text-based approach instead...")
    
    # Fallback: create with pdfplumber-compatible format using fpdf2
    try:
        from fpdf import FPDF
    except ImportError:
        print("Neither reportlab nor fpdf2 available.")
        print("Install one: pip install reportlab  OR  pip install fpdf2")
        exit(1)
    
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 16)
    pdf.cell(0, 10, "HR Contact List - Sample", new_x="LMARGIN", new_y="NEXT", align="C")
    pdf.ln(10)
    
    pdf.set_font("Helvetica", "B", 10)
    headers = ["Name", "Email", "Title", "Company"]
    col_w = [40, 55, 50, 45]
    for i, h in enumerate(headers):
        pdf.cell(col_w[i], 8, h, border=1, align="C")
    pdf.ln()
    
    contacts = [
        ("John Doe", "john@abctech.com", "Talent Acquisition Recruiter", "ABC Technologies"),
        ("Sarah Smith", "sarah@xyzsolutions.com", "HR Manager", "XYZ Solutions"),
        ("Mike Johnson", "mike.j@innovate.io", "Technical Recruiter", "Innovate Labs"),
        ("Emily Davis", "emily.davis@globalcorp.com", "Senior HR Specialist", "Global Corp"),
        ("Raj Patel", "raj.patel@techstart.in", "Campus Recruiter", "TechStart India"),
    ]
    
    pdf.set_font("Helvetica", "", 9)
    for c in contacts:
        for i, val in enumerate(c):
            pdf.cell(col_w[i], 7, val, border=1)
        pdf.ln()
    
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sample_contacts.pdf")
    pdf.output(out)
    print(f"Sample PDF created at: {out}")
    exit(0)

# ReportLab version
styles = getSampleStyleSheet()
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sample_contacts.pdf")
doc = SimpleDocTemplate(out, pagesize=letter)

elements = []
elements.append(Paragraph("HR Contact List - Sample", styles["Title"]))
elements.append(Spacer(1, 20))

data = [
    ["Name", "Email", "Title", "Company"],
    ["John Doe", "john@abctech.com", "Talent Acquisition Recruiter", "ABC Technologies"],
    ["Sarah Smith", "sarah@xyzsolutions.com", "HR Manager", "XYZ Solutions"],
    ["Mike Johnson", "mike.j@innovate.io", "Technical Recruiter", "Innovate Labs"],
    ["Emily Davis", "emily.davis@globalcorp.com", "Senior HR Specialist", "Global Corp"],
    ["Raj Patel", "raj.patel@techstart.in", "Campus Recruiter", "TechStart India"],
    ["Lisa Wang", "lisa.w@megainc.com", "HR Director", "MegaInc"],
    ["David Brown", "david.brown@startup.co", "People Operations Lead", "Startup Co"],
]

table = Table(data, colWidths=[120, 160, 160, 120])
table.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#6c5ce7")),
    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
    ("FONTSIZE", (0, 0), (-1, -1), 10),
    ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8f8ff")]),
    ("TOPPADDING", (0, 0), (-1, -1), 6),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
]))
elements.append(table)
doc.build(elements)
print(f"Sample PDF created at: {out}")
