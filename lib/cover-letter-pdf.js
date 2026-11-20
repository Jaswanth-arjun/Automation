import PDFDocument from 'pdfkit';

export function renderCoverLetterPdf(coverLetter = {}, company = '') {
  return new Promise((resolve, reject) => {
    // A4 dimensions in points: 595.28 x 841.89
    const doc = new PDFDocument({
      size: 'A4',
      margin: 40,
      autoFirstPage: true,
      bufferPages: false,
    });

    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
    doc.on('error', reject);

    const name = coverLetter.applicantName || 'Applicant';
    const comp = coverLetter.companyName || company || 'Company';
    const paras = Array.isArray(coverLetter.paragraphs) ? coverLetter.paragraphs : [];

    // Outer neat formal border around the whole A4 page
    const pageWidth = 595.28;
    const pageHeight = 841.89;
    const borderMargin = 28;
    const borderWidth = pageWidth - borderMargin * 2;
    const borderHeight = pageHeight - borderMargin * 2;

    doc.rect(borderMargin, borderMargin, borderWidth, borderHeight)
       .lineWidth(1.2)
       .strokeColor('#334155')
       .stroke();

    // Content placement
    const contentX = 52;
    const contentWidth = pageWidth - contentX * 2;
    let y = 50;

    // Title: COVER LETTER
    doc.font('Helvetica-Bold')
       .fontSize(16)
       .fillColor('#0f172a')
       .text('COVER LETTER', contentX, y, { align: 'center', width: contentWidth, characterSpacing: 1.5 });

    y += 30;

    // Applicant Details
    doc.font('Helvetica-Bold')
       .fontSize(11)
       .fillColor('#0f172a')
       .text(name, contentX, y);
    y += 15;

    doc.font('Helvetica')
       .fontSize(9.5)
       .fillColor('#334155');

    if (coverLetter.applicantAddress) {
      doc.text(coverLetter.applicantAddress, contentX, y);
      y += 14;
    }

    const contactLine = [coverLetter.applicantEmail, coverLetter.applicantPhone].filter(Boolean).join(' | ');
    if (contactLine) {
      doc.text(contactLine, contentX, y);
      y += 14;
    }

    if (coverLetter.date) {
      doc.fillColor('#64748b').text(coverLetter.date, contentX, y);
      y += 18;
    }

    // Recipient Details
    doc.font('Helvetica')
       .fontSize(9.5)
       .fillColor('#334155')
       .text(coverLetter.hiringManager || 'Hiring Manager', contentX, y);
    y += 14;

    doc.font('Helvetica-Bold')
       .fontSize(10)
       .fillColor('#0f172a')
       .text(comp, contentX, y);
    y += 14;

    if (coverLetter.companyAddress) {
      doc.font('Helvetica')
         .fontSize(9.5)
         .fillColor('#334155')
         .text(coverLetter.companyAddress, contentX, y);
      y += 18;
    } else {
      y += 6;
    }

    // Salutation
    doc.font('Helvetica-Bold')
       .fontSize(10)
       .fillColor('#0f172a')
       .text(coverLetter.salutation || 'Dear Hiring Manager,', contentX, y);
    y += 18;

    // Paragraphs
    doc.font('Helvetica')
       .fontSize(9.5)
       .fillColor('#334155');

    for (const p of paras) {
      doc.text(String(p || ''), contentX, y, {
        width: contentWidth,
        align: 'justify',
        lineGap: 3.5,
      });
      y = doc.y + 12;
    }

    // Sign-off
    y = Math.max(y + 8, pageHeight - 110);
    doc.font('Helvetica')
       .fontSize(9.5)
       .fillColor('#334155')
       .text(coverLetter.signOff || 'Best Regards,', contentX, y);
    y += 16;

    doc.font('Helvetica-Bold')
       .fontSize(11)
       .fillColor('#0f172a')
       .text(name, contentX, y);

    doc.end();
  });
}
