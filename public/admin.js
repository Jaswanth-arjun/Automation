/**
 * Admin Dashboard - Job Posting Controller
 */
document.addEventListener('DOMContentLoaded', () => {
  // State
  let mustHaveSkills = [];
  let goodToHaveSkills = [];
  let logoFile = null;
  let importedLogoUrl = '';
  let importedSourceUrl = '';
  let allJobs = [];

  // DOM Elements
  const logoUpload = document.getElementById('logoUpload');
  const logoDropZone = document.getElementById('logoDropZone');
  const logoPreview = document.getElementById('logoPreview');
  const logoPlaceholder = document.getElementById('logoPlaceholder');
  const jobRole = document.getElementById('jobRole');
  const jobCompany = document.getElementById('jobCompany');
  const filterExperience = document.getElementById('filterExperience');
  const filterVisibility = document.getElementById('filterVisibility');
  const filterWorkMode = document.getElementById('filterWorkMode');
  const filterType = document.getElementById('filterType');
  const mustHaveTagsContainer = document.getElementById('mustHaveTagsContainer');
  const mustHaveSkillInput = document.getElementById('mustHaveSkillInput');
  const addMustHaveBtn = document.getElementById('addMustHaveBtn');
  const goodToHaveTagsContainer = document.getElementById('goodToHaveTagsContainer');
  const goodToHaveSkillInput = document.getElementById('goodToHaveSkillInput');
  const addGoodToHaveBtn = document.getElementById('addGoodToHaveBtn');
  const applyLink = document.getElementById('applyLink');
  const jobDescription = document.getElementById('jobDescription');
  const descriptionPreview = document.getElementById('descriptionPreview');
  const postJobBtn = document.getElementById('postJobBtn');
  const clearFormBtn = document.getElementById('clearFormBtn');
  const postedJobsList = document.getElementById('postedJobsList');
  const noJobsMsg = document.getElementById('noJobsMsg');
  const jobsCountBadge = document.getElementById('jobsCountBadge');
  const toastNotification = document.getElementById('toastNotification');
  const toastMessage = document.getElementById('toastMessage');
  const importJobUrl = document.getElementById('importJobUrl');
  const importJobBtn = document.getElementById('importJobBtn');
  const importStatus = document.getElementById('importStatus');

  // ─── Import From Job Link ───
  function setImportStatus(message, isError = false) {
    importStatus.textContent = message;
    importStatus.classList.toggle('hidden', !message);
    importStatus.classList.toggle('is-error', Boolean(isError));
  }

  function setSelectValue(select, value) {
    if (!select || !value) return;
    const wanted = String(value).trim();
    const exists = [...select.options].some((opt) => opt.value.toLowerCase() === wanted.toLowerCase());
    if (!exists) {
      const option = document.createElement('option');
      option.value = wanted;
      option.textContent = wanted;
      select.appendChild(option);
    }
    const match = [...select.options].find((opt) => opt.value.toLowerCase() === wanted.toLowerCase());
    if (match) select.value = match.value;
  }

  function applyImportedJob(job, sourceUrl) {
    jobRole.value = job.title || '';
    jobCompany.value = job.company || '';
    applyLink.value = job.applyLink || sourceUrl || '';
    jobDescription.value = job.description || '';
    renderDescriptionPreview(jobDescription.value);

    setSelectValue(filterWorkMode, job.location || 'Remote');
    setSelectValue(filterType, job.type || 'Full Time');
    setSelectValue(filterExperience, job.category || 'Freshers');
    setSelectValue(filterVisibility, job.category === 'Remote' ? 'Remote' : 'Confidential');

    mustHaveSkills = [...(job.requiredSkills || [])];
    goodToHaveSkills = [...(job.preferredSkills || [])];
    renderSkillTags(mustHaveTagsContainer, mustHaveSkills, 'must');
    renderSkillTags(goodToHaveTagsContainer, goodToHaveSkills, 'good');

    importedLogoUrl = job.companyLogoUrl || '';
    importedSourceUrl = job.sourceUrl || sourceUrl || '';
    logoFile = null;
    if (importedLogoUrl) {
      logoPreview.src = importedLogoUrl;
      logoPreview.classList.remove('hidden');
      logoPlaceholder.classList.add('hidden');
    } else {
      logoPreview.src = '';
      logoPreview.classList.add('hidden');
      logoPlaceholder.classList.remove('hidden');
    }
  }

  async function handleImportJob() {
    const url = importJobUrl.value.trim();
    if (!url) {
      setImportStatus('Paste the public job link first.', true);
      return;
    }

    const originalLabel = importJobBtn.innerHTML;
    importJobBtn.disabled = true;
    importJobBtn.innerHTML = '<span class="btn-icon">⏳</span> Reading link...';
    setImportStatus('Reading the posting — this can take up to 30 seconds on JavaScript careers sites.');

    try {
      const res = await fetch('/api/jobs/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.job) {
        throw new Error(data.error || `That job link could not be read (${res.status}).`);
      }

      applyImportedJob(data.job, data.sourceUrl || url);
      let host = '';
      try { host = new URL(data.sourceUrl || url).hostname.replace(/^www\./, ''); } catch (err) { host = ''; }
      setImportStatus(`✓ Details imported from ${host || 'the link'} — review the fields below, then post the job.`);
      showToast('Job details imported from the link.');
    } catch (err) {
      setImportStatus(err.message || 'That job link could not be read.', true);
      showToast(err.message || 'That job link could not be read.', true);
    } finally {
      importJobBtn.disabled = false;
      importJobBtn.innerHTML = originalLabel;
    }
  }

  importJobBtn.addEventListener('click', handleImportJob);
  importJobUrl.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleImportJob();
    }
  });

  // ─── Logo Upload ───
  logoDropZone.addEventListener('click', () => logoUpload.click());

  logoDropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    logoDropZone.classList.add('dragging');
  });
  logoDropZone.addEventListener('dragleave', () => {
    logoDropZone.classList.remove('dragging');
  });
  logoDropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    logoDropZone.classList.remove('dragging');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleLogoFile(e.dataTransfer.files[0]);
    }
  });

  logoUpload.addEventListener('change', () => {
    if (logoUpload.files && logoUpload.files[0]) {
      handleLogoFile(logoUpload.files[0]);
    }
  });

  function handleLogoFile(file) {
    if (!file.type.startsWith('image/')) {
      showToast('Please upload an image file.', true);
      return;
    }
    logoFile = file;
    const reader = new FileReader();
    reader.onload = (e) => {
      logoPreview.src = e.target.result;
      logoPreview.classList.remove('hidden');
      logoPlaceholder.classList.add('hidden');
    };
    reader.readAsDataURL(file);
  }

  // ─── Skills Tag Manager ───
  function renderSkillTags(container, skills, type) {
    container.innerHTML = '';
    skills.forEach((skill, idx) => {
      const chip = document.createElement('div');
      chip.className = 'tag-chip';
      chip.innerHTML = `
        <span>${escapeHtml(skill)}</span>
        <span class="tag-remove" data-idx="${idx}" data-type="${type}">&times;</span>
      `;
      container.appendChild(chip);
    });

    container.querySelectorAll('.tag-remove').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        const t = e.target.dataset.type;
        if (t === 'must') {
          mustHaveSkills.splice(idx, 1);
          renderSkillTags(mustHaveTagsContainer, mustHaveSkills, 'must');
        } else {
          goodToHaveSkills.splice(idx, 1);
          renderSkillTags(goodToHaveTagsContainer, goodToHaveSkills, 'good');
        }
      });
    });
  }

  function addSkillFromInput(input, skills, container, type) {
    const raw = input.value.trim();
    if (!raw) return;
    // Support comma-separated input
    const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
    parts.forEach(s => {
      if (!skills.includes(s)) skills.push(s);
    });
    input.value = '';
    renderSkillTags(container, skills, type);
  }

  addMustHaveBtn.addEventListener('click', () =>
    addSkillFromInput(mustHaveSkillInput, mustHaveSkills, mustHaveTagsContainer, 'must')
  );
  mustHaveSkillInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addSkillFromInput(mustHaveSkillInput, mustHaveSkills, mustHaveTagsContainer, 'must');
    }
  });

  addGoodToHaveBtn.addEventListener('click', () =>
    addSkillFromInput(goodToHaveSkillInput, goodToHaveSkills, goodToHaveTagsContainer, 'good')
  );
  goodToHaveSkillInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addSkillFromInput(goodToHaveSkillInput, goodToHaveSkills, goodToHaveTagsContainer, 'good');
    }
  });

  // ─── Live Description Preview ───
  jobDescription.addEventListener('input', () => {
    renderDescriptionPreview(jobDescription.value);
  });

  function renderDescriptionPreview(text) {
    if (!text || !text.trim()) {
      descriptionPreview.innerHTML = '<p class="preview-placeholder">Start typing in the description field to see a live preview...</p>';
      return;
    }

    const lines = text.split('\n');
    let html = '';
    let inHashtags = false;
    let hashtagBuf = [];

    // Known heading patterns
    const headingPatterns = [
      /^(must have skills|good to have skills|required skills|preferred skills|key responsibilities|about the opportunity|about the company|who can apply|what you will learn|ideal candidate profile|why join|application deadline|similar jobs|about us|our key services|company industry|headquarters|about|company|job type|work mode|location|internship duration|stipend|application deadline|founded in)/i,
    ];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (!line) {
        if (inHashtags && hashtagBuf.length) {
          html += '<div class="desc-hashtags">' + hashtagBuf.join('') + '</div>';
          hashtagBuf = [];
          inHashtags = false;
        }
        continue;
      }

      // Markdown-style heading (imported postings use "## Section")
      if (/^#{1,6}\s+/.test(line)) {
        const title = line.replace(/^#{1,6}\s+/, '').trim();
        if (title) html += `<h3>${escapeHtml(title)}</h3>`;
        continue;
      }

      // Hashtag line (e.g. #BackendDeveloper #Python)
      if (/^#\w/.test(line)) {
        inHashtags = true;
        const tags = line.match(/#\w[\w]*/g) || [];
        tags.forEach(t => {
          hashtagBuf.push(`<span class="desc-hashtag">${escapeHtml(t)}</span>`);
        });
        continue;
      }

      if (inHashtags && hashtagBuf.length) {
        html += '<div class="desc-hashtags">' + hashtagBuf.join('') + '</div>';
        hashtagBuf = [];
        inHashtags = false;
      }

      // First non-empty line = title header
      if (i === 0 || (i <= 2 && line.includes('|'))) {
        html += `<div class="desc-header-line">${escapeHtml(line)}</div>`;
        continue;
      }

      // Bullet points
      if (/^[•\-\*]\s/.test(line)) {
        html += `<div class="desc-bullet">${escapeHtml(line.replace(/^[•\-\*]\s*/, ''))}</div>`;
        continue;
      }

      // Check for heading patterns (lines ending with colon or matching known headings)
      const cleanLine = line.replace(/:?\s*$/, '');
      const isHeading = headingPatterns.some(p => p.test(cleanLine)) && line.length < 80;
      const endsWithColon = line.endsWith(':') && line.length < 80;

      if (isHeading || endsWithColon) {
        html += `<h3>${escapeHtml(line.replace(/:?\s*$/, ''))}</h3>`;
        continue;
      }

      // Meta-style lines (e.g. "Company: Crossing Infotech")
      const metaMatch = line.match(/^([A-Za-z\s\/]+):\s*(.+)$/);
      if (metaMatch && metaMatch[1].length < 30) {
        html += `<div class="desc-paragraph"><strong>${escapeHtml(metaMatch[1])}:</strong> ${escapeHtml(metaMatch[2])}</div>`;
        continue;
      }

      // Regular paragraph
      html += `<div class="desc-paragraph">${escapeHtml(line)}</div>`;
    }

    if (hashtagBuf.length) {
      html += '<div class="desc-hashtags">' + hashtagBuf.join('') + '</div>';
    }

    descriptionPreview.innerHTML = html;
  }

  // ─── Post Job ───
  postJobBtn.addEventListener('click', async () => {
    const role = jobRole.value.trim();
    const company = jobCompany.value.trim();
    const applyUrl = applyLink.value.trim();
    const description = jobDescription.value.trim();

    if (!role || !company || !applyUrl || !description) {
      showToast('Please fill in all required fields (Role, Company, Apply Link, Description).', true);
      return;
    }

    postJobBtn.disabled = true;
    postJobBtn.innerHTML = '<span class="btn-icon">⏳</span> Posting...';

    try {
      // Upload logo first if present
      let logoPath = '';
      if (logoFile) {
        const formData = new FormData();
        formData.append('logo', logoFile);
        const logoRes = await fetch('/api/jobs/upload-logo', { method: 'POST', body: formData });
        const logoJson = await logoRes.json();
        if (logoRes.ok && logoJson.path) {
          logoPath = logoJson.path;
        }
      }

      const jobPayload = {
        logo: logoPath || importedLogoUrl,
        role,
        company,
        filters: {
          experience: filterExperience.value,
          visibility: filterVisibility.value,
          workMode: filterWorkMode.value,
          type: filterType.value,
        },
        mustHaveSkills,
        goodToHaveSkills,
        applyLink: applyUrl,
        description,
        ...(importedSourceUrl ? { sourceUrl: importedSourceUrl } : {}),
      };

      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(jobPayload),
      });

      const json = await res.json();

      if (res.ok) {
        showToast('🎉 Job posted successfully!');
        clearForm();
        fetchJobs();
      } else {
        showToast(json.error || 'Failed to post job.', true);
      }
    } catch (err) {
      showToast('Network error: ' + err.message, true);
    } finally {
      postJobBtn.disabled = false;
      postJobBtn.innerHTML = '<span class="btn-icon">🚀</span> Post Job';
    }
  });

  // ─── Clear Form ───
  clearFormBtn.addEventListener('click', clearForm);

  function clearForm() {
    jobRole.value = '';
    jobCompany.value = '';
    applyLink.value = '';
    jobDescription.value = '';
    filterExperience.selectedIndex = 0;
    filterVisibility.selectedIndex = 0;
    filterWorkMode.selectedIndex = 2; // Remote
    filterType.selectedIndex = 3; // Full time
    mustHaveSkills = [];
    goodToHaveSkills = [];
    logoFile = null;
    importedLogoUrl = '';
    importedSourceUrl = '';
    importJobUrl.value = '';
    setImportStatus('');
    logoPreview.src = '';
    logoPreview.classList.add('hidden');
    logoPlaceholder.classList.remove('hidden');
    renderSkillTags(mustHaveTagsContainer, mustHaveSkills, 'must');
    renderSkillTags(goodToHaveTagsContainer, goodToHaveSkills, 'good');
    renderDescriptionPreview('');
  }

  // ─── Fetch & Render Posted Jobs ───
  async function fetchJobs() {
    try {
      const res = await fetch('/api/jobs');
      const json = await res.json();
      if (Array.isArray(json)) {
        allJobs = json;
        renderPostedJobs();
      }
    } catch (err) {
      console.warn('Failed to fetch jobs:', err.message);
    }
  }

  function renderPostedJobs() {
    jobsCountBadge.textContent = allJobs.length;

    if (allJobs.length === 0) {
      postedJobsList.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">📭</span>
          <p>No jobs posted yet. Create your first job posting!</p>
        </div>
      `;
      return;
    }

    postedJobsList.innerHTML = '';
    // Show newest first
    [...allJobs].reverse().forEach((job) => {
      const item = document.createElement('div');
      item.className = 'posted-job-item';

      const logoHtml = job.logo
        ? `<img src="${escapeHtml(job.logo)}" alt="Logo" class="pj-logo" />`
        : `<div class="pj-logo-placeholder">🏢</div>`;

      const filters = job.filters || {};
      const filterTags = Object.values(filters)
        .filter(Boolean)
        .map(f => `<span class="pj-filter-tag">${escapeHtml(f)}</span>`)
        .join('');

      const posted = job.postedAt ? new Date(job.postedAt).toLocaleDateString('en-IN', {
        day: 'numeric', month: 'short', year: 'numeric'
      }) : '';

      item.innerHTML = `
        ${logoHtml}
        <div class="pj-info">
          <div class="pj-role">${escapeHtml(job.role || '')}</div>
          <div class="pj-company">${escapeHtml(job.company || '')}</div>
          <div class="pj-filters">${filterTags}</div>
          <div class="pj-date">Posted: ${posted}</div>
        </div>
        <button class="pj-delete" data-id="${escapeHtml(job.id)}" title="Delete this job">🗑️</button>
      `;

      postedJobsList.appendChild(item);
    });

    // Delete handlers
    postedJobsList.querySelectorAll('.pj-delete').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.dataset.id;
        if (!confirm('Are you sure you want to delete this job posting?')) return;

        try {
          const res = await fetch(`/api/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' });
          if (res.ok) {
            try {
              const saved = JSON.parse(localStorage.getItem('hamzo_admin_jobs') || '[]');
              const updated = saved.filter((j) => String(j.id) !== String(id));
              localStorage.setItem('hamzo_admin_jobs', JSON.stringify(updated));
              window.dispatchEvent(new Event('admin_jobs_updated'));
            } catch {}
            showToast('Job deleted.');
            fetchJobs();
          } else {
            const json = await res.json();
            showToast(json.error || 'Failed to delete.', true);
          }
        } catch (err) {
          showToast('Error: ' + err.message, true);
        }
      });
    });
  }

  // ─── Employee contacts (admin only) ───
  const contactName = document.getElementById('contactName');
  const contactCompany = document.getElementById('contactCompany');
  const contactRole = document.getElementById('contactRole');
  const contactEmail = document.getElementById('contactEmail');
  const addContactBtn = document.getElementById('addContactBtn');
  const uploadCompany = document.getElementById('uploadCompany');
  const uploadContactsInput = document.getElementById('uploadContactsInput');
  const contactsList = document.getElementById('contactsList');
  const contactsCountBadge = document.getElementById('contactsCountBadge');
  const contactsStatus = document.getElementById('contactsStatus');

  function setContactsStatus(message, isError = false) {
    contactsStatus.textContent = message;
    contactsStatus.classList.toggle('hidden', !message);
    contactsStatus.classList.toggle('is-error', Boolean(isError));
  }

  const contactsSearch = document.getElementById('contactsSearch');
  const CONTACT_RENDER_LIMIT = 150;
  let allContacts = [];

  function renderContacts(contacts) {
    allContacts = contacts;
    const query = contactsSearch.value.trim().toLowerCase();
    const filtered = query
      ? contacts.filter((contact) => [contact.name, contact.company, contact.role, contact.email]
        .filter(Boolean).join(' ').toLowerCase().includes(query))
      : contacts;
    const visible = filtered.slice(0, CONTACT_RENDER_LIMIT);

    contactsCountBadge.textContent = query
      ? `${filtered.length} of ${contacts.length} contacts`
      : `${contacts.length} contact${contacts.length === 1 ? '' : 's'}`;

    if (!filtered.length) {
      contactsList.innerHTML = contacts.length
        ? '<div class="empty-state"><span class="empty-icon">🔍</span><p>No contact matches that search.</p></div>'
        : '<div class="empty-state"><span class="empty-icon">📫</span><p>No employee contacts saved yet.</p></div>';
      return;
    }

    contactsList.innerHTML = visible.map((contact) => `
      <div class="contact-item">
        <div class="contact-info">
          <strong>${escapeHtml(contact.name || '')}</strong>
          <div class="contact-meta">${escapeHtml([contact.role, contact.company, contact.email].filter(Boolean).join(' · '))}</div>
          ${contact.details ? `<div class="contact-details">${escapeHtml(contact.details)}</div>` : ''}
        </div>
        <button class="contact-delete" data-id="${escapeHtml(contact.id)}" title="Remove contact">🗑️</button>
      </div>
    `).join('') + (filtered.length > visible.length
      ? `<p class="contacts-more">Showing the first ${visible.length} of ${filtered.length} contacts — use the search box to narrow the list.</p>`
      : '');

    contactsList.querySelectorAll('.contact-delete').forEach((btn) => {
      btn.addEventListener('click', async (event) => {
        const id = event.currentTarget.dataset.id;
        if (!confirm('Remove this employee contact?')) return;
        try {
          await fetch(`/api/employees/${encodeURIComponent(id)}`, { method: 'DELETE' });
          await loadContacts();
          showToast('Contact removed.');
        } catch (err) {
          showToast('Could not remove that contact.', true);
        }
      });
    });
  }

  async function loadContacts() {
    try {
      const res = await fetch('/api/employees');
      const rows = await res.json();
      renderContacts(Array.isArray(rows) ? rows : []);
    } catch (err) {
      console.warn('Failed to load employee contacts:', err.message);
    }
  }

  async function handleAddContact() {
    const payload = {
      name: contactName.value.trim(),
      company: contactCompany.value.trim(),
      role: contactRole.value.trim(),
      email: contactEmail.value.trim(),
    };

    if (!payload.name || !payload.company || !payload.role || !payload.email) {
      setContactsStatus('Name, company, role and email are all required.', true);
      return;
    }

    addContactBtn.disabled = true;
    setContactsStatus('');
    try {
      const res = await fetch('/api/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save that contact.');

      contactName.value = '';
      contactRole.value = '';
      contactEmail.value = '';
      setContactsStatus(`✓ ${data.employee?.name || payload.name} saved for ${payload.company}. Candidates applying to ${payload.company} will see this contact.`);
      await loadContacts();
    } catch (err) {
      setContactsStatus(err.message, true);
    } finally {
      addContactBtn.disabled = false;
    }
  }

  async function handleContactsUpload(file) {
    if (!file) return;
    const body = new FormData();
    body.append('file', file);
    if (uploadCompany.value.trim()) body.append('company', uploadCompany.value.trim());

    setContactsStatus('Reading the file...');
    try {
      const res = await fetch('/api/employees/upload-pdf', { method: 'POST', body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not read that file.');
      setContactsStatus(`✓ Saved ${data.saved || 0} contact${data.saved === 1 ? '' : 's'} from ${file.name}.`);
      await loadContacts();
    } catch (err) {
      setContactsStatus(err.message, true);
    }
  }

  contactsSearch.addEventListener('input', () => renderContacts(allContacts));

  addContactBtn.addEventListener('click', handleAddContact);
  [contactName, contactCompany, contactRole, contactEmail].forEach((input) => {
    input.addEventListener('keypress', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        handleAddContact();
      }
    });
  });

  uploadContactsInput.addEventListener('change', () => {
    const file = uploadContactsInput.files?.[0];
    uploadContactsInput.value = '';
    handleContactsUpload(file);
  });

  loadContacts();

  // ─── Toast ───
  function showToast(msg, isError = false) {
    toastMessage.textContent = msg;
    toastNotification.className = isError ? 'toast show error' : 'toast show';
    setTimeout(() => {
      toastNotification.className = 'toast hidden';
    }, 3000);
  }

  // ─── Helpers ───
  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ─── Init ───
  fetchJobs();
});
