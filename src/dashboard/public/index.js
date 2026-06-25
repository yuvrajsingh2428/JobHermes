// ============================================================
// JobHermes Dashboard – Frontend Application Code
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  // Global State
  let currentActiveTab = 'jobs';
  let activeDocumentJobId = null;
  let activeStatusJobId = null;
  let isScanning = false;
  let scanPollIntervalId = null;

  // DOM Elements
  const btnRunScan = document.getElementById('btn-run-scan');
  const scanStatusBadge = document.getElementById('scan-status-badge');
  const scanStatusText = document.getElementById('scan-status-text');

  // Stats
  const valScraped = document.getElementById('val-scraped');
  const valMatched = document.getElementById('val-matched');
  const valApplied = document.getElementById('val-applied');
  const valCompanies = document.getElementById('val-companies');

  // Navigation Tabs
  const tabJobs = document.getElementById('tab-jobs');
  const tabProfile = document.getElementById('tab-profile');
  const tabTargets = document.getElementById('tab-targets');

  // Sections
  const sectJobs = document.getElementById('sect-jobs');
  const sectProfile = document.getElementById('sect-profile');
  const sectTargets = document.getElementById('sect-targets');

  // Filter & Search Controls
  const filterStatus = document.getElementById('filter-status');
  const filterScore = document.getElementById('filter-score');
  const searchCompany = document.getElementById('search-company');
  const jobsGrid = document.getElementById('jobs-grid');

  // Modal: Tailor Document & Preview
  const docModal = document.getElementById('doc-modal');
  const btnCloseModal = document.getElementById('btn-close-modal');
  const coverLetterTone = document.getElementById('cover-letter-tone');
  const btnGenerateResume = document.getElementById('btn-generate-resume');
  const btnGenerateCover = document.getElementById('btn-generate-cover');
  const btnGeneratePack = document.getElementById('btn-generate-pack');
  const docStatusMsg = document.getElementById('doc-status-msg');
  const btnTabResumePreview = document.getElementById('btn-tab-resume-preview');
  const btnTabCoverPreview = document.getElementById('btn-tab-cover-preview');
  const previewFrameContainer = document.getElementById('preview-frame-container');
  const previewIframe = document.getElementById('preview-iframe');

  // Modal: Edit Status
  const statusModal = document.getElementById('status-modal');
  const btnCloseStatusModal = document.getElementById('btn-close-status-modal');
  const formUpdateStatus = document.getElementById('form-update-status');
  const statusJobIdInput = document.getElementById('status-job-id');
  const jobStatusSelect = document.getElementById('job-status-select');
  const jobNotesInput = document.getElementById('job-notes-input');

  // Document Content Cache
  let currentDocCache = {
    resumeHtml: '',
    coverLetterHtml: ''
  };

  // ─── Startup ───────────────────────────────────────────────

  init();

  function init() {
    setupTabListeners();
    setupFilterListeners();
    setupModalListeners();
    setupScanListeners();

    // Initial Data Fetch
    loadStats();
    loadJobs();
    checkScanningStatus();
  }

  // ─── Tab Navigation ────────────────────────────────────────

  function setupTabListeners() {
    tabJobs.addEventListener('click', () => switchTab('jobs'));
    tabProfile.addEventListener('click', () => switchTab('profile'));
    tabTargets.addEventListener('click', () => switchTab('targets'));
  }

  function switchTab(tabName) {
    if (currentActiveTab === tabName) return;
    
    currentActiveTab = tabName;

    // Toggle Tab Buttons Active Class
    tabJobs.classList.toggle('active', tabName === 'jobs');
    tabProfile.classList.toggle('active', tabName === 'profile');
    tabTargets.classList.toggle('active', tabName === 'targets');

    // Toggle Content Sections Active Class
    sectJobs.classList.toggle('active', tabName === 'jobs');
    sectProfile.classList.toggle('active', tabName === 'profile');
    sectTargets.classList.toggle('active', tabName === 'targets');

    if (tabName === 'profile') {
      loadProfileData();
    } else if (tabName === 'targets') {
      loadTargetsData();
    }
  }

  // ─── Filter & Search Logic ─────────────────────────────────

  function setupFilterListeners() {
    filterStatus.addEventListener('change', debounce(loadJobs, 250));
    filterScore.addEventListener('input', debounce(loadJobs, 250));
    searchCompany.addEventListener('input', debounce(loadJobs, 300));
  }

  // ─── Load Stats ────────────────────────────────────────────

  async function loadStats() {
    try {
      const res = await fetch('/api/stats');
      if (!res.ok) throw new Error('Failed to fetch stats');
      const data = await res.json();

      valScraped.textContent = data.totalJobs || 0;
      valMatched.textContent = data.statusCounts?.reviewed || 0;
      valApplied.textContent = data.appliedCount || 0;
      valCompanies.textContent = data.statusCounts?.applied ? Object.keys(data.statusCounts).length : 0;
      
      // Let's pull targets table to count companies accurately
      fetch('/api/targets')
        .then(r => r.json())
        .then(t => {
          valCompanies.textContent = t.length || 0;
        }).catch(() => {});

    } catch (err) {
      console.error('Error loading stats:', err);
    }
  }

  // ─── Load Jobs ─────────────────────────────────────────────

  async function loadJobs() {
    showJobsLoader();

    try {
      const status = filterStatus.value;
      const minScore = filterScore.value;
      const company = searchCompany.value;

      const params = new URLSearchParams();
      if (status) params.append('status', status);
      if (minScore) params.append('minScore', minScore);
      if (company) params.append('company', company);

      const url = `/api/jobs?${params.toString()}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch jobs');
      const jobs = await res.json();

      renderJobsList(jobs);
    } catch (err) {
      console.error('Error loading jobs:', err);
      jobsGrid.innerHTML = `<div class="no-jobs-msg text-danger">⚠️ Error loading matching jobs. Please refresh.</div>`;
    }
  }

  function showJobsLoader() {
    jobsGrid.innerHTML = `
      <div class="loading-spinner-container">
        <div class="spinner"></div>
        <p>Loading matching job postings...</p>
      </div>`;
  }

  function renderJobsList(jobs) {
    if (!jobs || jobs.length === 0) {
      jobsGrid.innerHTML = `<div class="no-jobs-msg">No job postings match the active filters. Check back tomorrow!</div>`;
      return;
    }

    jobsGrid.innerHTML = jobs.map((job) => {
      const score = job.score ?? 0;
      let scoreColorClass = 'text-danger';
      if (score >= 80) scoreColorClass = 'text-success';
      else if (score >= 60) scoreColorClass = 'text-warning';

      // Status Badge Style
      const statusClass = `status-${job.status}`;

      // Date Format
      const dateStr = job.scrapedAt ? new Date(job.scrapedAt).toLocaleDateString() : 'N/A';

      // Description Snippet
      const descSnippet = job.description
        ? (job.description.length > 220 ? job.description.slice(0, 220) + '...' : job.description)
        : 'No job description details scraped.';

      // Score Breakdown logic
      const bd = job.scoreBreakdown;
      const breakdownHtml = bd ? `
        <div class="score-breakdown-details hidden" id="breakdown-details-${job.id}">
          <span class="breakdown-item">Skills Match: <strong>${bd.skillMatch}/30</strong></span>
          <span class="breakdown-item">Title Match: <strong>${bd.titleMatch}/20</strong></span>
          <span class="breakdown-item">Location: <strong>${bd.locationMatch}/15</strong></span>
          <span class="breakdown-item">Experience: <strong>${bd.experienceMatch}/15</strong></span>
          <span class="breakdown-item">Salary: <strong>${bd.salaryMatch}/10</strong></span>
          <span class="breakdown-item">Company Prestige: <strong>${bd.companyPrestige}/10</strong></span>
        </div>` : '';

      return `
        <div class="job-card" id="job-card-${job.id}">
          <div class="job-main-info">
            <div class="job-badges">
              <span class="badge ${statusClass} badge-status">${job.status}</span>
              ${job.salary ? `<span class="badge bg-slate-800 text-warning">💰 ${job.salary}</span>` : ''}
              ${job.jobType ? `<span class="badge bg-slate-800 text-info">⏱ ${job.jobType}</span>` : ''}
            </div>
            <h3 class="job-title"><a href="${job.url}" target="_blank" rel="noopener">${job.title}</a></h3>
            <div class="job-company">${job.company}</div>
            
            <div class="job-meta-row">
              <div class="job-meta-item">📍 ${job.location || 'India'}</div>
              <div class="job-meta-item">📅 Scraped: ${dateStr}</div>
              <div class="job-meta-item">🔗 Source: ${job.source || 'Scraper'}</div>
            </div>

            <p class="job-description">${descSnippet}</p>
            
            ${breakdownHtml}

            <!-- Card Action Footer -->
            <div class="job-actions">
              <button class="btn btn-secondary btn-sm" onclick="window.toggleScoreBreakdown(${job.id})">
                📊 Score Breakdown
              </button>
              <button class="btn btn-secondary btn-sm" onclick="window.openEditStatusModal(${job.id}, '${job.status}', \`${escapeNotes(job.notes || '')}\`)">
                📝 Update Status
              </button>
              <button class="btn btn-primary btn-sm" onclick="window.openTailorModal(${job.id})">
                ⚙️ Tailor Pack
              </button>
            </div>
          </div>

          <!-- Score Circle Badge -->
          <div style="display:flex;align-items:center;">
            <div class="score-badge-circle" style="border-color:${getScoreColorHex(score)};">
              <div class="score-badge-val ${scoreColorClass}">${score}</div>
              <div class="score-badge-lbl">SCORE</div>
            </div>
          </div>
        </div>`;
    }).join('');
  }

  // Helper function to escape notes for HTML attribute insertion
  function escapeNotes(str) {
    return str
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/`/g, '&#96;')
      .replace(/\n/g, '\\n');
  }

  function getScoreColorHex(score) {
    if (score >= 80) return '#10b981';
    if (score >= 60) return '#f59e0b';
    return '#ef4444';
  }

  // ─── Modal Handling: Document Tailoring ────────────────────

  function setupModalListeners() {
    btnCloseModal.addEventListener('click', closeDocModal);
    
    // Preview Tabs Switching
    btnTabResumePreview.addEventListener('click', () => switchPreviewTab('resume'));
    btnTabCoverPreview.addEventListener('click', () => switchPreviewTab('cover'));

    // Tailoring Action Handlers
    btnGenerateResume.addEventListener('click', () => triggerDocGeneration('resume'));
    btnGenerateCover.addEventListener('click', () => triggerDocGeneration('cover'));
    btnGeneratePack.addEventListener('click', () => triggerDocGeneration('pack'));

    // Edit Status Closers
    btnCloseStatusModal.addEventListener('click', closeStatusModal);
    formUpdateStatus.addEventListener('submit', handleStatusSubmit);

    // Escape Key Handler to close modals
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeDocModal();
        closeStatusModal();
      }
    });
  }

  window.openTailorModal = function(jobId) {
    activeDocumentJobId = jobId;
    
    // Reset Modal Content States
    docStatusMsg.classList.add('hidden');
    docStatusMsg.textContent = '';
    btnTabResumePreview.classList.add('hidden');
    btnTabCoverPreview.classList.add('hidden');
    previewFrameContainer.classList.add('hidden');
    previewIframe.src = 'about:blank';
    currentDocCache = { resumeHtml: '', coverLetterHtml: '' };

    docModal.classList.add('active');
  };

  function closeDocModal() {
    docModal.classList.remove('active');
    activeDocumentJobId = null;
  }

  async function triggerDocGeneration(type) {
    setDocButtonsLoading(true);
    showDocStatus('Tailoring documents via AI service. Please wait...', 'info');

    const tone = coverLetterTone.value;
    const url = type === 'resume' 
      ? `/api/jobs/${activeDocumentJobId}/resume`
      : type === 'cover'
        ? `/api/jobs/${activeDocumentJobId}/cover-letter`
        : `/api/jobs/${activeDocumentJobId}/apply-pack`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tone })
      });

      if (!res.ok) throw new Error('API request failed');
      const data = await res.json();

      if (type === 'resume') {
        currentDocCache.resumeHtml = data.html;
        showDocStatus(`✅ Resume successfully tailored! Saved locally to ${data.filePath}`, 'success');
        btnTabResumePreview.classList.remove('hidden');
        switchPreviewTab('resume');
      } else if (type === 'cover') {
        currentDocCache.coverLetterHtml = data.html;
        showDocStatus(`✅ Cover letter successfully tailored! Saved locally to ${data.filePath}`, 'success');
        btnTabCoverPreview.classList.remove('hidden');
        switchPreviewTab('cover');
      } else { // Pack
        currentDocCache.resumeHtml = data.resumeHtml;
        currentDocCache.coverLetterHtml = data.coverLetterHtml;
        showDocStatus(`✅ Application Pack generated! Resume saved to ${data.resumePath} and Cover Letter saved to ${data.coverLetterPath}`, 'success');
        
        btnTabResumePreview.classList.remove('hidden');
        btnTabCoverPreview.classList.remove('hidden');
        switchPreviewTab('resume');
        
        // Refresh job listings list (status is updated to 'applied' in DB)
        loadJobs();
        loadStats();
      }
    } catch (err) {
      console.error('Tailor error:', err);
      showDocStatus(`❌ AI generation failed. Verify your connection or OpenAI API settings.`, 'error');
    } finally {
      setDocButtonsLoading(false);
    }
  }

  function setDocButtonsLoading(loading) {
    btnGenerateResume.disabled = loading;
    btnGenerateCover.disabled = loading;
    btnGeneratePack.disabled = loading;
    
    if (loading) {
      btnGenerateResume.textContent = 'Generating...';
    } else {
      btnGenerateResume.textContent = 'Generate Tailored Resume';
      btnGenerateCover.textContent = 'Generate Cover Letter';
      btnGeneratePack.textContent = 'Generate Full Pack';
    }
  }

  function showDocStatus(msg, type) {
    docStatusMsg.textContent = msg;
    docStatusMsg.className = 'doc-status-msg';
    
    if (type === 'error') {
      docStatusMsg.classList.add('error');
    } else if (type === 'success') {
      docStatusMsg.style.backgroundColor = 'rgba(16, 185, 129, 0.08)';
      docStatusMsg.style.borderColor = 'rgba(16, 185, 129, 0.2)';
      docStatusMsg.style.color = '#34d399';
    } else {
      docStatusMsg.style.backgroundColor = 'rgba(99, 102, 241, 0.08)';
      docStatusMsg.style.borderColor = 'rgba(99, 102, 241, 0.2)';
      docStatusMsg.style.color = '#a5b4fc';
    }

    docStatusMsg.classList.remove('hidden');
  }

  function switchPreviewTab(docType) {
    btnTabResumePreview.classList.toggle('active', docType === 'resume');
    btnTabCoverPreview.classList.toggle('active', docType === 'cover');

    previewFrameContainer.classList.remove('hidden');
    
    const htmlToInject = docType === 'resume' ? currentDocCache.resumeHtml : currentDocCache.coverLetterHtml;
    
    // Inject HTML string inside iframe safely
    const doc = previewIframe.contentDocument || previewIframe.contentWindow.document;
    doc.open();
    doc.write(htmlToInject);
    doc.close();
  }

  // ─── Modal Handling: Edit Status ───────────────────────────

  window.openEditStatusModal = function(jobId, currentStatus, currentNotes) {
    activeStatusJobId = jobId;
    statusJobIdInput.value = jobId;
    jobStatusSelect.value = currentStatus || 'new';
    
    // Handle double-slash / newline parsing from HTML injection
    jobNotesInput.value = currentNotes ? currentNotes.replace(/\\n/g, '\n') : '';

    statusModal.classList.add('active');
  };

  function closeStatusModal() {
    statusModal.classList.remove('active');
    activeStatusJobId = null;
  }

  async function handleStatusSubmit(e) {
    e.preventDefault();
    const jobId = statusJobIdInput.value;
    const status = jobStatusSelect.value;
    const notes = jobNotesInput.value;

    try {
      const res = await fetch(`/api/jobs/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, notes })
      });

      if (!res.ok) throw new Error('Status update failed');

      // Close and refresh
      closeStatusModal();
      loadJobs();
      loadStats();
    } catch (err) {
      console.error(err);
      alert('Failed to update job status.');
    }
  }

  // ─── Toggle Score Breakdown ────────────────────────────────

  window.toggleScoreBreakdown = function(jobId) {
    const details = document.getElementById(`breakdown-details-${jobId}`);
    if (details) {
      details.classList.toggle('hidden');
    }
  };

  // ─── Scan Triggering & Status Polling ─────────────────────

  function setupScanListeners() {
    btnRunScan.addEventListener('click', triggerDailyScan);
  }

  async function triggerDailyScan() {
    if (isScanning) return;

    setScanState(true);
    
    try {
      const res = await fetch('/api/scan', { method: 'POST' });
      if (!res.ok) throw new Error('Scan start failed');
      
      // Start polling
      startPollingScanStatus();
    } catch (err) {
      console.error(err);
      alert('Could not start daily job scan.');
      setScanState(false);
    }
  }

  async function checkScanningStatus() {
    try {
      const res = await fetch('/api/scan/status');
      const data = await res.json();
      
      if (data.isScanning) {
        setScanState(true);
        startPollingScanStatus();
      } else {
        setScanState(false);
      }
    } catch (err) {
      console.error(err);
    }
  }

  function startPollingScanStatus() {
    if (scanPollIntervalId) clearInterval(scanPollIntervalId);
    
    scanPollIntervalId = setInterval(async () => {
      try {
        const res = await fetch('/api/scan/status');
        const data = await res.json();
        
        if (!data.isScanning) {
          // Scan finished
          clearInterval(scanPollIntervalId);
          scanPollIntervalId = null;
          setScanState(false);
          
          // Refresh statistics and list
          loadStats();
          loadJobs();
          
          // If on Targets tab, refresh target listings
          if (currentActiveTab === 'targets') {
            loadTargetsData();
          }
        }
      } catch (err) {
        console.error('Scan polling error:', err);
      }
    }, 2000);
  }

  function setScanState(scanning) {
    isScanning = scanning;
    btnRunScan.disabled = scanning;

    if (scanning) {
      btnRunScan.innerHTML = `<span class="spinner" style="width:14px;height:14px;margin:0"></span> Scanning...`;
      scanStatusBadge.className = 'scan-status-badge running';
      scanStatusText.textContent = 'Scan Running';
    } else {
      btnRunScan.innerHTML = `<span class="btn-icon">🔍</span> Start Job Scan`;
      scanStatusBadge.className = 'scan-status-badge idle';
      scanStatusText.textContent = 'Ready';
    }
  }

  // ─── Profile Content Loading ──────────────────────────────

  async function loadProfileData() {
    const profName = document.getElementById('prof-name');
    const profTitle = document.getElementById('prof-title');
    const profContact = document.getElementById('prof-contact');
    const profSummary = document.getElementById('prof-summary');
    const skillsContainer = document.getElementById('skills-container');

    try {
      const res = await fetch('/api/profile');
      if (!res.ok) throw new Error('Failed to load profile');
      const profile = await res.json();

      profName.textContent = profile.name || 'Candidate Profile';
      profTitle.textContent = profile.title || '';
      profContact.textContent = `✉️ ${profile.email} | 📞 ${profile.phone} | 📍 ${profile.location}`;
      profSummary.textContent = profile.summary || 'No summary configured.';

      // Populate Skills categories
      if (profile.skills) {
        skillsContainer.innerHTML = Object.entries(profile.skills).map(([category, list]) => {
          const capitalizedCategory = category.charAt(0).toUpperCase() + category.slice(1);
          const tagsHtml = list.map((tag) => `<span class="tag">${tag}</span>`).join('');
          return `
            <div class="skill-category-card">
              <h4>${capitalizedCategory}</h4>
              <div class="skills-tags">${tagsHtml}</div>
            </div>`;
        }).join('');
      } else {
        skillsContainer.innerHTML = '<p>No skills data found.</p>';
      }

    } catch (err) {
      console.error(err);
      profName.textContent = 'Error loading candidate profile';
    }
  }

  // ─── Targets Content Loading ──────────────────────────────

  async function loadTargetsData() {
    const tbody = document.getElementById('targets-tbody');
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align:center;padding:24px;">
          <div class="spinner" style="margin:0 auto 10px;"></div>
          Loading targets list...
        </td>
      </tr>`;

    try {
      const res = await fetch('/api/targets');
      if (!res.ok) throw new Error('Failed to load targets');
      const targets = await res.json();

      if (!targets || targets.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;">No target companies configured.</td></tr>`;
        return;
      }

      tbody.innerHTML = targets.map((t) => {
        const priorityClass = t.priority === 'high' ? 'text-danger font-semibold' : t.priority === 'medium' ? 'text-warning' : 'text-muted';
        const keywordsHtml = t.search_keywords ? t.search_keywords.map((k) => `<span class="tag" style="font-size:10px;padding:1px 6px;">${k}</span>`).join(' ') : 'None';
        return `
          <tr>
            <td><strong>${t.name}</strong></td>
            <td class="${priorityClass}">${t.priority.toUpperCase()}</td>
            <td><div style="display:flex;flex-wrap:wrap;gap:4px;">${keywordsHtml}</div></td>
            <td><a href="${t.careers_url}" target="_blank" rel="noopener">${t.careers_url.slice(0, 45)}${t.careers_url.length > 45 ? '...' : ''}</a></td>
            <td>
              <span class="badge" style="background-color:${t.enabled ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)'};color:${t.enabled ? '#10b981' : '#ef4444'};">
                ${t.enabled ? 'active' : 'disabled'}
              </span>
            </td>
          </tr>`;
      }).join('');
    } catch (err) {
      console.error(err);
      tbody.innerHTML = `<tr><td colspan="5" class="text-danger" style="text-align:center;">Failed to load company targets.</td></tr>`;
    }
  }

  // ─── General Helpers ───────────────────────────────────────

  function debounce(fn, delay) {
    let timer = null;
    return function (...args) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        fn.apply(this, args);
      }, delay);
    };
  }
});
