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
  let editingJobId = null;

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
    editingJobId = null;
    updateFormMode();
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

  function updateFormMode() {
    postJobBtn.textContent = editingJobId ? 'Save changes' : 'Publish job';
    clearFormBtn.textContent = editingJobId ? 'Cancel edit' : 'Clear form';
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

    const editingId = editingJobId;
    postJobBtn.disabled = true;
    postJobBtn.textContent = editingId ? 'Saving...' : 'Posting...';

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

      const res = await fetch(editingId ? `/api/jobs/${encodeURIComponent(editingId)}` : '/api/jobs', {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(jobPayload),
      });

      const json = await res.json();

      if (res.ok) {
        showToast(editingId
          ? 'Job updated successfully.'
          : json.existing
            ? 'ℹ️ This job is already posted — no duplicate created.'
            : '🎉 Job posted successfully!');
        clearForm();
        fetchJobs();
      } else {
        showToast(json.error || 'Failed to post job.', true);
      }
    } catch (err) {
      showToast('Network error: ' + err.message, true);
    } finally {
      postJobBtn.disabled = false;
      updateFormMode();
    }
  });

  // ─── Clear Form ───
  clearFormBtn.addEventListener('click', clearForm);

  function clearForm() {
    editingJobId = null;
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
    updateFormMode();
  }

  function editJob(job) {
    clearForm();
    editingJobId = String(job.id);

    jobRole.value = job.role || '';
    jobCompany.value = job.company || '';
    applyLink.value = job.applyLink || '';
    jobDescription.value = job.description || '';

    const filters = job.filters || {};
    setSelectValue(filterExperience, filters.experience || filters.category || 'Freshers');
    setSelectValue(filterVisibility, filters.visibility || 'Confidential');
    setSelectValue(filterWorkMode, filters.workMode || filters.location || 'Remote');
    setSelectValue(filterType, filters.type || 'Full Time');

    mustHaveSkills = Array.isArray(job.mustHaveSkills) ? [...job.mustHaveSkills] : [];
    goodToHaveSkills = Array.isArray(job.goodToHaveSkills) ? [...job.goodToHaveSkills] : [];
    renderSkillTags(mustHaveTagsContainer, mustHaveSkills, 'must');
    renderSkillTags(goodToHaveTagsContainer, goodToHaveSkills, 'good');
    renderDescriptionPreview(jobDescription.value);

    importedLogoUrl = job.logo || '';
    importedSourceUrl = job.sourceUrl || '';
    if (importedLogoUrl) {
      logoPreview.src = importedLogoUrl;
      logoPreview.classList.remove('hidden');
      logoPlaceholder.classList.add('hidden');
    }

    updateFormMode();
    document.querySelector('.post-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
    jobRole.focus({ preventScroll: true });
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
        .filter((value) => typeof value === 'string' && value.trim())
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
        <div class="pj-actions">
          <button class="pj-edit" data-id="${escapeHtml(job.id)}" title="Edit this job" aria-label="Edit this job">✏️</button>
          <button class="pj-delete" data-id="${escapeHtml(job.id)}" title="Delete this job" aria-label="Delete this job">🗑️</button>
        </div>
      `;

      postedJobsList.appendChild(item);
    });

    postedJobsList.querySelectorAll('.pj-edit').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        const job = allJobs.find((item) => String(item.id) === event.currentTarget.dataset.id);
        if (job) editJob(job);
      });
    });

    // Delete handlers
    postedJobsList.querySelectorAll('.pj-delete').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.dataset.id;
        if (!confirm('Are you sure you want to delete this job posting?')) return;

        try {
          const res = await fetch(`/api/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' });
          // 404 means the posting is already gone server-side (e.g. a stale
          // cached entry) — still clean it up locally so the card disappears.
          if (res.ok || res.status === 404) {
            try {
              const saved = JSON.parse(localStorage.getItem('hamzooh_admin_jobs') || '[]');
              const updated = saved.filter((j) => String(j.id) !== String(id));
              localStorage.setItem('hamzooh_admin_jobs', JSON.stringify(updated));
              window.dispatchEvent(new Event('admin_jobs_updated'));
            } catch {}
            showToast(res.ok ? 'Job deleted.' : 'Job was already removed.');
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

  // ─── Candidates database + batch mailer ───
  const candidatesBody = document.getElementById('candidatesBody');
  const candidatesTableWrap = document.getElementById('candidatesTableWrap');
  const candidatesEmpty = document.getElementById('candidatesEmpty');
  const candidatesCountBadge = document.getElementById('candidatesCountBadge');
  const candidatesFilters = document.getElementById('candidatesFilters');
  const candidatesSearch = document.getElementById('candidatesSearch');
  const candidatesRefreshBtn = document.getElementById('candidatesRefreshBtn');
  const batchMailToggle = document.getElementById('batchMailToggle');
  const batchMailForm = document.getElementById('batchMailForm');
  const batchMailTarget = document.getElementById('batchMailTarget');
  const batchMailSubject = document.getElementById('batchMailSubject');
  const batchMailBody = document.getElementById('batchMailBody');
  const batchMailSend = document.getElementById('batchMailSend');
  const batchMailCancel = document.getElementById('batchMailCancel');
  const batchMailStatus = document.getElementById('batchMailStatus');
  const batchMailSummary = document.getElementById('batchMailSummary');

  const BATCH_MAIL_DEFAULT = `Hi {{name}},\n\nWe have an exciting opportunity for the {{batch}} batch and thought of you.\n\nRole: \nLocation: \nApply here: [Insert Job Link]\nApplication deadline: [Insert Deadline]\n\nGood luck,\nHamzooh Careers`;

  let candidatesData = { candidates: [], totalCandidates: 0, batchCounts: {} };
  let candidateBatch = 'ALL';

  function initialsOf(candidate) {
    const source = String(candidate.fullName || '').trim() || String(candidate.email || '').split('@')[0] || 'C';
    return source.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join('') || 'C';
  }

  function formatCandidateDate(iso) {
    if (!iso) return '—';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function batchLabel(batch) {
    return batch && batch !== 'Unassigned' ? `${batch} batch` : 'Batch not set';
  }

  function filteredCandidates() {
    const query = candidatesSearch.value.trim().toLowerCase();
    return candidatesData.candidates.filter((candidate) => {
      if (candidateBatch !== 'ALL' && (candidate.batch || 'Unassigned') !== candidateBatch) return false;
      if (!query) return true;
      return [candidate.fullName, candidate.email, candidate.phone, candidate.institution, ...(candidate.skills || [])]
        .filter(Boolean).join(' ').toLowerCase().includes(query);
    });
  }

  function renderCandidateFilters() {
    const counts = candidatesData.batchCounts || {};
    const keys = Object.keys(counts).sort((a, b) => {
      const yearA = /^20\d{2}$/.test(a) ? Number(a) : 0;
      const yearB = /^20\d{2}$/.test(b) ? Number(b) : 0;
      return yearB - yearA || a.localeCompare(b);
    });
    const chips = [`<button type="button" class="candidate-chip ${candidateBatch === 'ALL' ? 'is-active' : ''}" data-batch="ALL">All batches <span>${candidatesData.totalCandidates}</span></button>`];
    keys.forEach((key) => {
      chips.push(`<button type="button" class="candidate-chip ${candidateBatch === key ? 'is-active' : ''}" data-batch="${escapeHtml(key)}">${escapeHtml(key)} <span>${counts[key]}</span></button>`);
    });
    candidatesFilters.innerHTML = chips.join('');
    candidatesFilters.querySelectorAll('.candidate-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        candidateBatch = chip.dataset.batch || 'ALL';
        renderCandidateFilters();
        renderCandidates();
      });
    });
  }

  function renderCandidates() {
    const rows = filteredCandidates();
    const total = candidatesData.totalCandidates;
    candidatesCountBadge.textContent = `${total} candidate${total === 1 ? '' : 's'}`;
    candidatesEmpty.classList.toggle('hidden', rows.length > 0);
    candidatesTableWrap.classList.toggle('hidden', rows.length === 0);

    if (!rows.length) {
      candidatesEmpty.querySelector('p').textContent = total
        ? 'No candidate matches this filter. Try another batch or clear the search.'
        : 'No candidates yet. Students appear here as soon as they sign in or save their profile.';
      candidatesBody.innerHTML = '';
      return;
    }

    candidatesBody.innerHTML = rows.map((candidate) => {
      const skills = Array.isArray(candidate.skills) ? candidate.skills : [];
      const skillChips = skills.length
        ? `<div class="candidate-skills">${skills.slice(0, 3).map((skill) => `<span>${escapeHtml(skill)}</span>`).join('')}${skills.length > 3 ? `<em>+${skills.length - 3}</em>` : ''}</div>`
        : '<span class="candidate-muted">—</span>';
      return `
        <tr>
          <td>
            <div class="candidate-person">
              <span class="candidate-avatar">${escapeHtml(initialsOf(candidate))}</span>
              <div>
                <strong>${escapeHtml(candidate.fullName || 'Unnamed student')}</strong>
                <small>${escapeHtml(candidate.institution || 'Institution not set')}</small>
              </div>
            </div>
          </td>
          <td><a class="candidate-email" href="mailto:${escapeHtml(candidate.email)}">${escapeHtml(candidate.email)}</a></td>
          <td class="hide-sm candidate-muted">${escapeHtml(candidate.phone || '—')}</td>
          <td><span class="candidate-badge ${candidate.batch ? '' : 'is-empty'}">${escapeHtml(candidate.batch || 'Not set')}</span></td>
          <td class="hide-sm">${skillChips}</td>
          <td class="hide-sm candidate-muted">${escapeHtml(formatCandidateDate(candidate.registeredAt))}</td>
        </tr>
      `;
    }).join('');
  }

  async function loadCandidates() {
    candidatesRefreshBtn.disabled = true;
    candidatesRefreshBtn.textContent = 'Refreshing…';
    try {
      const res = await fetch('/api/candidates');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not load candidates.');
      candidatesData = {
        candidates: Array.isArray(data.candidates) ? data.candidates : [],
        totalCandidates: Number(data.totalCandidates) || 0,
        batchCounts: data.batchCounts || {},
      };
    } catch (err) {
      candidatesData = { candidates: [], totalCandidates: 0, batchCounts: {} };
      showToast(err.message || 'Could not load candidates.', true);
    } finally {
      candidatesRefreshBtn.disabled = false;
      candidatesRefreshBtn.textContent = 'Refresh';
      renderCandidateFilters();
      renderCandidates();
      renderBatchMailTargets();
    }
  }

  function setBatchMailStatus(message, isError = false) {
    batchMailStatus.textContent = message;
    batchMailStatus.classList.toggle('hidden', !message);
    batchMailStatus.classList.toggle('is-error', Boolean(isError));
  }

  function currentTargetCount() {
    if (batchMailTarget.value === 'ALL') return candidatesData.totalCandidates;
    return candidatesData.batchCounts?.[batchMailTarget.value] || 0;
  }

  function renderBatchMailTargets() {
    const counts = candidatesData.batchCounts || {};
    const keys = Object.keys(counts).sort((a, b) => b.localeCompare(a));
    const options = [`<option value="ALL">All batches (${candidatesData.totalCandidates} recipients)</option>`];
    keys.forEach((key) => {
      options.push(`<option value="${escapeHtml(key)}">${escapeHtml(key)} (${counts[key]} recipient${counts[key] === 1 ? '' : 's'})</option>`);
    });
    batchMailTarget.innerHTML = options.join('');
    if (candidateBatch !== 'ALL' && keys.includes(candidateBatch)) batchMailTarget.value = candidateBatch;
    updateBatchMailCount();
  }

  function updateBatchMailCount() {
    const count = currentTargetCount();
    batchMailSend.textContent = `Send to ${count} candidate${count === 1 ? '' : 's'}`;
    batchMailSend.disabled = count === 0;
    const target = batchMailTarget.value;
    batchMailSummary.textContent = target === 'ALL'
      ? 'Pick a cohort and send one update to everyone in it.'
      : `Sending to the ${batchLabel(target)}. Each student gets a private copy.`;
  }

  function bodyToHtml(text) {
    return String(text || '')
      .replace(/\r\n/g, '\n')
      .split(/\n{2,}/)
      .map((block) => `<p style="margin:0 0 14px;">${escapeHtml(block).replace(/\n/g, '<br />')}</p>`)
      .join('');
  }

  async function sendBatchMail() {
    const target = batchMailTarget.value;
    const subject = batchMailSubject.value.trim();
    const body = batchMailBody.value.trim();
    const count = currentTargetCount();

    if (!subject || !body) {
      setBatchMailStatus('Add a subject and a message before sending.', true);
      return;
    }
    const ok = confirm(`Send this email to ${count} candidate${count === 1 ? '' : 's'} in ${target === 'ALL' ? 'all batches' : `the ${batchLabel(target)}`}?`);
    if (!ok) return;

    batchMailSend.disabled = true;
    setBatchMailStatus(`Sending to ${count} candidate${count === 1 ? '' : 's'}…`);
    try {
      const res = await fetch('/api/admin/broadcast-batch-mail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetBatch: target, subject, htmlBody: bodyToHtml(body), plainText: body, previewMode: false }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not send this broadcast.');
      setBatchMailStatus(`✓ Sent to ${data.sentCount || 0} candidate${data.sentCount === 1 ? '' : 's'}${data.failedCount ? ` · ${data.failedCount} failed` : ''}.`);
      showToast(`Broadcast sent to ${data.sentCount || 0} candidate${data.sentCount === 1 ? '' : 's'}.`);
      batchMailForm.classList.add('hidden');
      batchMailToggle.classList.remove('hidden');
      batchMailSubject.value = '';
      batchMailBody.value = BATCH_MAIL_DEFAULT;
    } catch (err) {
      setBatchMailStatus(err.message, true);
    } finally {
      updateBatchMailCount();
    }
  }

  candidatesSearch.addEventListener('input', renderCandidates);
  candidatesRefreshBtn.addEventListener('click', loadCandidates);

  batchMailToggle.addEventListener('click', () => {
    batchMailForm.classList.remove('hidden');
    batchMailToggle.classList.add('hidden');
    if (!batchMailBody.value.trim()) batchMailBody.value = BATCH_MAIL_DEFAULT;
    updateBatchMailCount();
    batchMailSubject.focus();
  });

  batchMailCancel.addEventListener('click', () => {
    batchMailForm.classList.add('hidden');
    batchMailToggle.classList.remove('hidden');
    setBatchMailStatus('');
  });

  batchMailTarget.addEventListener('change', updateBatchMailCount);
  batchMailSend.addEventListener('click', sendBatchMail);

  loadCandidates();

  // ─── Subscriptions, premium switch & analytics ───
  const premiumStatePill = document.getElementById('premiumStatePill');
  const premiumToggle = document.getElementById('premiumToggle');
  const premiumToggleLabel = document.getElementById('premiumToggleLabel');
  const premiumSwitchHint = document.getElementById('premiumSwitchHint');
  const subsRefreshBtn = document.getElementById('subsRefreshBtn');
  const subsStats = document.getElementById('subsStats');
  const subsRevenue = document.getElementById('subsRevenue');
  const subsSettingsSave = document.getElementById('subsSettingsSave');
  const subsSweepBtn = document.getElementById('subsSweepBtn');
  const subsSettingsMeta = document.getElementById('subsSettingsMeta');
  const subsSettingsStatus = document.getElementById('subsSettingsStatus');
  const subsUserSearch = document.getElementById('subsUserSearch');
  const subsUserFilter = document.getElementById('subsUserFilter');
  const subsUserSort = document.getElementById('subsUserSort');
  const subsUsersBody = document.getElementById('subsUsersBody');
  const subsUsersEmpty = document.getElementById('subsUsersEmpty');
  const subsUserCount = document.getElementById('subsUserCount');
  const subsPager = document.getElementById('subsPager');
  const subsCsvBtn = document.getElementById('subsCsvBtn');
  const subsTxStatus = document.getElementById('subsTxStatus');
  const subsTxSearch = document.getElementById('subsTxSearch');
  const subsTxBody = document.getElementById('subsTxBody');
  const subsTxEmpty = document.getElementById('subsTxEmpty');
  const subsTxCount = document.getElementById('subsTxCount');
  const grantModal = document.getElementById('grantModal');
  const grantUserLine = document.getElementById('grantUserLine');
  const grantReason = document.getElementById('grantReason');
  const grantDays = document.getElementById('grantDays');
  const grantStatus = document.getElementById('grantStatus');
  const grantSubmit = document.getElementById('grantSubmit');
  const grantClose = document.getElementById('grantClose');
  const grantCancel = document.getElementById('grantCancel');
  const revokeModal = document.getElementById('revokeModal');
  const revokeUserLine = document.getElementById('revokeUserLine');
  const revokeReason = document.getElementById('revokeReason');
  const revokeStatus = document.getElementById('revokeStatus');
  const revokeSubmit = document.getElementById('revokeSubmit');
  const revokeClose = document.getElementById('revokeClose');
  const revokeCancel = document.getElementById('revokeCancel');
  const userModal = document.getElementById('userModal');
  const userModalTitle = document.getElementById('userModalTitle');
  const userModalBody = document.getElementById('userModalBody');
  const userModalClose = document.getElementById('userModalClose');

  const subsInputs = {
    priceMonthly: document.getElementById('priceMonthly'),
    priceYearly: document.getElementById('priceYearly'),
    freeContacts: document.getElementById('freeContacts'),
    freeResume: document.getElementById('freeResume'),
    freeAi: document.getElementById('freeAi'),
    freeLiCampaigns: document.getElementById('freeLiCampaigns'),
    freeLiRequests: document.getElementById('freeLiRequests'),
    freeAutoApply: document.getElementById('freeAutoApply'),
    proResume: document.getElementById('proResume'),
    proAi: document.getElementById('proAi'),
    proLiRequestsPerCampaign: document.getElementById('proLiRequestsPerCampaign'),
    freeLiRequestsPerCampaign: document.getElementById('freeLiRequestsPerCampaign'),
  };

  const subsState = { page: 1, pageSize: 8, search: '', filter: 'all', sort: 'createdAt', dir: 'desc' };
  const txState = { status: 'all', search: '' };
  let billingSettings = null;
  let billingBlocked = false;
  let grantTarget = null;
  let revokeTarget = null;

  const inr = (value) => `₹${Number(value || 0).toLocaleString('en-IN')}`;
  const fmtDate = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  };
  const fmtDateTime = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };
  const pretty = (value) => String(value || '').replace(/_/g, ' ');

  function setSubsStatus(el, message, isError = false) {
    el.textContent = message;
    el.classList.toggle('hidden', !message);
    el.classList.toggle('is-error', Boolean(isError));
  }

  async function billingFetch(path, options = {}) {
    const token = localStorage.getItem('hamzooh_token')
      || localStorage.getItem('hamzo_token')
      || localStorage.getItem('mailmind_token')
      || '';
    let userEmail = '';
    try {
      const stored = localStorage.getItem('wayin_user') || localStorage.getItem('hamzooh_user') || '';
      userEmail = JSON.parse(stored)?.email || '';
    } catch {}
    const headers = {
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(userEmail ? { 'X-User-Email': userEmail } : {}),
    };
    const res = await fetch(path, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `Request failed (${res.status})`);
      err.status = res.status;
      err.code = data.code || '';
      throw err;
    }
    return data;
  }

  function billingPost(path, body) {
    return billingFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  }

  function statCard(label, value, hint, tone = '') {
    return `
      <div class="subs-stat ${tone}">
        <span class="subs-stat-label">${escapeHtml(label)}</span>
        <strong class="subs-stat-value">${escapeHtml(value)}</strong>
        ${hint ? `<span class="subs-stat-hint">${escapeHtml(hint)}</span>` : ''}
      </div>
    `;
  }

  function renderStats(stats) {
    const t = stats.totals || {};
    subsStats.innerHTML = [
      statCard('Registered users', t.users || 0, 'Accounts in billing store'),
      statCard('Free users', t.free || 0, 'No active entitlement'),
      statCard('Active Pro', t.pro || 0, 'Paid + admin granted', 'is-accent'),
      statCard('Pro monthly', t.monthly || 0, 'Active paid monthly'),
      statCard('Pro yearly', t.yearly || 0, 'Active paid yearly'),
      statCard('Admin granted', t.adminGranted || 0, 'Manual premium, no payment'),
      statCard('Expired', t.expired || 0, 'Downgraded to Free'),
      statCard('Cancelled', t.cancelled || 0, 'Cancelled subscriptions'),
      statCard('Payments', `${t.paymentsOk || 0}`, `${t.paymentsFailed || 0} failed`, ''),
      statCard('Total revenue', inr(t.revenue || 0), `${inr(stats.revenue?.thisMonth || 0)} this month`, 'is-gold'),
    ].join('');

    const rzp = stats.razorpay || {};
    subsRevenue.innerHTML = `
      <div class="subs-revenue-card">
        <h4>Revenue</h4>
        <div class="subs-rev-grid">
          <div><span>Total</span><strong>${inr(stats.revenue?.total || 0)}</strong></div>
          <div><span>Monthly plans</span><strong>${inr(stats.revenue?.monthly || 0)}</strong></div>
          <div><span>Yearly plans</span><strong>${inr(stats.revenue?.yearly || 0)}</strong></div>
          <div><span>This month</span><strong>${inr(stats.revenue?.thisMonth || 0)}</strong></div>
        </div>
      </div>
      <div class="subs-revenue-card">
        <h4>Purchases & conversion</h4>
        <div class="subs-rev-grid">
          <div><span>Monthly purchases</span><strong>${t.monthlyPurchases || 0}</strong></div>
          <div><span>Yearly purchases</span><strong>${t.yearlyPurchases || 0}</strong></div>
          <div><span>Successful payments</span><strong>${t.paymentsOk || 0}</strong></div>
          <div><span>Conversion rate</span><strong>${t.conversionRate || 0}%</strong></div>
        </div>
      </div>
      <div class="subs-revenue-card">
        <h4>Gateway</h4>
        <ul class="subs-gateway">
          <li><span>Razorpay keys</span><b class="${rzp.configured ? 'ok' : 'off'}">${rzp.configured ? 'Configured' : 'Not configured'}</b></li>
          <li><span>Recurring plans</span><b class="${rzp.recurring ? 'ok' : 'off'}">${rzp.recurring ? 'Enabled' : 'One-time orders'}</b></li>
          <li><span>Webhook secret</span><b class="${rzp.webhook ? 'ok' : 'off'}">${rzp.webhook ? 'Verified on receipt' : 'Not set'}</b></li>
          <li><span>Yearly saving</span><b class="ok">${inr(stats.settings?.savings?.saved || 0)} (${stats.settings?.savings?.percent || 0}%)</b></li>
        </ul>
      </div>
    `;
  }

  function applySettingsToForm(settings) {
    billingSettings = settings;
    const set = (input, value) => { if (input) input.value = value === null || value === undefined ? '' : value; };
    set(subsInputs.priceMonthly, settings.prices?.pro_monthly);
    set(subsInputs.priceYearly, settings.prices?.pro_yearly);
    set(subsInputs.freeContacts, settings.contactUnlockFree);
    set(subsInputs.freeResume, settings.limits?.free?.resume_tailor);
    set(subsInputs.freeAi, settings.limits?.free?.ai_comm);
    set(subsInputs.freeLiCampaigns, settings.limits?.free?.linkedin_campaign);
    set(subsInputs.freeLiRequests, settings.limits?.free?.linkedin_request);
    set(subsInputs.freeAutoApply, settings.limits?.free?.auto_apply);
    set(subsInputs.proResume, settings.limits?.pro?.resume_tailor);
    set(subsInputs.proAi, settings.limits?.pro?.ai_comm);
    set(subsInputs.proLiRequestsPerCampaign, settings.campaignRequests?.pro);
    set(subsInputs.freeLiRequestsPerCampaign, settings.campaignRequests?.free);

    const enabled = Boolean(settings.globalPremiumEnabled);
    premiumToggle.setAttribute('aria-checked', enabled ? 'true' : 'false');
    premiumToggle.classList.toggle('is-on', enabled);
    premiumToggleLabel.textContent = enabled ? 'ENABLED' : 'DISABLED';
    premiumStatePill.textContent = enabled ? 'Premium: ON' : 'Premium: OFF';
    premiumStatePill.className = `subs-live-pill ${enabled ? 'is-on' : 'is-off'}`;
    premiumSwitchHint.textContent = enabled
      ? 'On — Free limits, pricing, upgrades and Razorpay checkout are active. Paid and granted Pro accounts get full access.'
      : 'Off — the app behaves exactly as it did before subscriptions: no limits, no pricing, upgrades disabled. Saved records are kept.';
    subsSettingsMeta.textContent = settings.updatedAt
      ? `Last updated ${fmtDateTime(settings.updatedAt)}${settings.updatedBy ? ` by ${settings.updatedBy}` : ''}`
      : 'Using default prices and limits.';
  }

  function renderUsers(data) {
    const rows = Array.isArray(data.users) ? data.users : [];
    subsUserCount.textContent = `${data.total || 0} user${data.total === 1 ? '' : 's'}`;
    subsUsersEmpty.classList.toggle('hidden', rows.length > 0);

    subsUsersBody.innerHTML = rows.map((row) => {
      const initials = String(row.displayName || row.email || 'U').trim().slice(0, 1).toUpperCase();
      const isGrant = row.source === 'admin';
      const actions = [
        `<button type="button" class="subs-row-btn" data-detail="${escapeHtml(row.id)}">Details</button>`,
        isGrant
          ? `<button type="button" class="subs-row-btn is-danger" data-revoke="${escapeHtml(row.id)}" data-label="${escapeHtml(row.email)}">Revoke</button>`
          : `<button type="button" class="subs-row-btn is-accent" data-grant="${escapeHtml(row.id)}" data-label="${escapeHtml(row.email)}">Enable Premium</button>`,
      ];
      return `
        <tr>
          <td>
            <div class="candidate-person">
              <span class="candidate-avatar subs-avatar">${escapeHtml(initials)}</span>
              <div>
                <strong>${escapeHtml(row.displayName || 'Unnamed user')}</strong>
                <small>${escapeHtml(row.email)}</small>
              </div>
            </div>
          </td>
          <td><span class="plan-chip ${row.plan === 'pro' ? 'is-pro' : ''}">${row.plan === 'pro' ? 'Pro' : 'Free'}</span></td>
          <td class="candidate-muted">${escapeHtml(pretty(row.cycle) || '—')}</td>
          <td><span class="status-chip is-${escapeHtml(String(row.status).replace(/\s+/g, '_'))}">${escapeHtml(pretty(row.status))}</span></td>
          <td class="candidate-muted">${row.source === 'razorpay' ? 'Razorpay' : row.source === 'admin' ? 'Admin grant' : 'Free'}</td>
          <td class="hide-sm candidate-muted">${escapeHtml(fmtDate(row.expiryDate))}</td>
          <td class="hide-sm candidate-muted">${row.payments || 0}</td>
          <td><div class="subs-row-actions">${actions.join('')}</div></td>
        </tr>
      `;
    }).join('');

    subsUsersBody.querySelectorAll('[data-grant]').forEach((btn) => {
      btn.addEventListener('click', () => openGrant(btn.dataset.grant, btn.dataset.label));
    });
    subsUsersBody.querySelectorAll('[data-revoke]').forEach((btn) => {
      btn.addEventListener('click', () => openRevoke(btn.dataset.revoke, btn.dataset.label));
    });
    subsUsersBody.querySelectorAll('[data-detail]').forEach((btn) => {
      btn.addEventListener('click', () => openUserDetail(btn.dataset.detail));
    });

    const pages = data.pages || 1;
    subsPager.innerHTML = `
      <button type="button" class="subs-row-btn" data-page="prev" ${data.page <= 1 ? 'disabled' : ''}>← Prev</button>
      <span>Page ${data.page || 1} of ${pages}</span>
      <button type="button" class="subs-row-btn" data-page="next" ${data.page >= pages ? 'disabled' : ''}>Next →</button>
    `;
    subsPager.querySelector('[data-page="prev"]')?.addEventListener('click', () => { subsState.page = Math.max(1, subsState.page - 1); loadSubsUsers(); });
    subsPager.querySelector('[data-page="next"]')?.addEventListener('click', () => { subsState.page = Math.min(pages, subsState.page + 1); loadSubsUsers(); });
  }

  async function loadSubsUsers() {
    const qs = new URLSearchParams({
      page: String(subsState.page),
      pageSize: String(subsState.pageSize),
      filter: subsState.filter,
      sort: subsState.sort,
      dir: subsState.dir,
    });
    if (subsState.search) qs.set('search', subsState.search);
    try {
      const data = await billingFetch(`/api/admin/billing/users?${qs.toString()}`);
      renderUsers(data);
    } catch (err) {
      handleBillingError(err);
    }
  }

  function renderTransactions(data) {
    const rows = Array.isArray(data.transactions) ? data.transactions : [];
    subsTxCount.textContent = `${data.total || 0} payment${data.total === 1 ? '' : 's'}`;
    subsTxEmpty.classList.toggle('hidden', rows.length > 0);
    subsTxBody.innerHTML = rows.map((p) => `
      <tr>
        <td class="candidate-muted">${escapeHtml(fmtDate(p.paidAt || p.createdAt))}</td>
        <td>
          <strong>${escapeHtml(p.userName || '—')}</strong>
          <div class="subs-sub">${escapeHtml(p.userEmail || '')}</div>
        </td>
        <td class="candidate-muted">${p.billingCycle === 'yearly' ? 'Yearly' : 'Monthly'}</td>
        <td>${escapeHtml(inr(p.amount))}</td>
        <td><span class="status-chip is-${escapeHtml(String(p.status).replace(/\s+/g, '_'))}">${escapeHtml(pretty(p.status))}</span></td>
        <td class="hide-sm subs-mono">${escapeHtml(p.razorpayPaymentId || '—')}</td>
        <td class="hide-sm subs-mono">${escapeHtml(p.razorpayOrderId || p.razorpaySubscriptionId || '—')}</td>
      </tr>
    `).join('');
  }

  async function loadTransactions() {
    const qs = new URLSearchParams({ status: txState.status, pageSize: '12' });
    if (txState.search) qs.set('search', txState.search);
    try {
      const data = await billingFetch(`/api/admin/billing/transactions?${qs.toString()}`);
      renderTransactions(data);
    } catch (err) {
      handleBillingError(err);
    }
  }

  async function loadBilling() {
    subsRefreshBtn.disabled = true;
    subsRefreshBtn.textContent = 'Refreshing…';
    try {
      const [stats, settings] = await Promise.all([
        billingFetch('/api/admin/billing/stats'),
        billingFetch('/api/admin/billing/settings'),
      ]);
      billingBlocked = false;
      renderStats(stats);
      applySettingsToForm(settings);
      await Promise.all([loadSubsUsers(), loadTransactions()]);
    } catch (err) {
      handleBillingError(err);
    } finally {
      subsRefreshBtn.disabled = false;
      subsRefreshBtn.textContent = 'Refresh';
    }
  }

  function handleBillingError(err) {
    const message = err?.status === 403
      ? 'Admin access required. Set ADMIN_EMAILS in .env, or sign in with the connected Gmail owner account.'
      : err?.message || 'Billing request failed.';
    if (err?.status === 403) {
      billingBlocked = true;
      subsStats.innerHTML = `<div class="subs-blocked">${escapeHtml(message)}</div>`;
    }
    showToast(message, true);
  }

  /* Grant / revoke / details */

  function openGrant(id, label) {
    grantTarget = { id, label };
    grantUserLine.textContent = label ? `${label}` : '';
    grantReason.value = '';
    grantDays.value = '';
    setSubsStatus(grantStatus, '');
    grantModal.classList.remove('hidden');
    grantReason.focus();
  }

  function closeGrant() {
    grantModal.classList.add('hidden');
    grantTarget = null;
  }

  async function submitGrant() {
    if (!grantTarget) return;
    const reason = grantReason.value.trim();
    if (!reason) {
      setSubsStatus(grantStatus, 'Add a short reason — it is stored in the audit log.', true);
      return;
    }
    grantSubmit.disabled = true;
    setSubsStatus(grantStatus, 'Granting premium…');
    try {
      await billingPost(`/api/admin/billing/users/${encodeURIComponent(grantTarget.id)}/grant`, {
        reason,
        expiryDays: grantDays.value ? Number(grantDays.value) : 0,
      });
      showToast('Premium granted.');
      closeGrant();
      await loadBilling();
    } catch (err) {
      setSubsStatus(grantStatus, err.message || 'Could not grant premium.', true);
    } finally {
      grantSubmit.disabled = false;
    }
  }

  function openRevoke(id, label) {
    revokeTarget = { id, label };
    revokeUserLine.textContent = label ? `${label}` : '';
    revokeReason.value = '';
    setSubsStatus(revokeStatus, '');
    revokeModal.classList.remove('hidden');
    revokeReason.focus();
  }

  function closeRevoke() {
    revokeModal.classList.add('hidden');
    revokeTarget = null;
  }

  async function submitRevoke() {
    if (!revokeTarget) return;
    revokeSubmit.disabled = true;
    setSubsStatus(revokeStatus, 'Revoking…');
    try {
      const result = await billingPost(`/api/admin/billing/users/${encodeURIComponent(revokeTarget.id)}/revoke`, {
        reason: revokeReason.value.trim() || 'Manual premium revoked',
      });
      showToast(result.keptPaidSubscription ? 'Grant revoked — paid subscription kept.' : 'Premium access revoked.');
      closeRevoke();
      await loadBilling();
    } catch (err) {
      setSubsStatus(revokeStatus, err.message || 'Could not revoke premium.', true);
    } finally {
      revokeSubmit.disabled = false;
    }
  }

  async function openUserDetail(id) {
    userModalTitle.textContent = 'Loading…';
    userModalBody.innerHTML = '<p class="candidate-muted">Fetching account history…</p>';
    userModal.classList.remove('hidden');
    try {
      const data = await billingFetch(`/api/admin/billing/users/${encodeURIComponent(id)}`);
      const user = data.user || {};
      const snap = data.snapshot || {};
      userModalTitle.textContent = user.displayName || user.email || 'User';
      const subs = data.subscriptions || [];
      const payments = data.payments || [];
      const grants = data.grants || [];
      const audit = data.audit || [];

      const subsRows = subs.length
        ? subs.map((s) => `
            <tr>
              <td>${escapeHtml(s.billingCycle === 'yearly' ? 'Yearly' : 'Monthly')}</td>
              <td><span class="status-chip is-${escapeHtml(String(s.status).replace(/\s+/g, '_'))}">${escapeHtml(pretty(s.status))}</span></td>
              <td>${escapeHtml(fmtDate(s.startDate))}</td>
              <td>${escapeHtml(fmtDate(s.expiryDate))}</td>
              <td class="candidate-muted">${s.source === 'admin' ? 'Admin grant' : 'Razorpay'}</td>
              <td class="subs-mono">${escapeHtml(s.razorpayPaymentId || '—')}</td>
            </tr>
          `).join('')
        : '<tr><td colspan="6" class="candidate-muted">No subscription records.</td></tr>';

      const payRows = payments.length
        ? payments.map((p) => `
            <tr>
              <td>${escapeHtml(fmtDate(p.paidAt || p.createdAt))}</td>
              <td>${escapeHtml(p.billingCycle === 'yearly' ? 'Yearly' : 'Monthly')}</td>
              <td>${escapeHtml(inr(p.amount))}</td>
              <td><span class="status-chip is-${escapeHtml(String(p.status).replace(/\s+/g, '_'))}">${escapeHtml(pretty(p.status))}</span></td>
              <td class="subs-mono">${escapeHtml(p.razorpayPaymentId || '—')}</td>
            </tr>
          `).join('')
        : '<tr><td colspan="5" class="candidate-muted">No payments — this account never paid.</td></tr>';

      const grantRows = grants.length
        ? grants.map((g) => `
            <li>
              <strong>${escapeHtml(pretty(g.status))}</strong>
              <span>${escapeHtml(fmtDate(g.grantDate))} → ${escapeHtml(g.expiryDate ? fmtDate(g.expiryDate) : 'no expiry')}</span>
              <small>${escapeHtml(g.reason || 'No reason recorded')}${g.grantedByEmail ? ` · by ${escapeHtml(g.grantedByEmail)}` : ''}</small>
            </li>
          `).join('')
        : '<li class="candidate-muted">No manual grants.</li>';

      const auditRows = audit.length
        ? audit.map((a) => `
            <li>
              <strong>${escapeHtml(pretty(a.action))}</strong>
              <span>${escapeHtml(fmtDateTime(a.timestamp))}${a.adminEmail ? ` · ${escapeHtml(a.adminEmail)}` : ''}</span>
              <small>${escapeHtml(a.previousStatus || '—')} → ${escapeHtml(a.newStatus || '—')}${a.reason ? ` · ${escapeHtml(a.reason)}` : ''}</small>
            </li>
          `).join('')
        : '<li class="candidate-muted">No audit entries.</li>';

      userModalBody.innerHTML = `
        <div class="subs-user-meta">
          <div><span>Email</span><strong>${escapeHtml(user.email || '—')}</strong></div>
          <div><span>Registered</span><strong>${escapeHtml(fmtDate(user.createdAt))}</strong></div>
          <div><span>Current plan</span><strong>${escapeHtml(snap.plan?.name || 'Free')}</strong></div>
          <div><span>Access source</span><strong>${escapeHtml(snap.plan?.source || 'free')}</strong></div>
          <div><span>Subscription</span><strong>${escapeHtml(snap.subscription ? `${snap.subscription.cycle} · ${snap.subscription.status}` : 'None')}</strong></div>
          <div><span>Expires</span><strong>${escapeHtml(fmtDate(snap.subscription?.expiryDate || snap.grant?.expiryDate))}</strong></div>
        </div>

        <h4 class="subs-user-h">Subscription history</h4>
        <div class="subs-table-wrap">
          <table class="subs-table">
            <thead><tr><th>Cycle</th><th>Status</th><th>Started</th><th>Expiry</th><th>Source</th><th>Payment</th></tr></thead>
            <tbody>${subsRows}</tbody>
          </table>
        </div>

        <h4 class="subs-user-h">Payment history</h4>
        <div class="subs-table-wrap">
          <table class="subs-table">
            <thead><tr><th>Date</th><th>Plan</th><th>Amount</th><th>Status</th><th>Razorpay payment</th></tr></thead>
            <tbody>${payRows}</tbody>
          </table>
        </div>

        <div class="subs-user-cols">
          <div>
            <h4 class="subs-user-h">Manual grants</h4>
            <ul class="subs-timeline">${grantRows}</ul>
          </div>
          <div>
            <h4 class="subs-user-h">Audit log</h4>
            <ul class="subs-timeline">${auditRows}</ul>
          </div>
        </div>
      `;
    } catch (err) {
      userModalBody.innerHTML = `<p class="subs-status is-error">${escapeHtml(err.message || 'Could not load this user.')}</p>`;
    }
  }

  /* Wiring */

  premiumToggle.addEventListener('click', async () => {
    const next = premiumToggle.getAttribute('aria-checked') !== 'true';
    const message = next
      ? 'Enable premium features?\n\nFree/Pro limits, pricing on the landing page, upgrades and Razorpay checkout become active immediately.'
      : 'Disable premium features?\n\nEvery account returns to the original unlimited behaviour. Paid subscriptions, grants, payments and usage records are kept and restored when you switch it back on.';
    if (!window.confirm(message)) return;
    premiumToggle.disabled = true;
    try {
      await billingPost('/api/admin/billing/premium-toggle', {
        enabled: next,
        reason: 'Toggled from the admin console',
      });
      showToast(next ? 'Premium enabled — plans are live.' : 'Premium disabled — original behaviour restored.');
      await loadBilling();
    } catch (err) {
      handleBillingError(err);
    } finally {
      premiumToggle.disabled = false;
    }
  });

  subsSettingsSave.addEventListener('click', async () => {
    const num = (el) => Math.max(0, Number(el.value) || 0);
    const numOrNull = (el) => (String(el.value).trim() === '' ? null : Math.max(0, Number(el.value) || 0));
    const patch = {
      prices: {
        pro_monthly: num(subsInputs.priceMonthly),
        pro_yearly: num(subsInputs.priceYearly),
      },
      contactUnlockFree: num(subsInputs.freeContacts),
      limits: {
        free: {
          resume_tailor: num(subsInputs.freeResume),
          ai_comm: num(subsInputs.freeAi),
          linkedin_campaign: num(subsInputs.freeLiCampaigns),
          linkedin_request: num(subsInputs.freeLiRequests),
          auto_apply: num(subsInputs.freeAutoApply),
        },
        pro: {
          resume_tailor: num(subsInputs.proResume),
          ai_comm: num(subsInputs.proAi),
        },
      },
      campaignRequests: {
        free: numOrNull(subsInputs.freeLiRequestsPerCampaign),
        pro: numOrNull(subsInputs.proLiRequestsPerCampaign),
      },
    };
    subsSettingsSave.disabled = true;
    setSubsStatus(subsSettingsStatus, 'Saving…');
    try {
      const result = await billingFetch('/api/admin/billing/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      applySettingsToForm(result.settings || { ...billingSettings, ...patch });
      setSubsStatus(subsSettingsStatus, '✓ Saved. New limits apply to the next request.');
      showToast('Billing settings saved.');
      await loadBilling();
    } catch (err) {
      setSubsStatus(subsSettingsStatus, err.message || 'Could not save settings.', true);
    } finally {
      subsSettingsSave.disabled = false;
    }
  });

  subsSweepBtn.addEventListener('click', async () => {
    subsSweepBtn.disabled = true;
    try {
      const result = await billingPost('/api/admin/billing/sweep');
      showToast(`Expiry sweep finished — ${result.changed || 0} record${result.changed === 1 ? '' : 's'} updated.`);
      await loadBilling();
    } catch (err) {
      handleBillingError(err);
    } finally {
      subsSweepBtn.disabled = false;
    }
  });

  subsRefreshBtn.addEventListener('click', loadBilling);

  subsCsvBtn.addEventListener('click', () => {
    window.open('/api/admin/billing/export.csv', '_blank');
  });

  let subsSearchTimer = null;
  subsUserSearch.addEventListener('input', () => {
    clearTimeout(subsSearchTimer);
    subsSearchTimer = setTimeout(() => {
      subsState.search = subsUserSearch.value.trim();
      subsState.page = 1;
      loadSubsUsers();
    }, 280);
  });

  subsUserFilter.addEventListener('change', () => {
    subsState.filter = subsUserFilter.value;
    subsState.page = 1;
    loadSubsUsers();
  });

  subsUserSort.addEventListener('change', () => {
    const [sort, dir] = subsUserSort.value.split(':');
    subsState.sort = sort;
    subsState.dir = dir;
    subsState.page = 1;
    loadSubsUsers();
  });

  let txSearchTimer = null;
  subsTxStatus.addEventListener('change', () => {
    txState.status = subsTxStatus.value;
    loadTransactions();
  });
  subsTxSearch.addEventListener('input', () => {
    clearTimeout(txSearchTimer);
    txSearchTimer = setTimeout(() => {
      txState.search = subsTxSearch.value.trim();
      loadTransactions();
    }, 280);
  });

  grantClose.addEventListener('click', closeGrant);
  grantCancel.addEventListener('click', closeGrant);
  grantSubmit.addEventListener('click', submitGrant);
  grantModal.addEventListener('click', (event) => { if (event.target === grantModal) closeGrant(); });

  revokeClose.addEventListener('click', closeRevoke);
  revokeCancel.addEventListener('click', closeRevoke);
  revokeSubmit.addEventListener('click', submitRevoke);
  revokeModal.addEventListener('click', (event) => { if (event.target === revokeModal) closeRevoke(); });

  userModalClose.addEventListener('click', () => userModal.classList.add('hidden'));
  userModal.addEventListener('click', (event) => { if (event.target === userModal) userModal.classList.add('hidden'); });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!grantModal.classList.contains('hidden')) closeGrant();
    if (!revokeModal.classList.contains('hidden')) closeRevoke();
    userModal.classList.add('hidden');
  });

  loadBilling();

  // ─── Toast ───
  function showToast(msg, isError = false) {
    toastMessage.textContent = msg;
    toastNotification.className = isError ? 'toast show error' : 'toast show';
    setTimeout(() => {
      toastNotification.className = 'toast hidden';
    }, 3000);
  }

  // ─── Helpers ───
  function escapeHtml(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ─── Init ───
  fetchJobs();
});
