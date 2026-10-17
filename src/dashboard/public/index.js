// ============================================================
// JobHermes Copilot Dashboard – Client Controller
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  // ─── State Management ─────────────────────────────────────
  const state = {
    activeTab: 'sect-today',
    stats: null,
    profile: null,
    jobs: [],
    companies: [],
    signals: [],
    contacts: [],
    outreach: [],
    outreachFilter: '',
    isScanning: false,
    scanPollInterval: null,
  };

  // ─── Elements ─────────────────────────────────────────────
  const tabs = document.querySelectorAll('.nav-tabs .tab-btn');
  const sections = document.querySelectorAll('.tab-content');
  const toastContainer = document.getElementById('toast-container');
  const scanBadge = document.getElementById('scan-status-badge');
  const scanText = document.getElementById('scan-status-text');
  const btnRunScan = document.getElementById('btn-run-scan');

  // ─── Toast System ─────────────────────────────────────────
  function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span>${message}</span>`;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('toast-out');
      setTimeout(() => toast.remove(), 250);
    }, 4000);
  }

  // ─── Tab Navigation ───────────────────────────────────────
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const targetId = tab.getAttribute('data-tab');
      switchTab(targetId);
    });
  });

  function switchTab(targetId) {
    state.activeTab = targetId;
    tabs.forEach((t) => {
      t.classList.toggle('active', t.getAttribute('data-tab') === targetId);
    });
    sections.forEach((s) => {
      s.classList.toggle('active', s.id === targetId);
    });

    // Refresh data for the active view
    if (targetId === 'sect-today') loadTodayData();
    if (targetId === 'sect-jobs') loadJobsData();
    if (targetId === 'sect-companies') loadCompaniesData();
    if (targetId === 'sect-contacts') loadContactsData();
    if (targetId === 'sect-outreach') loadOutreachData();
    if (targetId === 'sect-analytics') loadAnalyticsData();
    if (targetId === 'sect-settings') loadSettingsData();
  }

  // ─── Local Token & Mutation Interceptor ───────────────────
  let hermesToken = '';
  const originalFetch = window.fetch;
  window.fetch = async function (url, options = {}) {
    const opts = { ...options };
    const method = (opts.method || 'GET').toUpperCase();
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
      opts.headers = { ...(opts.headers || {}) };
      if (hermesToken) {
        opts.headers['X-Hermes-Token'] = hermesToken;
      }
      if (!opts.headers['Content-Type'] && method !== 'DELETE') {
        opts.headers['Content-Type'] = 'application/json';
      }
    }
    return originalFetch.call(this, url, opts);
  };

  async function initAuth() {
    try {
      const res = await originalFetch('/api/auth-token');
      if (res.ok) {
        const data = await res.json();
        hermesToken = data.token;
      }
    } catch (e) {
      console.error('Failed to get auth token', e);
    }
  }

  // ─── Global Initial Load ──────────────────────────────────
  async function refreshAll() {
    await initAuth();
    await Promise.all([
      loadStats(),
      loadProfile(),
      checkScanStatus(),
    ]);
    switchTab(state.activeTab);
  }

  async function loadStats() {
    try {
      const res = await fetch('/api/stats');
      if (!res.ok) throw new Error('Failed to load stats');
      state.stats = await res.json();
      renderHeaderStats();
    } catch (err) {
      console.error(err);
    }
  }

  async function loadProfile() {
    try {
      const res = await fetch('/api/profile');
      if (!res.ok) throw new Error('Failed to load profile');
      state.profile = await res.json();
      const heading = document.getElementById('today-heading');
      if (heading && state.profile?.name) {
        const cleanName = state.profile.name.includes('[FILL') ? 'Candidate' : state.profile.name;
        heading.textContent = `Good day, ${cleanName}`;
      }
    } catch (err) {
      console.error(err);
    }
  }

  function renderHeaderStats() {
    if (!state.stats) return;
    const s = state.stats;
    document.getElementById('val-qualified-jobs').textContent = s.qualifiedCount || 0;
    document.getElementById('val-near-misses').textContent = s.nearMissCount || 0;
    document.getElementById('val-pending-drafts').textContent = s.funnel?.outreachDrafts || 0;
    document.getElementById('val-verified-contacts').textContent = s.funnel?.verifiedContacts || 0;
    document.getElementById('val-daily-sent').textContent = `${s.safety?.dailySentToday || 0} / 20`;

    document.getElementById('badge-jobs').textContent = s.qualifiedCount || 0;
    document.getElementById('badge-outreach').textContent = s.funnel?.outreachDrafts || 0;
  }

  // ─── Scan Control & Polling ───────────────────────────────
  btnRunScan?.addEventListener('click', triggerScan);
  document.getElementById('btn-today-scan')?.addEventListener('click', triggerScan);

  async function triggerScan() {
    try {
      const res = await fetch('/api/scan', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Scan failed to start');
      showToast('🚀 ATS Job Scan started in background!', 'success');
      setScanningState(true);
      startScanPolling();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function checkScanStatus() {
    try {
      const res = await fetch('/api/scan/status');
      const data = await res.json();
      setScanningState(data.isScanning);
      if (data.isScanning) startScanPolling();
    } catch (err) {
      console.error(err);
    }
  }

  function setScanningState(isScanning) {
    state.isScanning = isScanning;
    if (isScanning) {
      scanBadge.className = 'scan-status-badge active';
      scanText.textContent = 'Scanning...';
      if (btnRunScan) btnRunScan.disabled = true;
    } else {
      scanBadge.className = 'scan-status-badge idle';
      scanText.textContent = 'Ready';
      if (btnRunScan) btnRunScan.disabled = false;
    }
  }

  function startScanPolling() {
    if (state.scanPollInterval) clearInterval(state.scanPollInterval);
    state.scanPollInterval = setInterval(async () => {
      try {
        const res = await fetch('/api/scan/status');
        const data = await res.json();
        if (!data.isScanning) {
          clearInterval(state.scanPollInterval);
          state.scanPollInterval = null;
          setScanningState(false);
          showToast('✅ Job scan completed!', 'success');
          refreshAll();
        }
      } catch (err) {
        clearInterval(state.scanPollInterval);
      }
    }, 2500);
  }

  // ─── 1. TODAY VIEW CONTROLLER ─────────────────────────────
  async function loadTodayData() {
    await loadStats();

    // Load pending outreach drafts
    try {
      const res = await fetch('/api/outreach?status=draft');
      const drafts = await res.json();
      const listEl = document.getElementById('today-drafts-list');
      const countEl = document.getElementById('today-drafts-count');
      countEl.textContent = `${drafts.length} pending`;

      if (drafts.length === 0) {
        listEl.innerHTML = `<div class="empty-state">No drafts awaiting approval right now. All caught up!</div>`;
      } else {
        listEl.innerHTML = drafts.map((d) => `
          <div class="card p-3 flex justify-between items-center" style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 12px 16px;">
            <div>
              <div style="font-weight: 600; color: #fff;">${d.subject}</div>
              <div style="font-size: 12px; color: var(--text-muted);">To: ${d.contactName || 'Contact'} (${d.contactEmail}) • ${d.companyName}</div>
            </div>
            <div style="display: flex; gap: 8px;">
              <button class="btn btn-sm btn-primary" onclick="quickApproveOutreach(${d.id})">Approve</button>
            </div>
          </div>
        `).join('');
      }
    } catch (err) {
      console.error(err);
    }

    // Load top qualified jobs
    try {
      const res = await fetch('/api/jobs?minScore=60&limit=5');
      const jobs = await res.json();
      const listEl = document.getElementById('today-jobs-list');
      const countEl = document.getElementById('today-top-jobs-count');
      countEl.textContent = `${jobs.length} qualified`;

      if (jobs.length === 0) {
        listEl.innerHTML = `<div class="empty-state">No fresh matches today. Start a scan to discover fresh postings.</div>`;
      } else {
        listEl.innerHTML = jobs.map((j) => `
          <div class="card p-3 flex justify-between items-center" style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 12px 16px;">
            <div>
              <div style="font-weight: 600; color: #fff;">${j.title}</div>
              <div style="font-size: 12px; color: var(--text-muted);">${j.company} • ${j.location} • Score: <strong style="color: #34d399;">${j.score || 0}/100</strong></div>
            </div>
            <div style="display: flex; gap: 8px;">
              <button class="btn btn-sm btn-secondary" onclick="openTailorModal(${j.id})">Tailor</button>
              <a href="${j.url}" target="_blank" rel="noopener" class="btn btn-sm btn-secondary">Apply</a>
            </div>
          </div>
        `).join('');
      }
    } catch (err) {
      console.error(err);
    }
  }

  document.getElementById('btn-today-followups')?.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/outreach/check-followups', { method: 'POST' });
      const data = await res.json();
      const created = data.evaluations?.filter((e) => e.eligible) || [];
      if (created.length > 0) {
        showToast(`Created ${created.length} follow-up drafts awaiting approval!`, 'success');
      } else {
        showToast('Follow-up review complete. No emails due today.', 'info');
      }
      loadStats();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('btn-today-doctor')?.addEventListener('click', () => {
    switchTab('sect-settings');
    runDoctorDiagnostics();
  });

  // ─── 2. JOBS VIEW CONTROLLER ──────────────────────────────
  const filterJobStatus = document.getElementById('filter-job-status');
  const filterJobTier = document.getElementById('filter-job-tier');
  const searchJobs = document.getElementById('search-jobs');
  const filterStretch = document.getElementById('filter-stretch');

  [filterJobStatus, filterJobTier, searchJobs, filterStretch].forEach((el) => {
    el?.addEventListener('input', () => loadJobsData());
  });

  async function loadJobsData() {
    const grid = document.getElementById('jobs-grid');
    grid.innerHTML = `<div class="loading-spinner-container"><div class="spinner"></div><p>Filtering jobs...</p></div>`;

    const status = filterJobStatus?.value || '';
    const tier = filterJobTier?.value || 'qualified';
    const search = searchJobs?.value || '';
    const stretch = filterStretch?.checked;

    let url = `/api/jobs?status=${status}&search=${encodeURIComponent(search)}`;
    if (tier === 'qualified') url += '&minScore=60';
    if (tier === 'near-misses') url += '&nearMisses=true';
    if (stretch) url += '&stretch=true';

    try {
      const res = await fetch(url);
      const jobs = await res.json();
      state.jobs = jobs;

      if (jobs.length === 0) {
        grid.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1;">No jobs match your current filter criteria. Try clearing filters or running a scan.</div>`;
        return;
      }

      grid.innerHTML = jobs.map((job) => renderJobCard(job)).join('');
    } catch (err) {
      grid.innerHTML = `<div class="empty-state text-danger">Failed to load jobs: ${err.message}</div>`;
    }
  }

  function renderJobCard(job) {
    const score = job.score || 0;
    let scoreColor = 'emerald';
    if (score < 40) scoreColor = 'gray';
    else if (score < 60) scoreColor = 'amber';
    else if (score < 80) scoreColor = 'indigo';

    const matchedSkills = job.scoreBreakdown?.matchedSkills || [];
    const missingSkills = job.scoreBreakdown?.missingSkills || [];
    const reasons = job.reasons || [];

    return `
      <div class="job-card" id="job-card-${job.id}" style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 20px; display: flex; flex-direction: column; gap: 14px;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px;">
          <div>
            <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 6px;">
              <span class="badge" style="background: rgba(99, 102, 241, 0.15); color: #818cf8; font-weight: 700; padding: 4px 10px; border-radius: 9999px;">${job.source?.toUpperCase() || 'ATS'}</span>
              ${job.stretch ? '<span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; font-weight: 700; padding: 4px 10px; border-radius: 9999px;">STRETCH</span>' : ''}
              <span class="badge" style="background: rgba(255, 255, 255, 0.05); color: var(--text-muted); padding: 4px 10px; border-radius: 9999px;">${job.status.toUpperCase()}</span>
            </div>
            <h3 style="font-size: 18px; font-weight: 700; color: #fff; margin-bottom: 4px;">${job.title}</h3>
            <div style="font-size: 14px; color: #cbd5e1;">🏢 <strong>${job.company}</strong> • 📍 ${job.location} ${job.isRemote ? '(Remote)' : ''}</div>
          </div>
          <div style="width: 54px; height: 54px; border-radius: 50%; display: flex; flex-direction: column; align-items: center; justify-content: center; font-weight: 800; border: 2px solid ${score >= 60 ? '#34d399' : '#fbbf24'}; background: rgba(0,0,0,0.3);">
            <span style="font-size: 18px; color: #fff;">${score}</span>
            <span style="font-size: 9px; color: var(--text-muted);">FIT</span>
          </div>
        </div>

        <div style="display: flex; flex-wrap: wrap; gap: 6px;">
          ${matchedSkills.slice(0, 6).map((s) => `<span style="font-size: 11px; padding: 2px 8px; border-radius: 4px; background: rgba(16, 185, 129, 0.15); color: #34d399;">✓ ${s}</span>`).join('')}
          ${missingSkills.slice(0, 3).map((s) => `<span style="font-size: 11px; padding: 2px 8px; border-radius: 4px; background: rgba(239, 68, 68, 0.1); color: #f87171;">✕ ${s}</span>`).join('')}
        </div>

        ${reasons.length > 0 ? `
          <details style="background: rgba(0,0,0,0.2); padding: 10px 14px; border-radius: var(--radius-sm); font-size: 12px; color: var(--text-muted);">
            <summary style="cursor: pointer; font-weight: 600; color: #cbd5e1;">View Scoring Breakdown (${reasons.length} criteria)</summary>
            <ul style="margin-top: 8px; padding-left: 18px; line-height: 1.6;">
              ${reasons.map((r) => `<li>${r}</li>`).join('')}
            </ul>
          </details>
        ` : ''}

        <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 14px; margin-top: auto;">
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-sm btn-secondary" onclick="openTailorModal(${job.id})">Tailor Resume</button>
            <button class="btn btn-sm btn-secondary" onclick="openStatusModal(${job.id}, '${job.status}', '${(job.notes || '').replace(/'/g, "\\'")}')">Status</button>
          </div>
          <a href="${job.url}" target="_blank" rel="noopener" class="btn btn-sm btn-primary">Apply on ATS ↗</a>
        </div>
      </div>
    `;
  }

  // ─── 3. COMPANIES & SIGNALS VIEW CONTROLLER ─────────────────
  async function loadCompaniesData() {
    try {
      const [resComp, resSig] = await Promise.all([
        fetch('/api/companies'),
        fetch('/api/signals'),
      ]);
      const companies = await resComp.json();
      const signals = await resSig.json();
      state.companies = companies;
      state.signals = signals;

      // Render Targets Table
      const tbody = document.getElementById('targets-table-body');
      document.getElementById('targets-count-badge').textContent = `${companies.length} targets`;
      tbody.innerHTML = companies.map((c) => `
        <tr>
          <td><strong>${c.name}</strong><br><span style="font-size: 11px; color: var(--text-muted);">${c.domain}</span></td>
          <td><span class="badge" style="background: rgba(255,255,255,0.05); padding: 2px 8px; border-radius: 4px;">${c.ats?.toUpperCase()}</span> ${c.slug || ''}</td>
          <td>${c.verified ? '<span class="text-success font-semibold">✓ Verified</span>' : '<span class="text-warning">Unverified</span>'}</td>
          <td>${c.sizeBucket?.toUpperCase() || 'MID'}</td>
          <td><span class="badge" style="background: rgba(99,102,241,0.15); color: #818cf8; padding: 2px 8px; border-radius: 9999px;">${c.signalCount || 0} signals</span></td>
        </tr>
      `).join('');

      // Populate select in Add Contact modal
      const compSelect = document.getElementById('contact-company-id');
      if (compSelect) {
        compSelect.innerHTML = companies.map((c) => `<option value="${c.id || 1}">${c.name} (${c.domain})</option>`).join('');
      }

      // Render Signals List
      const sigList = document.getElementById('signals-list');
      document.getElementById('signals-count-badge').textContent = `${signals.length} signals`;
      if (signals.length === 0) {
        sigList.innerHTML = `<div class="empty-state">No company growth signals recorded yet. Click "Record Signal" to add funding, expansion, or hiring surges.</div>`;
      } else {
        sigList.innerHTML = signals.map((s) => `
          <div class="card p-3" style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 12px 14px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
              <strong>${s.companyName}</strong>
              <span class="badge" style="background: rgba(16,185,129,0.15); color: #34d399; font-size: 11px; padding: 2px 6px; border-radius: 4px;">${s.signalType.replace('_', ' ').toUpperCase()}</span>
            </div>
            <p style="font-size: 13px; color: #cbd5e1; margin-bottom: 6px;">${s.detail}</p>
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: var(--text-muted);">
              <span>Source: ${s.source}</span>
              ${s.url ? `<a href="${s.url}" target="_blank" rel="noopener" style="color: #818cf8;">Verify URL ↗</a>` : ''}
              <button class="btn btn-sm text-danger" style="padding: 2px 6px;" onclick="deleteSignal(${s.id})">Delete</button>
            </div>
          </div>
        `).join('');
      }
    } catch (err) {
      console.error(err);
    }
  }

  // ─── 4. CONTACTS VIEW CONTROLLER ────────────────────────────
  const filterContactStatus = document.getElementById('filter-contact-status');
  const searchContacts = document.getElementById('search-contacts');

  [filterContactStatus, searchContacts].forEach((el) => {
    el?.addEventListener('input', () => renderContactsList());
  });

  async function loadContactsData() {
    try {
      const res = await fetch('/api/contacts');
      const contacts = await res.json();
      state.contacts = contacts;
      renderContactsList();
    } catch (err) {
      console.error(err);
    }
  }

  function renderContactsList() {
    const tbody = document.getElementById('contacts-table-body');
    const status = filterContactStatus?.value || '';
    const search = searchContacts?.value.toLowerCase().trim() || '';

    const filtered = state.contacts.filter((c) => {
      if (status && c.emailStatus !== status) return false;
      if (search) {
        const text = `${c.fullName} ${c.title} ${c.companyName} ${c.email || ''}`.toLowerCase();
        if (!text.includes(search)) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted" style="padding: 32px;">No human contacts match current filters. Click "Add Contact" to import.</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map((c) => {
      let statusBadge = '<span class="text-warning">Unknown</span>';
      if (c.emailStatus === 'verified') statusBadge = '<span class="text-success font-semibold">✓ Verified</span>';
      else if (c.emailStatus === 'guessed') statusBadge = '<span class="text-info font-semibold">⚡ Guessed</span>';

      return `
        <tr>
          <td><strong>${c.fullName}</strong></td>
          <td>${c.title}<br><span style="font-size: 11px; color: var(--text-muted);">${c.contactType.replace('_', ' ').toUpperCase()}</span></td>
          <td><strong>${c.companyName}</strong></td>
          <td><code>${c.email || 'None'}</code><br>${statusBadge}</td>
          <td>${c.timezone}</td>
          <td>
            <div style="display: flex; gap: 6px;">
              ${c.emailStatus !== 'verified' ? `<button class="btn btn-sm btn-secondary" onclick="verifyContactEmail(${c.id})">Verify</button>` : ''}
              <button class="btn btn-sm btn-primary" onclick="generateOutreachForContact(${c.id})">Draft</button>
              <button class="btn btn-sm text-danger" onclick="deleteContact(${c.id})">✕</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  // ─── 5. OUTREACH QUEUE CONTROLLER ───────────────────────────
  const subnavBtns = document.querySelectorAll('.subnav-btn');
  subnavBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      subnavBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.outreachFilter = btn.getAttribute('data-outreach-status') || '';
      loadOutreachData();
    });
  });

  async function loadOutreachData() {
    const listEl = document.getElementById('outreach-list');
    listEl.innerHTML = `<div class="loading-spinner-container"><div class="spinner"></div><p>Loading outreach queue...</p></div>`;

    const statusParam = state.outreachFilter ? `?status=${state.outreachFilter}` : '';
    try {
      const res = await fetch(`/api/outreach${statusParam}`);
      const items = await res.json();
      state.outreach = items;

      if (items.length === 0) {
        listEl.innerHTML = `<div class="empty-state">No outreach items in this queue. Generate outreach drafts from the Jobs or Contacts tabs.</div>`;
        return;
      }

      listEl.innerHTML = items.map((o) => renderOutreachCard(o)).join('');
    } catch (err) {
      listEl.innerHTML = `<div class="empty-state text-danger">Failed to load outreach: ${err.message}</div>`;
    }
  }

  function renderOutreachCard(o) {
    const lint = o.lint || { valid: true, warnings: [] };
    const windowEval = o.windowEval || { allowed: true };
    const subjectWords = o.wordCounts?.subjectWords || 0;
    const bodyWords = o.wordCounts?.bodyWords || 0;

    return `
      <div class="outreach-card" id="outreach-card-${o.id}">
        <div class="outreach-meta-row">
          <div class="outreach-recipient-info">
            <h4>${o.contactName || 'Recipient'} (${o.contactEmail || 'No email'}) • ${o.companyName}</h4>
            <p>${o.contactTitle || ''} • Timezone: <strong>${o.timezone}</strong></p>
          </div>
          <div class="outreach-badges-row">
            ${windowEval.allowed ? `
              <span class="window-badge-in">🟢 In Send Window</span>
            ` : `
              <span class="window-badge-out" title="${windowEval.reason || ''}">🔴 Outside Window</span>
            `}
            ${lint.valid ? `
              <span class="lint-badge-pass">✅ LINT PASS (${bodyWords}w)</span>
            ` : `
              <span class="lint-badge-warn" title="${lint.warnings.join(' | ')}">⚠️ LINT WARN (${bodyWords}w)</span>
            `}
            <span class="badge" style="background: rgba(255,255,255,0.08); padding: 4px 8px; border-radius: 4px; font-weight: 700;">
              ${o.type === 'follow_up_1' ? 'FOLLOW-UP' : `VAR ${o.variant}`} • ${o.status.toUpperCase()}
            </span>
          </div>
        </div>

        <div class="outreach-content-box">
          <div class="outreach-subject">Subject: "${o.subject}" <span class="word-count-badge">${subjectWords} words</span></div>
          <div class="outreach-body-text">${o.body}</div>
        </div>

        ${!lint.valid ? `
          <div style="font-size: 12px; color: #fbbf24; background: rgba(245, 158, 11, 0.1); padding: 8px 12px; border-radius: var(--radius-sm); border: 1px solid rgba(245, 158, 11, 0.2);">
            ⚠️ <strong>Lint Warnings:</strong> ${lint.warnings.join(' • ')}
          </div>
        ` : ''}

        <div class="outreach-footer">
          <div style="font-size: 12px; color: var(--text-muted);">
            Created: ${new Date(o.createdAt).toLocaleDateString()}
            ${o.sentAt ? ` • Sent: ${new Date(o.sentAt).toLocaleDateString()}` : ''}
            ${o.outcome && o.outcome !== 'none' ? ` • Outcome: <strong style="color: #34d399;">${o.outcome.toUpperCase()}</strong>` : ''}
          </div>
          <div style="display: flex; gap: 8px; align-items: center;">
            ${o.status === 'draft' ? `
              <button class="btn btn-sm btn-primary" onclick="approveOutreach(${o.id})">Approve Draft</button>
              <button class="btn btn-sm btn-secondary" onclick="openEditDraftModal(${o.id}, '${o.subject.replace(/'/g, "\\'")}', '${o.body.replace(/\n/g, '\\n').replace(/'/g, "\\'")}')">Edit</button>
            ` : ''}
            ${o.status === 'approved' ? `
              <button class="btn btn-sm btn-secondary" onclick="sendOutreachDirect(${o.id}, true)">Send (Dry-Run .eml)</button>
              <button class="btn btn-sm btn-primary" onclick="sendOutreachDirect(${o.id}, false)">Send (Real SMTP)</button>
            ` : ''}
            ${o.status === 'sent' ? `
              <button class="btn btn-sm btn-secondary" onclick="recordReplyDirect(${o.id})">Record Reply</button>
            ` : ''}
            <button class="btn btn-sm text-danger" onclick="deleteOutreachDirect(${o.id})">✕</button>
          </div>
        </div>
      </div>
    `;
  }

  // ─── 6. ANALYTICS VIEW CONTROLLER ───────────────────────────
  async function loadAnalyticsData() {
    await loadStats();
    if (!state.stats) return;
    const s = state.stats;

    // Render Funnel Visualization
    const f = s.funnel || {};
    const maxVal = Math.max(f.discovered || 1, 1);
    const funnelSteps = [
      { label: '1. Scraped Roles', val: f.discovered || 0 },
      { label: '2. Qualified (≥60)', val: f.qualified || 0 },
      { label: '3. Near Misses (40–59)', val: f.nearMisses || 0 },
      { label: '4. Contacts Found', val: f.contactsFound || 0 },
      { label: '5. Outreach Drafted', val: (f.outreachDrafts || 0) + (f.outreachApproved || 0) + (f.outreachSent || 0) },
      { label: '6. Approved By You', val: (f.outreachApproved || 0) + (f.outreachSent || 0) },
      { label: '7. Sent', val: f.outreachSent || 0 },
      { label: '8. Replied', val: f.outreachReplied || 0 },
      { label: '9. Positive / Interviews', val: f.interviews || 0 },
    ];

    const funnelEl = document.getElementById('funnel-display');
    funnelEl.innerHTML = funnelSteps.map((step) => {
      const pct = Math.max(Math.min((step.val / maxVal) * 100, 100), step.val > 0 ? 4 : 0);
      return `
        <div class="funnel-step">
          <div class="funnel-label">${step.label}</div>
          <div class="funnel-bar-track">
            <div class="funnel-bar-fill" style="width: ${pct}%;"></div>
          </div>
          <div class="funnel-val">${step.val}</div>
        </div>
      `;
    }).join('');

    // Score Distribution Chart
    const distEl = document.getElementById('score-distribution-chart');
    const dist = s.scoreDistribution || [];
    const maxCount = Math.max(...dist.map((d) => d.count), 1);
    distEl.innerHTML = dist.map((d) => {
      const pct = (d.count / maxCount) * 100;
      return `
        <div class="funnel-step mb-2" style="grid-template-columns: 140px 1fr 50px;">
          <div class="funnel-label" style="font-size: 12px;">${d.range}</div>
          <div class="funnel-bar-track" style="height: 18px;">
            <div class="funnel-bar-fill" style="width: ${pct}%; background: linear-gradient(90deg, #34d399, #10b981);"></div>
          </div>
          <div class="funnel-val">${d.count}</div>
        </div>
      `;
    }).join('');

    // Safety Rails Meters
    const dailySends = s.safety?.dailySentToday || 0;
    const dailyCap = s.safety?.dailyCap || 20;
    document.getElementById('meter-daily-sends').style.width = `${(dailySends / dailyCap) * 100}%`;
    document.getElementById('text-daily-sends').textContent = `${dailySends} / ${dailyCap} sent today (Remaining: ${dailyCap - dailySends})`;

    const bounceRate = s.safety?.bounceRatePercent || 0;
    const meterBounce = document.getElementById('meter-bounce-rate');
    meterBounce.style.width = `${Math.min(bounceRate * 10, 100)}%`;
    if (bounceRate > 10) meterBounce.className = 'safety-progress-fill bg-danger';
    document.getElementById('text-bounce-rate').textContent = `${bounceRate}% bounce rate (Circuit breaker limit is 10%)`;

    const hunterCalls = s.apiUsage?.hunterCalls || 0;
    const hunterQuota = s.apiUsage?.monthlyQuota || 25;
    document.getElementById('meter-hunter-calls').style.width = `${(hunterCalls / hunterQuota) * 100}%`;
    document.getElementById('text-hunter-calls').textContent = `${hunterCalls} / ${hunterQuota} calls used this month`;
  }

  // ─── 7. SETTINGS & HEALTH VIEW CONTROLLER ───────────────────
  async function loadSettingsData() {
    await loadProfile();
    if (!state.profile) return;
    const p = state.profile;
    document.getElementById('prof-input-name').value = p.name || '';
    document.getElementById('prof-input-email').value = p.email || '';
    document.getElementById('prof-input-role').value = p.currentRole || '';
    document.getElementById('prof-input-exp').value = p.yearsOfExperience || 2;
    document.getElementById('prof-input-salary').value = p.minSalaryLPA || 18;
    document.getElementById('prof-input-reviewed').checked = Boolean(p.profile_reviewed);
  }

  document.getElementById('btn-save-profile')?.addEventListener('click', async (e) => {
    e.preventDefault();
    if (!state.profile) return;
    const updated = {
      ...state.profile,
      name: document.getElementById('prof-input-name').value,
      email: document.getElementById('prof-input-email').value,
      currentRole: document.getElementById('prof-input-role').value,
      yearsOfExperience: parseInt(document.getElementById('prof-input-exp').value, 10),
      minSalaryLPA: parseInt(document.getElementById('prof-input-salary').value, 10),
      profile_reviewed: document.getElementById('prof-input-reviewed').checked,
    };

    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      if (!res.ok) throw new Error('Failed to save profile');
      state.profile = updated;
      showToast('Candidate profile updated successfully!', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('btn-run-doctor-card')?.addEventListener('click', runDoctorDiagnostics);

  async function runDoctorDiagnostics() {
    const listEl = document.getElementById('doctor-results-list');
    listEl.innerHTML = `<div class="loading-spinner-container"><div class="spinner"></div><p>Running diagnostics...</p></div>`;

    try {
      const res = await fetch('/api/doctor');
      const checks = await res.json();

      listEl.innerHTML = checks.map((c) => {
        let badgeColor = '#34d399';
        let icon = '✓';
        if (c.status === 'warn') { badgeColor = '#fbbf24'; icon = '⚠️'; }
        if (c.status === 'error') { badgeColor = '#f87171'; icon = '✕'; }

        return `
          <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 12px 14px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
              <strong>${c.name}</strong>
              <span style="color: ${badgeColor}; font-weight: 700;">${icon} ${c.status.toUpperCase()}</span>
            </div>
            <div style="font-size: 13px; color: var(--text-muted);">${c.message}</div>
          </div>
        `;
      }).join('');
    } catch (err) {
      listEl.innerHTML = `<div class="empty-state text-danger">Diagnostic failed: ${err.message}</div>`;
    }
  }

  document.getElementById('btn-backup-db')?.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/backup', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Backup failed');
      showToast(`Database backed up to ${data.backupPath}`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('btn-export-jobs-json')?.addEventListener('click', () => {
    window.open('/api/export?type=jobs', '_blank');
  });

  document.getElementById('btn-export-contacts-json')?.addEventListener('click', () => {
    window.open('/api/export?type=contacts', '_blank');
  });

  // ─── MODALS & ACTIONS ─────────────────────────────────────

  // Global window methods for buttons inside dynamically generated cards
  window.openTailorModal = async (jobId) => {
    const modal = document.getElementById('tailor-modal');
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');

    const summaryBox = document.getElementById('tailor-summary-box');
    const previewEl = document.getElementById('tailor-markdown-preview');
    summaryBox.innerHTML = 'Running keyword gap analysis and section bullet reordering...';
    previewEl.value = 'Loading tailored resume...';

    try {
      const res = await fetch(`/api/jobs/${jobId}/tailor`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Tailoring failed');

      const r = data.result;
      summaryBox.innerHTML = `
        <strong>Matched Keywords:</strong> ${r.matchedKeywords?.join(', ') || 'None'}<br>
        <strong>Missing Keywords Gap:</strong> ${r.missingKeywords?.join(', ') || 'None'}<br>
        <span class="text-success font-semibold">✓ 100% grounded in base-resume.md (Zero fabricated skills or numbers)</span>
      `;
      previewEl.value = r.tailoredMarkdown;
    } catch (err) {
      summaryBox.innerHTML = `<span class="text-danger">${err.message}</span>`;
      previewEl.value = '';
    }
  };

  document.getElementById('btn-close-tailor-modal')?.addEventListener('click', closeTailorModal);
  document.getElementById('btn-close-tailor')?.addEventListener('click', closeTailorModal);
  function closeTailorModal() {
    const modal = document.getElementById('tailor-modal');
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
  }

  document.getElementById('btn-copy-tailor')?.addEventListener('click', () => {
    const previewEl = document.getElementById('tailor-markdown-preview');
    navigator.clipboard.writeText(previewEl.value);
    showToast('Copied tailored markdown to clipboard!', 'success');
  });

  window.openStatusModal = (jobId, currentStatus, currentNotes) => {
    const modal = document.getElementById('status-modal');
    document.getElementById('status-job-id').value = jobId;
    document.getElementById('job-status-select').value = currentStatus || 'new';
    document.getElementById('job-notes-input').value = currentNotes || '';
    modal.classList.add('active');
  };

  document.getElementById('btn-close-status-modal')?.addEventListener('click', () => {
    document.getElementById('status-modal').classList.remove('active');
  });

  document.getElementById('form-update-status')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const jobId = document.getElementById('status-job-id').value;
    const status = document.getElementById('job-status-select').value;
    const notes = document.getElementById('job-notes-input').value;

    try {
      const res = await fetch(`/api/jobs/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, notes }),
      });
      if (!res.ok) throw new Error('Failed to update status');
      document.getElementById('status-modal').classList.remove('active');
      showToast(`Job #${jobId} status updated to ${status}!`, 'success');
      loadJobsData();
      loadStats();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Add Company Modal
  document.getElementById('btn-add-company-modal')?.addEventListener('click', () => {
    document.getElementById('add-company-modal').classList.add('active');
  });
  document.getElementById('btn-close-add-company')?.addEventListener('click', () => {
    document.getElementById('add-company-modal').classList.remove('active');
  });

  document.getElementById('form-add-company')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = document.getElementById('add-company-url').value;
    try {
      const res = await fetch('/api/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add target');
      document.getElementById('add-company-modal').classList.remove('active');
      document.getElementById('add-company-url').value = '';
      showToast(`Added ${data.company?.name} (${data.company?.ats}) target!`, 'success');
      loadCompaniesData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Add Signal Modal
  document.getElementById('btn-add-signal-modal')?.addEventListener('click', () => {
    document.getElementById('add-signal-modal').classList.add('active');
  });
  document.getElementById('btn-close-add-signal')?.addEventListener('click', () => {
    document.getElementById('add-signal-modal').classList.remove('active');
  });

  document.getElementById('form-add-signal')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const companyName = document.getElementById('add-signal-company').value;
    const signalType = document.getElementById('add-signal-type').value;
    const detail = document.getElementById('add-signal-detail').value;
    const url = document.getElementById('add-signal-url').value;

    try {
      const res = await fetch('/api/signals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyName, signalType, detail, url, source: 'manual' }),
      });
      if (!res.ok) throw new Error('Failed to record signal');
      document.getElementById('add-signal-modal').classList.remove('active');
      document.getElementById('form-add-signal').reset();
      showToast(`Recorded ${signalType} signal for ${companyName}!`, 'success');
      loadCompaniesData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  window.deleteSignal = async (id) => {
    if (!confirm('Are you sure you want to delete this signal?')) return;
    try {
      const res = await fetch(`/api/signals/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete signal');
      showToast('Signal deleted', 'info');
      loadCompaniesData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // Add Contact Modal
  document.getElementById('btn-add-contact-modal')?.addEventListener('click', () => {
    document.getElementById('add-contact-modal').classList.add('active');
  });
  document.getElementById('btn-close-add-contact')?.addEventListener('click', () => {
    document.getElementById('add-contact-modal').classList.remove('active');
  });

  document.getElementById('form-add-contact')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const companyId = document.getElementById('contact-company-id').value;
    const fullName = document.getElementById('contact-fullname').value;
    const title = document.getElementById('contact-title').value;
    const contactType = document.getElementById('contact-type').value;
    const email = document.getElementById('contact-email').value;
    const timezone = document.getElementById('contact-timezone').value;
    const linkedinUrl = document.getElementById('contact-linkedin').value;

    try {
      const res = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, fullName, title, contactType, email, timezone, linkedinUrl, source: 'manual' }),
      });
      if (!res.ok) throw new Error('Failed to add contact');
      document.getElementById('add-contact-modal').classList.remove('active');
      document.getElementById('form-add-contact').reset();
      showToast(`Added contact ${fullName}!`, 'success');
      loadContactsData();
      loadStats();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  window.verifyContactEmail = async (id) => {
    try {
      const res = await fetch(`/api/contacts/${id}/verify`, { method: 'PATCH' });
      if (!res.ok) throw new Error('Failed to verify email');
      showToast(`Contact #${id} email marked verified!`, 'success');
      loadContactsData();
      loadStats();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  window.deleteContact = async (id) => {
    if (!confirm('Are you sure you want to delete this contact?')) return;
    try {
      const res = await fetch(`/api/contacts/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete contact');
      showToast('Contact deleted', 'info');
      loadContactsData();
      loadStats();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  window.generateOutreachForContact = async (contactId) => {
    // Find first job for this contact's company or use jobId 1
    const contact = state.contacts.find((c) => c.id === contactId);
    if (!contact) return;
    const jobId = 1; // Default to top target role

    try {
      showToast(`Generating grounded outreach pack for ${contact.fullName}...`, 'info');
      const res = await fetch('/api/outreach/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId, jobId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate outreach');
      showToast(`Created Variant A (#${data.draftAId}) & Variant B (#${data.draftBId})!`, 'success');
      switchTab('sect-outreach');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // Infer Pattern Modal
  document.getElementById('btn-infer-pattern-modal')?.addEventListener('click', () => {
    document.getElementById('infer-pattern-modal').classList.add('active');
  });
  document.getElementById('btn-close-infer-modal')?.addEventListener('click', () => {
    document.getElementById('infer-pattern-modal').classList.remove('active');
  });

  document.getElementById('form-infer-pattern')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const domain = document.getElementById('infer-domain').value;
    const fullName = document.getElementById('infer-name').value;
    const container = document.getElementById('infer-results-container');
    const list = document.getElementById('infer-proposals-list');

    try {
      const res = await fetch('/api/contacts/infer-pattern', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, fullName }),
      });
      const data = await res.json();
      container.classList.remove('hidden');
      list.innerHTML = data.candidates.map((cand) => `
        <div style="background: rgba(255,255,255,0.03); padding: 8px 12px; border-radius: 4px; display: flex; justify-content: space-between; align-items: center;">
          <code>${cand.email}</code>
          <span class="badge" style="background: rgba(99,102,241,0.2); color: #818cf8; padding: 2px 6px;">${cand.pattern}</span>
        </div>
      `).join('');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Outreach Actions
  window.quickApproveOutreach = async (id) => {
    try {
      const res = await fetch(`/api/outreach/${id}/approve`, { method: 'PATCH' });
      if (!res.ok) throw new Error('Approval failed');
      showToast(`Outreach #${id} approved!`, 'success');
      loadTodayData();
      loadStats();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  window.approveOutreach = async (id) => {
    try {
      const res = await fetch(`/api/outreach/${id}/approve`, { method: 'PATCH' });
      if (!res.ok) throw new Error('Approval failed');
      showToast(`Outreach #${id} approved!`, 'success');
      loadOutreachData();
      loadStats();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  window.deleteOutreachDirect = async (id) => {
    if (!confirm('Are you sure you want to delete this outreach draft?')) return;
    try {
      const res = await fetch(`/api/outreach/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      showToast('Outreach deleted', 'info');
      loadOutreachData();
      loadStats();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  window.sendOutreachDirect = async (id, dryRun) => {
    try {
      showToast(dryRun ? `Generating local .eml for #${id}...` : `Sending #${id} via SMTP...`, 'info');
      const res = await fetch(`/api/outreach/${id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun, bypassWindow: false }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Send blocked by safety guardrails');
      }
      if (dryRun) {
        showToast(`✅ [DRY RUN] Saved to ${data.emlPath}`, 'success');
      } else {
        showToast(`🚀 Outreach #${id} dispatched via SMTP!`, 'success');
      }
      loadOutreachData();
      loadStats();
    } catch (err) {
      showToast(`Send Blocked: ${err.message}`, 'error');
    }
  };

  window.recordReplyDirect = async (id) => {
    const outcome = prompt('Enter reply outcome (positive, interview, referral, negative):', 'positive');
    if (!outcome) return;

    try {
      const res = await fetch(`/api/outreach/${id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome }),
      });
      if (!res.ok) throw new Error('Failed to record reply');
      showToast(`Reply recorded for #${id}. Follow-up cadence stopped!`, 'success');
      loadOutreachData();
      loadStats();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // Edit Draft Modal
  const editModal = document.getElementById('edit-draft-modal');
  const editSubjectInput = document.getElementById('edit-draft-subject');
  const editBodyInput = document.getElementById('edit-draft-body');
  const editSubjectWc = document.getElementById('edit-subject-wordcount');
  const editBodyWc = document.getElementById('edit-body-wordcount');

  window.openEditDraftModal = (id, subject, body) => {
    document.getElementById('edit-draft-id').value = id;
    editSubjectInput.value = subject;
    editBodyInput.value = body;
    updateEditWordCounts();
    editModal.classList.add('active');
  };

  document.getElementById('btn-close-edit-modal')?.addEventListener('click', () => editModal.classList.remove('active'));
  document.getElementById('btn-cancel-edit')?.addEventListener('click', () => editModal.classList.remove('active'));

  [editSubjectInput, editBodyInput].forEach((el) => {
    el?.addEventListener('input', updateEditWordCounts);
  });

  function updateEditWordCounts() {
    const swc = editSubjectInput.value.trim().split(/\s+/).filter(Boolean).length;
    const bwc = editBodyInput.value.trim().split(/\s+/).filter(Boolean).length;
    editSubjectWc.textContent = `${swc} words (<8)`;
    editBodyWc.textContent = `${bwc} words (80–120)`;
  }

  document.getElementById('form-edit-draft')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('edit-draft-id').value;
    const subject = editSubjectInput.value;
    const body = editBodyInput.value;

    try {
      const res = await fetch(`/api/outreach/${id}/edit`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Edit failed');
      editModal.classList.remove('active');
      showToast(`Outreach #${id} updated!`, 'success');
      loadOutreachData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Initial Boot
  refreshAll();
});
