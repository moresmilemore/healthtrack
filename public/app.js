// --- State ---
let currentPage = 'dashboard';
let medications = [];
let visits = [];
let checkins = [];
let timelineFilter = 'all';
let authToken = localStorage.getItem('ht_token');
let currentUser = localStorage.getItem('ht_user');

// --- Auth ---
let isSignup = false;

function showAuth() {
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
}

function showApp() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  document.getElementById('user-display').textContent = displayName(currentUser);
  updateGreeting();
  loadDashboard();
  setupReminders();
}

document.getElementById('auth-toggle-btn').addEventListener('click', () => {
  isSignup = !isSignup;
  document.getElementById('auth-submit-btn').textContent = isSignup ? 'Create Account' : 'Log In';
  document.getElementById('auth-toggle-text').textContent = isSignup ? 'Already have an account?' : "Don't have an account?";
  document.getElementById('auth-toggle-btn').textContent = isSignup ? 'Log In' : 'Sign Up';
  document.getElementById('signup-fields').style.display = isSignup ? '' : 'none';
  const errEl = document.querySelector('.auth-error');
  if (errEl) errEl.classList.remove('visible');
});

document.getElementById('auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('auth-username').value.trim();
  const password = document.getElementById('auth-password').value;
  const btn = document.getElementById('auth-submit-btn');
  btn.disabled = true;
  btn.textContent = isSignup ? 'Creating...' : 'Logging in...';

  try {
    const endpoint = isSignup ? '/api/auth/signup' : '/api/auth/login';
    const payload = { username, password };
    if (isSignup) {
      payload.first_name = document.getElementById('auth-first-name').value.trim();
      payload.last_name = document.getElementById('auth-last-name').value.trim();
    }
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) {
      showAuthError(data.error || 'Something went wrong');
      return;
    }
    authToken = data.token;
    currentUser = data.username;
    localStorage.setItem('ht_token', authToken);
    localStorage.setItem('ht_user', currentUser);
    if (data.first_name) localStorage.setItem('ht_first_name', data.first_name);
    else localStorage.removeItem('ht_first_name');
    if (data.last_name) localStorage.setItem('ht_last_name', data.last_name);
    else localStorage.removeItem('ht_last_name');
    showApp();
  } catch (err) {
    showAuthError('Connection failed. Try again.');
  } finally {
    btn.disabled = false;
    btn.textContent = isSignup ? 'Create Account' : 'Log In';
  }
});

function showAuthError(msg) {
  let errEl = document.querySelector('.auth-error');
  if (!errEl) {
    errEl = document.createElement('div');
    errEl.className = 'auth-error';
    document.getElementById('auth-form').prepend(errEl);
  }
  errEl.textContent = msg;
  errEl.classList.add('visible');
}

function logout() {
  fetch('/api/auth/logout', { method: 'POST', headers: { 'Authorization': 'Bearer ' + authToken } }).catch(() => {});
  authToken = null;
  currentUser = null;
  localStorage.removeItem('ht_token');
  localStorage.removeItem('ht_user');
  localStorage.removeItem('ht_first_name');
  localStorage.removeItem('ht_last_name');
  showAuth();
}

// Check existing session on load
async function checkAuth() {
  if (!authToken) { showAuth(); return; }
  try {
    const res = await fetch('/api/auth/me', { headers: { 'Authorization': 'Bearer ' + authToken } });
    if (!res.ok) { showAuth(); return; }
    const data = await res.json();
    currentUser = data.username;
    localStorage.setItem('ht_user', currentUser);
    if (data.first_name) localStorage.setItem('ht_first_name', data.first_name);
    else localStorage.removeItem('ht_first_name');
    if (data.last_name) localStorage.setItem('ht_last_name', data.last_name);
    else localStorage.removeItem('ht_last_name');
    showApp();
  } catch {
    showAuth();
  }
}

// --- Greeting ---
function displayName(username) {
  const first = localStorage.getItem('ht_first_name');
  const last = localStorage.getItem('ht_last_name');
  if (first || last) return [first, last].filter(Boolean).join(' ');
  if (!username) return '';
  // Strip email domain and clean up
  let name = username.split('@')[0];
  // Remove trailing numbers
  name = name.replace(/\d+$/, '');
  // Replace dots/underscores/dashes with spaces and capitalize
  name = name.replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
  return name || username;
}

function updateGreeting() {
  const hour = new Date().getHours();
  let greeting, sub;
  if (hour < 12) { greeting = 'Good morning'; sub = 'Start your day right'; }
  else if (hour < 17) { greeting = 'Good afternoon'; sub = 'How\'s your day going?'; }
  else if (hour < 21) { greeting = 'Good evening'; sub = 'Wind down and check in'; }
  else { greeting = 'Good night'; sub = 'Log your day before bed'; }
  const el = document.getElementById('greeting');
  if (el) {
    const name = displayName(currentUser);
    el.querySelector('h2').textContent = name ? greeting + ', ' + name : greeting;
    el.querySelector('p').textContent = sub;
  }
}

