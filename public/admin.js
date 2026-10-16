/**
 * Admin Dashboard - Job Posting Controller
 */
document.addEventListener('DOMContentLoaded', () => {
  // State
  let mustHaveSkills = [];
  let goodToHaveSkills = [];
  let logoFile = null;
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
        logo: logoPath,
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