// --- API Helpers ---
async function api(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (authToken || '') } };
  if (body) opts.body = JSON.stringify(body);
  try {
    const res = await fetch('/api' + path, opts);
    if (res.status === 401) { showAuth(); throw new Error('Please log in'); }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Request failed (${res.status})`);
    }
    return res.json();
  } catch (err) {
    toast(err.message || 'Something went wrong');
    throw err;
  }
}

function toast(msg, type = 'default') {
  const el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
  // Haptic feedback
  if (navigator.vibrate) navigator.vibrate(50);
}

// --- Navigation ---
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    navigateTo(btn.dataset.page);
  });
});

function navigateTo(page) {
  currentPage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === page));

  const titles = { dashboard: 'HealthTrack', meds: 'Medications', visits: 'Doctor Visits', checkin: 'Check-in', history: 'History' };
  if (page === 'dashboard') updateGreeting();
  document.getElementById('page-title').textContent = titles[page];

  // Hide FABs on non-relevant pages
  document.querySelectorAll('.fab').forEach(f => f.style.display = 'none');

  if (page === 'dashboard') loadDashboard();
  else if (page === 'meds') { loadMeds(); document.getElementById('add-med-btn').style.display = 'flex'; }
  else if (page === 'visits') { loadVisits(); document.getElementById('add-visit-btn').style.display = 'flex'; }
  else if (page === 'checkin') loadCheckins();
  else if (page === 'history') loadTimeline();
}

// --- Skeleton helpers ---
function showSkeleton(containerId, count = 3) {
  const el = document.getElementById(containerId);
  if (el) el.innerHTML = Array.from({ length: count }, () => '<div class="skeleton skeleton-card"></div>').join('');
}

// --- Dashboard ---
async function loadDashboard() {
  try {
    showSkeleton('dash-quick-meds', 2);
    showSkeleton('dash-upcoming-visits', 2);
    const data = await api('/dashboard');
    const activeMeds = await api('/medications/active');

    const moodEmojis = ['', '\u{1F629}', '\u{1F61E}', '\u{1F610}', '\u{1F642}', '\u{1F601}'];
    document.getElementById('dash-mood').textContent = data.todayCheckin ? moodEmojis[data.todayCheckin.mood] : '--';
    document.getElementById('dash-meds').textContent = `${data.todayLogCount}/${data.activeMeds}`;
    document.getElementById('dash-energy').textContent = data.todayCheckin ? `${data.todayCheckin.energy}/5` : '--';

    if (data.upcomingVisits.length > 0) {
      const next = data.upcomingVisits[0];
      const d = new Date(next.visit_date + 'T00:00:00');
      const visitLabel = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      document.getElementById('dash-visit').textContent = next.visit_time ? visitLabel + ' ' + formatVisitTime(next.visit_time) : visitLabel;
    } else {
      document.getElementById('dash-visit').textContent = 'None';
    }

    // Quick med log
    const quickMeds = document.getElementById('dash-quick-meds');
    if (activeMeds.length === 0) {
      quickMeds.innerHTML = '<div class="empty-state" style="padding:20px"><p>No active medications</p><p class="empty-hint" onclick="navigateTo(\'meds\')">Go to Meds to add one</p></div>';
    } else {
      quickMeds.innerHTML = activeMeds.map(m => {
        const statusClass = m.todayStatus === 'taken' ? 'quick-med-taken' :
                            m.todayStatus === 'skipped' ? 'quick-med-skipped' : '';
        const statusIcon = m.todayStatus === 'taken' ? '\u2705' :
                           m.todayStatus === 'skipped' ? '\u274C' : '\u{1F48A}';
        return `<button class="quick-med-pill ${statusClass}" onclick="quickLogMed('${m.id}', '${m.todayStatus}')">
          <span class="quick-med-icon">${statusIcon}</span>
          <span class="quick-med-name">${esc(m.name)}</span>
          <span class="quick-med-dose">${esc(m.dosage || '')}</span>
        </button>`;
      }).join('');
    }

    // Upcoming visits
    const visitsList = document.getElementById('dash-upcoming-visits');
    if (data.upcomingVisits.length === 0) {
      visitsList.innerHTML = '<div class="empty-state" style="padding:24px"><div class="empty-icon">\u{1F3E5}</div><p>No upcoming visits</p><p class="empty-hint" onclick="navigateTo(\'visits\')">Tap to add a doctor visit</p></div>';
    } else {
      visitsList.innerHTML = data.upcomingVisits.map(v => {
        const d = new Date(v.visit_date + 'T00:00:00');
        const today = new Date();
        const diff = Math.ceil((d - new Date(today.toISOString().split('T')[0] + 'T00:00:00')) / (1000 * 60 * 60 * 24));
        const urgency = diff <= 1 ? 'visit-today' : diff <= 3 ? 'visit-soon' : '';
        return `<div class="card ${urgency}">
          <div class="card-title">${esc(v.doctor_name)}</div>
          <div class="card-subtitle">${esc(v.specialty || '')}</div>
          <div class="card-detail">\u{1F4C5} ${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}${v.visit_time ? ' at ' + formatVisitTime(v.visit_time) : ''}${diff === 0 ? ' (Today!)' : diff === 1 ? ' (Tomorrow)' : ` (in ${diff} days)`}</div>
          ${v.reason ? `<div class="card-detail">\u{1F4DD} ${esc(v.reason)}</div>` : ''}
          <div class="card-actions"><button class="btn-calendar" onclick="addToCalendar('${v.id}')">Add to Calendar</button></div>
        </div>`;
      }).join('');
    }

    // Store upcoming visits so addToCalendar works from dashboard
    if (data.upcomingVisits.length > 0) {
      data.upcomingVisits.forEach(v => {
        if (!visits.find(x => x.id === v.id)) visits.push(v);
      });
    }

    // Hide chart section if no data
    const chartSection = document.getElementById('mood-chart-section');
    if (data.recentCheckins.length < 2) {
      chartSection.style.display = 'none';
    } else {
      chartSection.style.display = 'block';
      drawMoodChart(data.recentCheckins.reverse());
    }
  } catch (e) {
    // Toast already shown by api(), just prevent crash
  }
}

async function quickLogMed(id, currentStatus) {
  if (currentStatus === 'taken') {
    toast('Already logged today');
    return;
  }
  await api('/medication-logs', 'POST', { medication_id: id, skipped: false });
  toast('Medication taken!', 'success');
  loadDashboard();
}

function drawMoodChart(checkins) {
  const canvas = document.getElementById('mood-chart');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.offsetWidth * dpr;
  canvas.height = 160 * dpr;
  ctx.scale(dpr, dpr);

  const w = canvas.offsetWidth;
  const h = 160;
  const padding = { top: 20, right: 20, bottom: 30, left: 30 };
  const chartW = w - padding.left - padding.right;
  const chartH = h - padding.top - padding.bottom;

  ctx.clearRect(0, 0, w, h);

  if (checkins.length < 2) {
    ctx.fillStyle = '#636E72';
    ctx.font = '14px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Need at least 2 check-ins for chart', w / 2, h / 2);
    return;
  }

  // Grid lines
  ctx.strokeStyle = '#E8E8F0';
  ctx.lineWidth = 1;
  for (let i = 1; i <= 5; i++) {
    const y = padding.top + chartH - (i / 5) * chartH;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(w - padding.right, y);
    ctx.stroke();
  }

  // Y-axis labels
  ctx.fillStyle = '#636E72';
  ctx.font = '11px -apple-system, sans-serif';
  ctx.textAlign = 'right';
  for (let i = 1; i <= 5; i++) {
    const y = padding.top + chartH - (i / 5) * chartH;
    ctx.fillText(i, padding.left - 8, y + 4);
  }

  const points = checkins.map((c, i) => ({
    x: padding.left + (i / (checkins.length - 1)) * chartW,
    y: padding.top + chartH - (c.mood / 5) * chartH,
    date: c.date
  }));

  // Area fill
  ctx.beginPath();
  ctx.moveTo(points[0].x, padding.top + chartH);
  points.forEach(p => ctx.lineTo(p.x, p.y));
  ctx.lineTo(points[points.length - 1].x, padding.top + chartH);
  ctx.closePath();
  const gradient = ctx.createLinearGradient(0, padding.top, 0, padding.top + chartH);
  gradient.addColorStop(0, 'rgba(108, 92, 231, 0.3)');
  gradient.addColorStop(1, 'rgba(108, 92, 231, 0.02)');
  ctx.fillStyle = gradient;
  ctx.fill();

  // Line with smooth curves
  ctx.beginPath();
  ctx.strokeStyle = '#6C5CE7';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
  ctx.stroke();

  // Dots
  points.forEach(p => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#6C5CE7';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = 'white';
    ctx.fill();
  });

  // X-axis labels
  ctx.fillStyle = '#636E72';
  ctx.font = '10px -apple-system, sans-serif';
  ctx.textAlign = 'center';
  points.forEach(p => {
    const d = new Date(p.date + 'T00:00:00');
    ctx.fillText(d.toLocaleDateString('en-US', { weekday: 'short' }), p.x, h - 5);
  });
}

// --- Medications ---
async function loadMeds() {
  try {
  showSkeleton('meds-list', 3);
  showSkeleton('med-logs-list', 2);
  medications = await api('/medications');
  const logs = await api('/medication-logs');

  const list = document.getElementById('meds-list');
  if (medications.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">\u{1F48A}</div><p>No medications yet</p><p class="empty-hint" onclick="document.getElementById(\'voice-btn\').click()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg> Say "Add medication Ibuprofen" or tap +</p></div>';
  } else {
    list.innerHTML = medications.filter(m => m.active).map(m => `
      <div class="card">
        <div class="card-title">${esc(m.name)} <span class="badge badge-active">Active</span></div>
        <div class="card-subtitle">${esc(m.dosage || '')} ${m.frequency ? '&bull; ' + esc(m.frequency) : ''}</div>
        ${m.time_of_day ? `<div class="card-detail">\u{23F0} ${esc(m.time_of_day)}</div>` : ''}
        ${m.notes ? `<div class="card-detail">\u{1F4DD} ${esc(m.notes)}</div>` : ''}
        <div class="card-actions">
          <button class="btn-take" onclick="logMed('${m.id}', false)">Taken \u2713</button>
          <button class="btn-skip" onclick="logMed('${m.id}', true)">Skip</button>
          <button class="btn-edit" onclick="editMed('${m.id}')">Edit</button>
          <button class="btn-delete" onclick="deleteMed('${m.id}')">Delete</button>
        </div>
      </div>
    `).join('');

    // Show inactive medications if any
    const inactive = medications.filter(m => !m.active);
    if (inactive.length > 0) {
      list.innerHTML += `
        <div class="section-header" style="margin-top:16px"><h2>Inactive</h2></div>
        ${inactive.map(m => `
          <div class="card" style="opacity:0.6">
            <div class="card-title">${esc(m.name)} <span class="badge badge-inactive">Inactive</span></div>
            <div class="card-subtitle">${esc(m.dosage || '')}</div>
            <div class="card-actions">
              <button class="btn-take" onclick="reactivateMed('${m.id}')">Reactivate</button>
              <button class="btn-delete" onclick="deleteMed('${m.id}')">Delete</button>
            </div>
          </div>
        `).join('')}
      `;
    }
  }

  const logsList = document.getElementById('med-logs-list');
  if (logs.length === 0) {
    logsList.innerHTML = '<div class="empty-state" style="padding:24px"><div class="empty-icon">\u{1F4CB}</div><p>No logs yet</p><p class="empty-hint">Log a medication above to see history here</p></div>';
  } else {
    logsList.innerHTML = logs.slice(0, 10).map(l => {
      const d = new Date(l.taken_at);
      return `<div class="card">
        <div class="card-title">${esc(l.medication_name)} ${l.dosage ? '(' + esc(l.dosage) + ')' : ''}</div>
        <div class="card-detail">${l.skipped ? '\u274C Skipped' : '\u2705 Taken'} &bull; ${d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
      </div>`;
    }).join('');
  }
  } catch (e) {}
}

async function logMed(id, skipped) {
  await api('/medication-logs', 'POST', { medication_id: id, skipped });
  toast(skipped ? 'Medication skipped' : 'Medication logged!', skipped ? 'default' : 'success');
  loadMeds();
}

async function deleteMed(id) {
  const ok = await confirmAction('Delete Medication', 'This will permanently remove this medication and all its logs.');
  if (ok) {
    await api('/medications/' + id, 'DELETE');
    toast('Medication deleted');
    loadMeds();
  }
}

async function reactivateMed(id) {
  const med = medications.find(m => m.id === id);
  if (med) {
    await api('/medications/' + id, 'PUT', { ...med, active: 1 });
    toast('Medication reactivated!', 'success');
    loadMeds();
  }
}

function editMed(id) {
  const med = medications.find(m => m.id === id);
  if (!med) return;

  const freqOptions = ['', 'Once daily', 'Twice daily', 'Three times daily', 'As needed', 'Weekly'];
  const timeOptions = ['', 'Morning', 'Afternoon', 'Evening', 'Bedtime', 'With meals'];

  openModal('Edit Medication', `
    <form id="med-form">
      <div class="form-group">
        <label for="med-name">Medication Name *</label>
        <input type="text" id="med-name" required value="${esc(med.name)}">
      </div>
      <div class="form-group">
        <label for="med-dosage">Dosage</label>
        <input type="text" id="med-dosage" value="${esc(med.dosage || '')}">
      </div>
      <div class="form-group">
        <label for="med-frequency">Frequency</label>
        <select id="med-frequency">
          ${freqOptions.map(f => `<option value="${f}" ${med.frequency === f ? 'selected' : ''}>${f || 'Select...'}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label for="med-time">Time of Day</label>
        <select id="med-time">
          ${timeOptions.map(t => `<option value="${t}" ${med.time_of_day === t ? 'selected' : ''}>${t || 'Select...'}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label for="med-notes">Notes</label>
        <textarea id="med-notes" rows="2">${esc(med.notes || '')}</textarea>
      </div>
      <div class="form-group">
        <label class="toggle-label">
          <span>Active</span>
          <input type="checkbox" id="med-active" ${med.active ? 'checked' : ''}>
          <span class="toggle-switch"></span>
        </label>
      </div>
      <button type="submit" class="btn btn-primary btn-block">Save Changes</button>
    </form>
  `);

  document.getElementById('med-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await api('/medications/' + id, 'PUT', {
      name: document.getElementById('med-name').value,
      dosage: document.getElementById('med-dosage').value,
      frequency: document.getElementById('med-frequency').value,
      time_of_day: document.getElementById('med-time').value,
      notes: document.getElementById('med-notes').value,
      active: document.getElementById('med-active').checked ? 1 : 0
    });
    closeModal();
    toast('Medication updated!', 'success');
    loadMeds();
  });
}

document.getElementById('add-med-btn').addEventListener('click', () => {
  openModal('Add Medication', `
    <form id="med-form">
      <div class="form-group">
        <label for="med-name">Medication Name *</label>
        <input type="text" id="med-name" required placeholder="e.g. Ibuprofen">
      </div>
      <div class="form-group">
        <label for="med-dosage">Dosage</label>
        <input type="text" id="med-dosage" placeholder="e.g. 200mg">
      </div>
      <div class="form-group">
        <label for="med-frequency">Frequency</label>
        <select id="med-frequency">
          <option value="">Select...</option>
          <option value="Once daily">Once daily</option>
          <option value="Twice daily">Twice daily</option>
          <option value="Three times daily">Three times daily</option>
          <option value="As needed">As needed</option>
          <option value="Weekly">Weekly</option>
        </select>
      </div>
      <div class="form-group">
        <label for="med-time">Time of Day</label>
        <select id="med-time">
          <option value="">Select...</option>
          <option value="Morning">Morning</option>
          <option value="Afternoon">Afternoon</option>
          <option value="Evening">Evening</option>
          <option value="Bedtime">Bedtime</option>
          <option value="With meals">With meals</option>
        </select>
      </div>
      <div class="form-group">
        <label for="med-notes">Notes</label>
        <textarea id="med-notes" rows="2" placeholder="Any additional notes..."></textarea>
      </div>
      <button type="submit" class="btn btn-primary btn-block">Save Medication</button>
    </form>
  `);

  document.getElementById('med-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await api('/medications', 'POST', {
      name: document.getElementById('med-name').value,
      dosage: document.getElementById('med-dosage').value,
      frequency: document.getElementById('med-frequency').value,
      time_of_day: document.getElementById('med-time').value,
      notes: document.getElementById('med-notes').value
    });
    closeModal();
    toast('Medication added!', 'success');
    loadMeds();
  });
});

// --- Doctor Visits ---
async function loadVisits() {
  try {
    showSkeleton('visits-list', 3);
    visits = await api('/visits');
    const list = document.getElementById('visits-list');
    const today = new Date().toISOString().split('T')[0];

    if (visits.length === 0) {
      list.innerHTML = '<div class="empty-state"><div class="empty-icon">\u{1F3E5}</div><p>No visits logged yet</p><p class="empty-hint" onclick="document.getElementById(\'voice-btn\').click()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg> Say "Appointment with Dr. Smith" or tap +</p></div>';
    } else {
      // Separate upcoming and past
      const upcoming = visits.filter(v => v.visit_date >= today);
      const past = visits.filter(v => v.visit_date < today);

      let html = '';
      if (upcoming.length > 0) {
        html += '<div class="section-header"><h2>Upcoming</h2></div>';
        html += upcoming.reverse().map(v => renderVisitCard(v)).join('');
      }
      if (past.length > 0) {
        html += '<div class="section-header" style="margin-top:20px"><h2>Past Visits</h2></div>';
        html += past.map(v => renderVisitCard(v)).join('');
      }
      list.innerHTML = html;
    }
  } catch (e) {}
}

function formatVisitTime(time) {
  if (!time) return '';
  const [h, m] = time.split(':');
  const hr = parseInt(h);
  const ampm = hr >= 12 ? 'PM' : 'AM';
  const hr12 = hr % 12 || 12;
  return `${hr12}:${m} ${ampm}`;
}

function renderVisitCard(v) {
  const d = new Date(v.visit_date + 'T00:00:00');
  const today = new Date().toISOString().split('T')[0];
  const isPast = v.visit_date < today;
  const timeStr = v.visit_time ? ' at ' + formatVisitTime(v.visit_time) : '';
  return `<div class="card ${isPast ? 'card-past' : ''}">
    <div class="card-title">${esc(v.doctor_name)}</div>
    <div class="card-subtitle">${esc(v.specialty || 'General')}</div>
    <div class="card-detail">\u{1F4C5} ${d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}${timeStr}</div>
    ${v.location ? `<div class="card-detail">\u{1F4CD} ${esc(v.location)}</div>` : ''}
    ${v.reason ? `<div class="card-detail">\u{1F4DD} ${esc(v.reason)}</div>` : ''}
    ${v.notes ? `<div class="card-detail">\u{1F4AC} ${esc(v.notes)}</div>` : ''}
    ${v.follow_up_date ? `<div class="card-detail">\u{1F501} Follow-up: ${new Date(v.follow_up_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>` : ''}
    <div class="card-actions">
      <button class="btn-calendar" onclick="addToCalendar('${v.id}')">Add to Calendar</button>
      <button class="btn-edit" onclick="editVisit('${v.id}')">Edit</button>
      <button class="btn-delete" onclick="deleteVisit('${v.id}')">Delete</button>
    </div>
  </div>`;
}

async function deleteVisit(id) {
  const ok = await confirmAction('Delete Visit', 'This will permanently remove this doctor visit.');
  if (ok) {
    await api('/visits/' + id, 'DELETE');
    toast('Visit deleted');
    loadVisits();
  }
}

function editVisit(id) {
  const v = visits.find(x => x.id === id);
  if (!v) return;

  openModal('Edit Visit', `
    <form id="visit-form">
      <div class="form-group">
        <label for="visit-doctor">Doctor Name *</label>
        <input type="text" id="visit-doctor" required value="${esc(v.doctor_name)}">
      </div>
      <div class="form-group">
        <label for="visit-specialty">Specialty</label>
        <input type="text" id="visit-specialty" value="${esc(v.specialty || '')}">
      </div>
      <div class="form-group form-row">
        <div class="form-col">
          <label for="visit-date">Date *</label>
          <input type="date" id="visit-date" required value="${v.visit_date}">
        </div>
        <div class="form-col">
          <label for="visit-time">Time</label>
          <input type="time" id="visit-time" value="${v.visit_time || ''}">
        </div>
      </div>
      <div class="form-group">
        <label for="visit-location">Location</label>
        <input type="text" id="visit-location" value="${esc(v.location || '')}">
      </div>
      <div class="form-group">
        <label for="visit-reason">Reason</label>
        <input type="text" id="visit-reason" value="${esc(v.reason || '')}">
      </div>
      <div class="form-group">
        <label for="visit-notes">Notes</label>
        <textarea id="visit-notes" rows="3">${esc(v.notes || '')}</textarea>
      </div>
      <div class="form-group">
        <label for="visit-followup">Follow-up Date</label>
        <input type="date" id="visit-followup" value="${v.follow_up_date || ''}">
      </div>
      <button type="submit" class="btn btn-primary btn-block">Save Changes</button>
    </form>
  `);

  document.getElementById('visit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await api('/visits/' + id, 'PUT', {
      doctor_name: document.getElementById('visit-doctor').value,
      specialty: document.getElementById('visit-specialty').value,
      visit_date: document.getElementById('visit-date').value,
      visit_time: document.getElementById('visit-time').value || null,
      location: document.getElementById('visit-location').value,
      reason: document.getElementById('visit-reason').value,
      notes: document.getElementById('visit-notes').value,
      follow_up_date: document.getElementById('visit-followup').value || null
    });
    closeModal();
    toast('Visit updated!', 'success');
    loadVisits();
  });
}

document.getElementById('add-visit-btn').addEventListener('click', () => {
  const today = new Date().toISOString().split('T')[0];
  openModal('Add Doctor Visit', `
    <form id="visit-form">
      <div class="form-group">
        <label for="visit-doctor">Doctor Name *</label>
        <input type="text" id="visit-doctor" required placeholder="e.g. Dr. Smith">
      </div>
      <div class="form-group">
        <label for="visit-specialty">Specialty</label>
        <input type="text" id="visit-specialty" placeholder="e.g. Cardiologist">
      </div>
      <div class="form-group form-row">
        <div class="form-col">
          <label for="visit-date">Date *</label>
          <input type="date" id="visit-date" required value="${today}">
        </div>
        <div class="form-col">
          <label for="visit-time">Time</label>
          <input type="time" id="visit-time" placeholder="e.g. 10:30 AM">
        </div>
      </div>
      <div class="form-group">
        <label for="visit-location">Location</label>
        <input type="text" id="visit-location" placeholder="e.g. Downtown Medical Center">
      </div>
      <div class="form-group">
        <label for="visit-reason">Reason</label>
        <input type="text" id="visit-reason" placeholder="e.g. Annual checkup">
      </div>
      <div class="form-group">
        <label for="visit-notes">Notes</label>
        <textarea id="visit-notes" rows="3" placeholder="Visit notes..."></textarea>
      </div>
      <div class="form-group">
        <label for="visit-followup">Follow-up Date</label>
        <input type="date" id="visit-followup">
      </div>
      <button type="submit" class="btn btn-primary btn-block">Save Visit</button>
    </form>
  `);

  document.getElementById('visit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await api('/visits', 'POST', {
      doctor_name: document.getElementById('visit-doctor').value,
      specialty: document.getElementById('visit-specialty').value,
      visit_date: document.getElementById('visit-date').value,
      visit_time: document.getElementById('visit-time').value || null,
      location: document.getElementById('visit-location').value,
      reason: document.getElementById('visit-reason').value,
      notes: document.getElementById('visit-notes').value,
      follow_up_date: document.getElementById('visit-followup').value || null
    });
    closeModal();
    toast('Visit added!', 'success');
    loadVisits();
  });
});

// --- Check-ins ---
const emojiScales = document.querySelectorAll('.emoji-scale');
emojiScales.forEach(scale => {
  const spans = scale.querySelectorAll('span');
  const input = scale.nextElementSibling;
  spans[2].classList.add('selected');
  spans.forEach(span => {
    span.addEventListener('click', () => {
      spans.forEach(s => s.classList.remove('selected'));
      span.classList.add('selected');
      input.value = span.dataset.val;
      if (navigator.vibrate) navigator.vibrate(30);
    });
  });
});

document.getElementById('checkin-pain').addEventListener('input', (e) => {
  document.getElementById('pain-display').textContent = e.target.value;
});

document.getElementById('checkin-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  await api('/checkins', 'POST', {
    mood: parseInt(document.getElementById('checkin-mood').value),
    energy: parseInt(document.getElementById('checkin-energy').value),
    sleep_quality: parseInt(document.getElementById('checkin-sleep').value),
    pain_level: parseInt(document.getElementById('checkin-pain').value),
    symptoms: document.getElementById('checkin-symptoms').value,
    notes: document.getElementById('checkin-notes').value
  });
  toast('Check-in saved!', 'success');
  document.getElementById('checkin-form').reset();
  emojiScales.forEach(scale => {
    const spans = scale.querySelectorAll('span');
    spans.forEach(s => s.classList.remove('selected'));
    spans[2].classList.add('selected');
    scale.nextElementSibling.value = '3';
  });
  document.getElementById('pain-display').textContent = '0';
  loadCheckins();
});

async function loadCheckins() {
  try {
    showSkeleton('checkins-list', 3);
    checkins = await api('/checkins');
    const list = document.getElementById('checkins-list');
    if (checkins.length === 0) {
      list.innerHTML = '<div class="empty-state"><div class="empty-icon">\u{1F60A}</div><p>No check-ins yet</p><p class="empty-hint" onclick="document.getElementById(\'voice-btn\').click()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg> Say "I\'m feeling good today" or fill in above</p></div>';
    } else {
      const moodEmojis = ['', '\u{1F629}', '\u{1F61E}', '\u{1F610}', '\u{1F642}', '\u{1F601}'];
      list.innerHTML = checkins.map(c => {
        const d = new Date(c.date + 'T00:00:00');
        return `<div class="card checkin-card">
          <div class="card-title">${d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</div>
          <div class="mood-bar">
            <div class="mood-bar-item"><span class="bar-value">${moodEmojis[c.mood]}</span>Mood</div>
            <div class="mood-bar-item"><span class="bar-value">${c.energy}/5</span>Energy</div>
            <div class="mood-bar-item"><span class="bar-value">${c.sleep_quality}/5</span>Sleep</div>
            <div class="mood-bar-item"><span class="bar-value">${c.pain_level}/10</span>Pain</div>
          </div>
          ${c.symptoms ? `<div class="card-detail" style="margin-top:8px">\u{1F912} ${esc(c.symptoms)}</div>` : ''}
          ${c.notes ? `<div class="card-detail">\u{1F4DD} ${esc(c.notes)}</div>` : ''}
          <div class="card-actions">
            <button class="btn-delete" onclick="deleteCheckin('${c.id}')">Delete</button>
          </div>
        </div>`;
      }).join('');
    }
  } catch (e) {}
}

async function deleteCheckin(id) {
  const ok = await confirmAction('Delete Check-in', 'This will permanently remove this check-in entry.');
  if (ok) {
    await api('/checkins/' + id, 'DELETE');
    toast('Check-in deleted');
    loadCheckins();
  }
}

// --- History / Timeline ---
async function loadTimeline() {
  try {
    showSkeleton('timeline-list', 4);
    const events = await api('/timeline?filter=' + timelineFilter);
    const list = document.getElementById('timeline-list');

    if (events.length === 0) {
      list.innerHTML = '<div class="empty-state"><div class="empty-icon">\u{1F4CB}</div><p>No health events yet</p></div>';
    } else {
      // Group by date
      const grouped = {};
      events.forEach(e => {
        const dateKey = String(e.date).split('T')[0];
        if (!grouped[dateKey]) grouped[dateKey] = [];
        grouped[dateKey].push(e);
      });

      list.innerHTML = Object.entries(grouped).map(([date, items]) => {
        const d = new Date(date + 'T00:00:00');
        return `
          <div class="timeline-date">${d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
          ${items.map(item => `
            <div class="card timeline-card timeline-${item.type}">
              <div class="timeline-icon">${item.icon}</div>
              <div class="timeline-content">
                <div class="card-title">${esc(item.title)}</div>
                <div class="card-detail">${esc(item.detail)}</div>
              </div>
            </div>
          `).join('')}
        `;
      }).join('');
    }
  } catch (e) {}
}

// Timeline filter chips
document.querySelectorAll('.filter-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    timelineFilter = chip.dataset.filter;
    loadTimeline();
  });
});

// Export (with auth token)
document.getElementById('export-btn').addEventListener('click', async () => {
  try {
    const res = await fetch('/api/export', { headers: { 'Authorization': 'Bearer ' + (authToken || '') } });
    if (!res.ok) throw new Error('Export failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'healthtrack-export.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('Export downloaded!', 'success');
  } catch (err) {
    toast('Export failed');
  }
});

// --- Modal ---
function openModal(title, html) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = html;
  document.getElementById('modal-overlay').classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('active');
  document.body.style.overflow = '';
}

document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal-overlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
});

// --- Voice Assistant ---
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let voiceResult = '';
let micStream = null;
let micGranted = false;

// Request mic permission once and keep the stream so the browser remembers the grant
async function ensureMicPermission() {
  if (micGranted) return true;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micGranted = true;
    localStorage.setItem('ht_mic_granted', '1');
    return true;
  } catch (err) {
    toast('Microphone access is needed for voice commands');
    return false;
  }
}

// On load, if we previously granted, re-acquire silently so browser doesn't re-prompt
if (localStorage.getItem('ht_mic_granted') === '1' && navigator.mediaDevices) {
  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    micStream = stream;
    micGranted = true;
  }).catch(() => {});
}

let voiceProcessed = false;
let voiceTimeout = null;

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = 'en-US';
  recognition.maxAlternatives = 1;

  recognition.onresult = (event) => {
    let interim = '';
    let final = '';
    for (let i = 0; i < event.results.length; i++) {
      const t = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        final += t;
      } else {
        interim += t;
      }
    }
    voiceResult = final || interim;
    document.getElementById('voice-transcript').textContent = voiceResult;

    if (final && !voiceProcessed) {
      voiceProcessed = true;
      clearTimeout(voiceTimeout);
      try { recognition.stop(); } catch(e) {}
      document.getElementById('voice-status').textContent = 'Thinking...';
      processVoiceCommand(final);
    }
  };

  recognition.onerror = (e) => {
    clearTimeout(voiceTimeout);
    if (e.error === 'not-allowed') {
      document.getElementById('voice-status').textContent = 'Mic access denied';
      document.getElementById('voice-transcript').textContent = 'Please allow microphone access in your browser settings';
      micGranted = false;
      localStorage.removeItem('ht_mic_granted');
      setTimeout(closeVoice, 2500);
    } else if (e.error === 'no-speech') {
      document.getElementById('voice-status').textContent = 'No speech detected';
      document.getElementById('voice-transcript').textContent = 'Tap the mic and try speaking again';
      setTimeout(closeVoice, 2000);
    } else if (e.error === 'aborted') {
      // User cancelled or we stopped it — do nothing
    } else {
      document.getElementById('voice-status').textContent = 'Could not hear you';
      setTimeout(closeVoice, 2000);
    }
  };

  recognition.onend = () => {
    document.getElementById('voice-btn').classList.remove('listening');
    clearTimeout(voiceTimeout);
    // If recognition ended without processing (e.g. silence timeout), use whatever we have
    if (!voiceProcessed && voiceResult.trim()) {
      voiceProcessed = true;
      document.getElementById('voice-status').textContent = 'Thinking...';
      processVoiceCommand(voiceResult.trim());
    } else if (!voiceProcessed) {
      document.getElementById('voice-status').textContent = 'No speech detected';
      document.getElementById('voice-transcript').textContent = 'Tap the mic and try again';
      setTimeout(closeVoice, 2000);
    }
  };
}

document.getElementById('voice-btn').addEventListener('click', async () => {
  if (!recognition) {
    toast('Voice not supported in this browser');
    return;
  }
  const allowed = await ensureMicPermission();
  if (allowed) openVoice();
});

document.getElementById('voice-cancel').addEventListener('click', closeVoice);

function openVoice() {
  voiceResult = '';
  voiceProcessed = false;
  clearTimeout(voiceTimeout);
  document.getElementById('voice-overlay').classList.add('active');
  document.getElementById('voice-status').textContent = 'Listening...';
  document.getElementById('voice-transcript').textContent = '"I took my Advil"\n"Feeling great, energy 4"\n"Doctor appointment tomorrow"\n"Add medication Tylenol 500mg"\n"Show my visits"';
  document.getElementById('voice-confirm').style.display = 'none';
  document.getElementById('voice-btn').classList.add('listening');
  try { recognition.start(); } catch(e) {
    // Already running, restart
    try { recognition.stop(); } catch(e2) {}
    setTimeout(() => { try { recognition.start(); } catch(e3) {} }, 200);
  }
  // Safety timeout: if nothing happens in 15s, close
  voiceTimeout = setTimeout(() => {
    if (!voiceProcessed) {
      if (voiceResult.trim()) {
        voiceProcessed = true;
        document.getElementById('voice-status').textContent = 'Thinking...';
        try { recognition.stop(); } catch(e) {}
        processVoiceCommand(voiceResult.trim());
      } else {
        document.getElementById('voice-status').textContent = 'No speech detected';
        setTimeout(closeVoice, 1500);
      }
    }
  }, 15000);
}

function closeVoice() {
  clearTimeout(voiceTimeout);
  document.getElementById('voice-overlay').classList.remove('active');
  document.getElementById('voice-btn').classList.remove('listening');
  try { recognition.stop(); } catch(e) {}
}

async function processVoiceCommand(text) {
  const status = document.getElementById('voice-status');
  const transcriptEl = document.getElementById('voice-transcript');
  status.textContent = 'Thinking...';
  transcriptEl.textContent = text;

  try {
    const res = await fetch('/api/voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (authToken || '') },
      body: JSON.stringify({ transcript: text })
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      status.textContent = errData.error || 'Voice AI error';
      transcriptEl.textContent = 'Check that GEMINI_API_KEY is set in your environment';
      setTimeout(closeVoice, 3000);
      return;
    }

    const result = await res.json();

    if (result.action === 'fallback') {
      status.textContent = result.message || 'Voice AI not available';
      transcriptEl.textContent = 'Make sure GEMINI_API_KEY is configured';
      setTimeout(closeVoice, 3000);
      return;
    }

    await executeVoiceAction(result);
  } catch (e) {
    status.textContent = 'Connection error';
    transcriptEl.textContent = 'Could not reach the voice server';
    setTimeout(closeVoice, 3000);
  }
}

async function executeVoiceAction(result) {
  const status = document.getElementById('voice-status');
  const transcript = document.getElementById('voice-transcript');

  try {
    switch (result.action) {
      case 'log_med':
        await api('/medication-logs', 'POST', { medication_id: result.medication_id, skipped: result.skipped || false });
        status.textContent = result.message || 'Medication logged!';
        setTimeout(() => { closeVoice(); if (currentPage === 'meds') loadMeds(); if (currentPage === 'dashboard') loadDashboard(); }, 1200);
        break;

      case 'add_med':
        await api('/medications', 'POST', {
          name: result.name,
          dosage: result.dosage || '',
          frequency: result.frequency || '',
          time_of_day: result.time_of_day || '',
          notes: ''
        });
        status.textContent = result.message || 'Medication added!';
        setTimeout(() => { closeVoice(); if (currentPage === 'meds') loadMeds(); if (currentPage === 'dashboard') loadDashboard(); }, 1200);
        break;

      case 'checkin':
        await api('/checkins', 'POST', {
          mood: Math.min(5, Math.max(1, result.mood || 3)),
          energy: Math.min(5, Math.max(1, result.energy || 3)),
          sleep_quality: Math.min(5, Math.max(1, result.sleep_quality || 3)),
          pain_level: Math.min(10, Math.max(0, result.pain_level || 0)),
          symptoms: result.symptoms || '',
          notes: result.notes || ''
        });
        status.textContent = result.message || 'Check-in saved!';
        setTimeout(() => { closeVoice(); if (currentPage === 'checkin') loadCheckins(); if (currentPage === 'dashboard') loadDashboard(); }, 1200);
        break;

      case 'add_visit':
        await api('/visits', 'POST', {
          doctor_name: result.doctor_name || 'Doctor Visit',
          specialty: result.specialty || '',
          visit_date: result.visit_date || new Date().toISOString().split('T')[0],
          visit_time: result.visit_time || null,
          location: result.location || '',
          reason: result.reason || '',
          notes: 'Added via voice',
          follow_up_date: null
        });
        status.textContent = result.message || 'Visit added!';
        setTimeout(() => { closeVoice(); if (currentPage === 'visits') loadVisits(); if (currentPage === 'dashboard') loadDashboard(); }, 1200);
        break;

      case 'navigate':
        status.textContent = result.message || 'Opening...';
        setTimeout(() => { closeVoice(); navigateTo(result.page || 'dashboard'); }, 600);
        break;

      case 'reply':
        status.textContent = result.message || "I'm here to help!";
        transcript.textContent = '';
        setTimeout(closeVoice, 3000);
        break;

      default:
        status.textContent = result.message || "Didn't catch that";
        setTimeout(closeVoice, 2000);
    }
  } catch (e) {
    status.textContent = 'Something went wrong';
    setTimeout(closeVoice, 2000);
  }
}


// --- Medication Reminders (Notification API) ---
async function setupReminders() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;
  }
  if (Notification.permission !== 'granted') return;

  // Check for pending meds every 30 minutes
  setInterval(async () => {
    const meds = await api('/medications/active');
    const pending = meds.filter(m => m.todayStatus === 'pending');
    if (pending.length > 0) {
      const hour = new Date().getHours();
      const timeSlots = {
        'Morning': [7, 10],
        'Afternoon': [12, 15],
        'Evening': [17, 20],
        'Bedtime': [21, 23],
        'With meals': [7, 19]
      };

      pending.forEach(m => {
        if (m.time_of_day && timeSlots[m.time_of_day]) {
          const [start, end] = timeSlots[m.time_of_day];
          if (hour >= start && hour <= end) {
            new Notification('HealthTrack Reminder', {
              body: `Time to take ${m.name}${m.dosage ? ' (' + m.dosage + ')' : ''}`,
              icon: '/icon-192.svg',
              tag: 'med-' + m.id,
              renotify: false
            });
          }
        }
      });
    }
  }, 30 * 60 * 1000);
}

// --- Calendar Integration (iOS-compatible .ics) ---
function addToCalendar(visitId) {
  const v = visits.find(x => x.id === visitId);
  if (!v) return;

  const dateClean = v.visit_date.replace(/-/g, '');
  const now = new Date();
  const dtstamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const uid = `healthtrack-${visitId}-${Date.now()}@healthtrack.app`;

  const summary = `${v.doctor_name}${v.specialty ? ' - ' + v.specialty : ''}`;
  const descParts = [v.reason, v.notes].filter(Boolean);
  const description = descParts.join(' | ').replace(/[,;\\]/g, ' ');
  const location = (v.location || '').replace(/[,;\\]/g, ' ');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//HealthTrack//HealthTrack//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`
  ];

  if (v.visit_time) {
    const timeClean = v.visit_time.replace(/:/g, '') + '00';
    lines.push(`DTSTART:${dateClean}T${timeClean}`);
    // 1 hour duration
    const startH = parseInt(v.visit_time.split(':')[0]);
    const endH = String(startH + 1).padStart(2, '0');
    const endMin = v.visit_time.split(':')[1];
    lines.push(`DTEND:${dateClean}T${endH}${endMin}00`);
  } else {
    const endDate = new Date(v.visit_date + 'T00:00:00');
    endDate.setDate(endDate.getDate() + 1);
    const endStr = endDate.toISOString().split('T')[0].replace(/-/g, '');
    lines.push(`DTSTART;VALUE=DATE:${dateClean}`);
    lines.push(`DTEND;VALUE=DATE:${endStr}`);
  }

  lines.push(`SUMMARY:${summary}`);

  if (description) lines.push(`DESCRIPTION:${description}`);
  if (location) lines.push(`LOCATION:${location}`);

  // Reminder alarm 1 hour before (9 AM day-of for all-day events)
  lines.push(
    'BEGIN:VALARM',
    'TRIGGER:-PT1H',
    'ACTION:DISPLAY',
    `DESCRIPTION:Doctor visit with ${v.doctor_name}`,
    'END:VALARM'
  );

  lines.push('END:VEVENT', 'END:VCALENDAR');

  const icsContent = lines.join('\r\n');
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${v.doctor_name.replace(/[^a-zA-Z0-9]/g, '-')}-${v.visit_date}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('Opening in Calendar...', 'success');
}

// --- Custom Confirm Dialog ---
function confirmAction(title, message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-dialog">
        <h3>${title}</h3>
        <p>${message}</p>
        <div class="confirm-actions">
          <button class="confirm-cancel">Cancel</button>
          <button class="confirm-delete">Delete</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('.confirm-cancel').addEventListener('click', () => { overlay.remove(); resolve(false); });
    overlay.querySelector('.confirm-delete').addEventListener('click', () => { overlay.remove(); resolve(true); });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.remove(); resolve(false); } });
  });
}

// --- Utilities ---
function esc(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// --- Scroll-aware header ---
let lastScrollY = 0;
window.addEventListener('scroll', () => {
  const header = document.querySelector('.app-header');
  if (window.scrollY > 10) {
    header.classList.add('scrolled');
  } else {
    header.classList.remove('scrolled');
  }
  lastScrollY = window.scrollY;
}, { passive: true });

// --- Init ---
checkAuth();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
