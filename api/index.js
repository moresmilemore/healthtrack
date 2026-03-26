const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const app = express();

app.use(express.json());

// --- Database Setup ---
let cachedDb = null;
let dbConnectPromise = null;

async function getDb() {
  if (cachedDb) return cachedDb;
  if (!dbConnectPromise) {
    const client = new MongoClient(process.env.MONGODB_URI);
    dbConnectPromise = client.connect().then(() => {
      cachedDb = client.db(process.env.MONGODB_DB || 'healthtrack');
      return cachedDb;
    });
  }
  return dbConnectPromise;
}

async function initDb() {
  const db = await getDb();
  await db.collection('users').createIndex({ username: 1 }, { unique: true });
  await db.collection('sessions').createIndex({ token: 1 }, { unique: true });
  await db.collection('sessions').createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 });
  await db.collection('medications').createIndex({ user_id: 1, active: 1, time_of_day: 1, name: 1 });
  await db.collection('medication_logs').createIndex({ user_id: 1, medication_id: 1, taken_at: -1 });
  await db.collection('medication_logs').createIndex({ user_id: 1, taken_at: -1 });
  await db.collection('doctor_visits').createIndex({ user_id: 1, visit_date: -1 });
  await db.collection('checkins').createIndex({ user_id: 1, date: -1 });
}

let dbInitPromise = null;
app.use(async (req, res, next) => {
  try {
    if (!dbInitPromise) dbInitPromise = initDb();
    await dbInitPromise;
    next();
  } catch (err) {
    dbInitPromise = null;
    res.status(500).json({ error: 'Database initialization failed' });
  }
});

// --- Validation helpers ---
function parseObjectId(raw) {
  try { return new ObjectId(raw); } catch { return null; }
}

function requireFields(body, fields) {
  for (const f of fields) {
    if (!body[f] || (typeof body[f] === 'string' && !body[f].trim())) return f;
  }
  return null;
}

function normalize(doc) {
  if (!doc) return doc;
  const { _id, user_id, ...rest } = doc;
  return { id: _id.toString(), ...rest };
}

function normalizeAll(docs) { return docs.map(normalize); }

// --- Auth API ---
app.post('/api/auth/signup', async (req, res) => {
  try {
    const missing = requireFields(req.body, ['username', 'password']);
    if (missing) return res.status(400).json({ error: `${missing} is required` });

    const { username, password, first_name, last_name } = req.body;
    if (username.length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const db = await getDb();
    const existing = await db.collection('users').findOne({ username: username.toLowerCase() });
    if (existing) return res.status(409).json({ error: 'Username already taken' });

    const hash = await bcrypt.hash(password, 10);
    const result = await db.collection('users').insertOne({
      username: username.toLowerCase(),
      first_name: (first_name || '').trim() || null,
      last_name: (last_name || '').trim() || null,
      password_hash: hash,
      created_at: new Date()
    });

    const token = crypto.randomBytes(32).toString('hex');
    await db.collection('sessions').insertOne({
      token,
      user_id: result.insertedId,
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    });

    res.json({ token, username: username.toLowerCase(), first_name: (first_name || '').trim() || null, last_name: (last_name || '').trim() || null });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create account' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const missing = requireFields(req.body, ['username', 'password']);
    if (missing) return res.status(400).json({ error: `${missing} is required` });

    const { username, password } = req.body;
    const db = await getDb();
    const user = await db.collection('users').findOne({ username: username.toLowerCase() });
    if (!user) return res.status(401).json({ error: 'Invalid username or password' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid username or password' });

    const token = crypto.randomBytes(32).toString('hex');
    await db.collection('sessions').insertOne({
      token,
      user_id: user._id,
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    });

    res.json({ token, username: user.username, first_name: user.first_name || null, last_name: user.last_name || null });
  } catch (err) {
    res.status(500).json({ error: 'Failed to log in' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (token) {
      const db = await getDb();
      await db.collection('sessions').deleteOne({ token });
    }
    res.json({ success: true });
  } catch (err) {
    res.json({ success: true });
  }
});

app.get('/api/auth/me', async (req, res) => {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Not authenticated' });

    const db = await getDb();
    const session = await db.collection('sessions').findOne({ token, expires_at: { $gt: new Date() } });
    if (!session) return res.status(401).json({ error: 'Session expired' });

    const user = await db.collection('users').findOne({ _id: session.user_id });
    if (!user) return res.status(401).json({ error: 'User not found' });

    res.json({ username: user.username, first_name: user.first_name || null, last_name: user.last_name || null });
  } catch (err) {
    res.status(500).json({ error: 'Auth check failed' });
  }
});

// --- Profile Update (requires auth inline) ---
app.put('/api/auth/profile', async (req, res) => {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Not authenticated' });

    const db = await getDb();
    const session = await db.collection('sessions').findOne({ token, expires_at: { $gt: new Date() } });
    if (!session) return res.status(401).json({ error: 'Session expired' });

    const { first_name, last_name } = req.body;
    await db.collection('users').updateOne({ _id: session.user_id }, {
      $set: { first_name: (first_name || '').trim() || null, last_name: (last_name || '').trim() || null }
    });

    const user = await db.collection('users').findOne({ _id: session.user_id });
    res.json({ username: user.username, first_name: user.first_name || null, last_name: user.last_name || null });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// --- Auth Middleware (protects all routes below) ---
async function auth(req, res, next) {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Not authenticated' });

    const db = await getDb();
    const session = await db.collection('sessions').findOne({ token, expires_at: { $gt: new Date() } });
    if (!session) return res.status(401).json({ error: 'Session expired' });

    req.userId = session.user_id;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Authentication failed' });
  }
}

// --- Medications API ---
app.get('/api/medications', auth, async (req, res) => {
  try {
    const db = await getDb();
    const meds = await db.collection('medications').find({ user_id: req.userId }).sort({ created_at: -1 }).toArray();
    res.json(normalizeAll(meds));
  } catch (err) {
    res.status(500).json({ error: 'Failed to load medications' });
  }
});

app.post('/api/medications', auth, async (req, res) => {
  try {
    const missing = requireFields(req.body, ['name']);
    if (missing) return res.status(400).json({ error: `${missing} is required` });

    const db = await getDb();
    const { name, dosage, frequency, time_of_day, notes } = req.body;
    const doc = {
      user_id: req.userId,
      name, dosage: dosage || null, frequency: frequency || null,
      time_of_day: time_of_day || null, notes: notes || null,
      active: 1, created_at: new Date(), updated_at: new Date()
    };
    const result = await db.collection('medications').insertOne(doc);
    res.json({ id: result.insertedId.toString(), ...doc });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add medication' });
  }
});

app.get('/api/medications/active', auth, async (req, res) => {
  try {
    const db = await getDb();
    const today = new Date().toISOString().split('T')[0];
    const meds = await db.collection('medications').find({ user_id: req.userId, active: 1 }).sort({ time_of_day: 1, name: 1 }).toArray();

    const startOfDay = new Date(today + 'T00:00:00.000Z');
    const endOfDay = new Date(today + 'T23:59:59.999Z');
    const todayLogs = await db.collection('medication_logs').find({
      user_id: req.userId, taken_at: { $gte: startOfDay, $lte: endOfDay }
    }).toArray();

    const loggedMap = {};
    todayLogs.forEach(l => { loggedMap[l.medication_id.toString()] = l.skipped ? 'skipped' : 'taken'; });

    const result = normalizeAll(meds).map(m => ({ ...m, todayStatus: loggedMap[m.id] || 'pending' }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load active medications' });
  }
});

app.put('/api/medications/:id', auth, async (req, res) => {
  try {
    const oid = parseObjectId(req.params.id);
    if (!oid) return res.status(400).json({ error: 'Invalid medication ID' });
    const missing = requireFields(req.body, ['name']);
    if (missing) return res.status(400).json({ error: `${missing} is required` });

    const db = await getDb();
    const { name, dosage, frequency, time_of_day, notes, active } = req.body;
    await db.collection('medications').updateOne({ _id: oid, user_id: req.userId }, {
      $set: { name, dosage: dosage || null, frequency: frequency || null,
        time_of_day: time_of_day || null, notes: notes || null, active: active ?? 1, updated_at: new Date() }
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update medication' });
  }
});

app.delete('/api/medications/:id', auth, async (req, res) => {
  try {
    const oid = parseObjectId(req.params.id);
    if (!oid) return res.status(400).json({ error: 'Invalid medication ID' });
    const db = await getDb();
    await db.collection('medications').deleteOne({ _id: oid, user_id: req.userId });
    await db.collection('medication_logs').deleteMany({ medication_id: oid, user_id: req.userId });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete medication' });
  }
});

// --- Medication Logs API ---
app.get('/api/medication-logs', auth, async (req, res) => {
  try {
    const db = await getDb();
    const logs = await db.collection('medication_logs').aggregate([
      { $match: { user_id: req.userId } },
      { $sort: { taken_at: -1 } },
      { $limit: 50 },
      { $lookup: { from: 'medications', localField: 'medication_id', foreignField: '_id', as: 'med' }},
      { $unwind: '$med' },
      { $project: { _id: 1, medication_id: 1, taken_at: 1, skipped: 1, notes: 1, medication_name: '$med.name', dosage: '$med.dosage' }}
    ]).toArray();
    res.json(normalizeAll(logs));
  } catch (err) {
    res.status(500).json({ error: 'Failed to load medication logs' });
  }
});

app.post('/api/medication-logs', auth, async (req, res) => {
  try {
    const { medication_id, skipped, notes } = req.body;
    const medOid = parseObjectId(medication_id);
    if (!medOid) return res.status(400).json({ error: 'Valid medication_id is required' });
    const db = await getDb();
    const med = await db.collection('medications').findOne({ _id: medOid, user_id: req.userId });
    if (!med) return res.status(404).json({ error: 'Medication not found' });
    const doc = { user_id: req.userId, medication_id: medOid, skipped: skipped ? 1 : 0, notes: notes || null, taken_at: new Date() };
    const result = await db.collection('medication_logs').insertOne(doc);
    res.json({ id: result.insertedId.toString() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to log medication' });
  }
});

// --- Doctor Visits API ---
app.get('/api/visits', auth, async (req, res) => {
  try {
    const db = await getDb();
    const visits = await db.collection('doctor_visits').find({ user_id: req.userId }).sort({ visit_date: -1 }).toArray();
    res.json(normalizeAll(visits));
  } catch (err) {
    res.status(500).json({ error: 'Failed to load visits' });
  }
});

app.post('/api/visits', auth, async (req, res) => {
  try {
    const missing = requireFields(req.body, ['doctor_name', 'visit_date']);
    if (missing) return res.status(400).json({ error: `${missing} is required` });
    const db = await getDb();
    const { doctor_name, specialty, visit_date, visit_time, location, reason, notes, follow_up_date } = req.body;
    const doc = {
      user_id: req.userId, doctor_name, specialty: specialty || null, visit_date,
      visit_time: visit_time || null, location: location || null, reason: reason || null,
      notes: notes || null, follow_up_date: follow_up_date || null, created_at: new Date()
    };
    const result = await db.collection('doctor_visits').insertOne(doc);
    res.json({ id: result.insertedId.toString(), ...doc });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add visit' });
  }
});

app.put('/api/visits/:id', auth, async (req, res) => {
  try {
    const oid = parseObjectId(req.params.id);
    if (!oid) return res.status(400).json({ error: 'Invalid visit ID' });
    const missing = requireFields(req.body, ['doctor_name', 'visit_date']);
    if (missing) return res.status(400).json({ error: `${missing} is required` });
    const db = await getDb();
    const { doctor_name, specialty, visit_date, visit_time, location, reason, notes, follow_up_date } = req.body;
    await db.collection('doctor_visits').updateOne({ _id: oid, user_id: req.userId }, {
      $set: { doctor_name, specialty: specialty || null, visit_date, visit_time: visit_time || null,
        location: location || null, reason: reason || null, notes: notes || null, follow_up_date: follow_up_date || null }
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update visit' });
  }
});

app.delete('/api/visits/:id', auth, async (req, res) => {
  try {
    const oid = parseObjectId(req.params.id);
    if (!oid) return res.status(400).json({ error: 'Invalid visit ID' });
    const db = await getDb();
    await db.collection('doctor_visits').deleteOne({ _id: oid, user_id: req.userId });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete visit' });
  }
});

// --- Check-ins API ---
app.get('/api/checkins', auth, async (req, res) => {
  try {
    const db = await getDb();
    const checkins = await db.collection('checkins').find({ user_id: req.userId }).sort({ date: -1 }).limit(30).toArray();
    res.json(normalizeAll(checkins));
  } catch (err) {
    res.status(500).json({ error: 'Failed to load check-ins' });
  }
});

app.post('/api/checkins', auth, async (req, res) => {
  try {
    const { date, mood, energy, sleep_quality, pain_level, symptoms, notes } = req.body;
    const d = date || new Date().toISOString().split('T')[0];
    const moodVal = Number(mood), energyVal = Number(energy), sleepVal = Number(sleep_quality), painVal = Number(pain_level);
    if (isNaN(moodVal) || moodVal < 1 || moodVal > 5) return res.status(400).json({ error: 'mood must be 1-5' });
    if (isNaN(energyVal) || energyVal < 1 || energyVal > 5) return res.status(400).json({ error: 'energy must be 1-5' });
    if (isNaN(sleepVal) || sleepVal < 1 || sleepVal > 5) return res.status(400).json({ error: 'sleep_quality must be 1-5' });
    if (isNaN(painVal) || painVal < 0 || painVal > 10) return res.status(400).json({ error: 'pain_level must be 0-10' });

    const db = await getDb();
    const doc = { user_id: req.userId, date: d, mood: moodVal, energy: energyVal, sleep_quality: sleepVal, pain_level: painVal, symptoms: symptoms || null, notes: notes || null, created_at: new Date() };
    const result = await db.collection('checkins').insertOne(doc);
    res.json({ id: result.insertedId.toString() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save check-in' });
  }
});

app.delete('/api/checkins/:id', auth, async (req, res) => {
  try {
    const oid = parseObjectId(req.params.id);
    if (!oid) return res.status(400).json({ error: 'Invalid check-in ID' });
    const db = await getDb();
    await db.collection('checkins').deleteOne({ _id: oid, user_id: req.userId });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete check-in' });
  }
});

// --- Dashboard Stats ---
app.get('/api/dashboard', auth, async (req, res) => {
  try {
    const db = await getDb();
    const today = new Date().toISOString().split('T')[0];
    const startOfDay = new Date(today + 'T00:00:00.000Z');
    const endOfDay = new Date(today + 'T23:59:59.999Z');

    const activeMeds = await db.collection('medications').countDocuments({ user_id: req.userId, active: 1 });
    const todayLogCount = await db.collection('medication_logs').countDocuments({ user_id: req.userId, taken_at: { $gte: startOfDay, $lte: endOfDay } });
    const todayCheckinRows = await db.collection('checkins').find({ user_id: req.userId, date: today }).sort({ created_at: -1 }).limit(1).toArray();
    const upcomingVisits = await db.collection('doctor_visits').find({ user_id: req.userId, visit_date: { $gte: today } }).sort({ visit_date: 1 }).limit(5).toArray();
    const recentCheckins = await db.collection('checkins').find({ user_id: req.userId }, { projection: { date: 1, mood: 1, energy: 1, sleep_quality: 1, pain_level: 1 } }).sort({ date: -1 }).limit(7).toArray();

    res.json({ activeMeds, todayLogCount, todayCheckin: todayCheckinRows[0] ? normalize(todayCheckinRows[0]) : null, upcomingVisits: normalizeAll(upcomingVisits), recentCheckins: normalizeAll(recentCheckins) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

// --- Timeline API ---
app.get('/api/timeline', auth, async (req, res) => {
  try {
    const db = await getDb();
    const filter = req.query.filter || 'all';
    const validFilters = ['all', 'medication', 'visit', 'checkin'];
    if (!validFilters.includes(filter)) return res.status(400).json({ error: 'Invalid filter value' });

    let events = [];
    if (filter === 'all' || filter === 'medication') {
      const medLogs = await db.collection('medication_logs').aggregate([
        { $match: { user_id: req.userId } }, { $sort: { taken_at: -1 } }, { $limit: 50 },
        { $lookup: { from: 'medications', localField: 'medication_id', foreignField: '_id', as: 'med' }},
        { $unwind: '$med' },
        { $project: { date: '$taken_at', skipped: 1, name: '$med.name', dosage: '$med.dosage' }}
      ]).toArray();
      events.push(...medLogs.map(l => ({ type: 'medication', date: l.date, title: l.name + (l.dosage ? ' (' + l.dosage + ')' : ''), detail: l.skipped ? 'Skipped' : 'Taken', icon: l.skipped ? '\u274C' : '\u{1F48A}' })));
    }
    if (filter === 'all' || filter === 'visit') {
      const visitsList = await db.collection('doctor_visits').find({ user_id: req.userId }).sort({ visit_date: -1 }).limit(50).toArray();
      events.push(...visitsList.map(v => ({ type: 'visit', date: v.visit_date, title: v.doctor_name, detail: [v.specialty, v.reason].filter(Boolean).join(' - '), icon: '\u{1F3E5}' })));
    }
    if (filter === 'all' || filter === 'checkin') {
      const checkinsList = await db.collection('checkins').find({ user_id: req.userId }).sort({ date: -1 }).limit(50).toArray();
      const moodEmojis = ['', '\u{1F629}', '\u{1F61E}', '\u{1F610}', '\u{1F642}', '\u{1F601}'];
      events.push(...checkinsList.map(c => ({ type: 'checkin', date: c.date, title: 'Daily Check-in', detail: `Mood: ${moodEmojis[c.mood]} Energy: ${c.energy}/5 Pain: ${c.pain_level}/10`, icon: moodEmojis[c.mood] || '\u{1F610}' })));
    }
    events.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load timeline' });
  }
});

// --- Export API ---
app.get('/api/export', auth, async (req, res) => {
  try {
    const db = await getDb();
    const checkins = await db.collection('checkins').find({ user_id: req.userId }).sort({ date: -1 }).toArray();
    const meds = await db.collection('medications').find({ user_id: req.userId }).sort({ name: 1 }).toArray();
    const medLogs = await db.collection('medication_logs').aggregate([
      { $match: { user_id: req.userId } }, { $sort: { taken_at: -1 } },
      { $lookup: { from: 'medications', localField: 'medication_id', foreignField: '_id', as: 'med' }},
      { $unwind: '$med' },
      { $project: { taken_at: 1, skipped: 1, notes: 1, medication_name: '$med.name', dosage: '$med.dosage' }}
    ]).toArray();
    const visitsList = await db.collection('doctor_visits').find({ user_id: req.userId }).sort({ visit_date: -1 }).toArray();

    let csv = 'HEALTH TRACKER EXPORT\n\n';
    csv += 'DAILY CHECK-INS\nDate,Mood,Energy,Sleep Quality,Pain Level,Symptoms,Notes\n';
    checkins.forEach(c => { csv += `${c.date},${c.mood},${c.energy},${c.sleep_quality},${c.pain_level},"${(c.symptoms || '').replace(/"/g, '""')}","${(c.notes || '').replace(/"/g, '""')}"\n`; });
    csv += '\nMEDICATIONS\nName,Dosage,Frequency,Time of Day,Active,Notes\n';
    meds.forEach(m => { csv += `"${m.name}","${m.dosage || ''}","${m.frequency || ''}","${m.time_of_day || ''}",${m.active ? 'Yes' : 'No'},"${(m.notes || '').replace(/"/g, '""')}"\n`; });
    csv += '\nMEDICATION LOGS\nMedication,Dosage,Date,Status,Notes\n';
    medLogs.forEach(l => { csv += `"${l.medication_name}","${l.dosage || ''}","${l.taken_at}",${l.skipped ? 'Skipped' : 'Taken'},"${(l.notes || '').replace(/"/g, '""')}"\n`; });
    csv += '\nDOCTOR VISITS\nDoctor,Specialty,Date,Time,Location,Reason,Notes,Follow-up\n';
    visitsList.forEach(v => { csv += `"${v.doctor_name}","${v.specialty || ''}","${v.visit_date}","${v.visit_time || ''}","${v.location || ''}","${v.reason || ''}","${(v.notes || '').replace(/"/g, '""')}","${v.follow_up_date || ''}"\n`; });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=healthtrack-export.csv');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: 'Failed to export data' });
  }
});

// --- Debug: check if Gemini key is set + smoke test ---
app.get('/api/voice-status', async (req, res) => {
  const key = process.env.GEMINI_API_KEY;
  const status = {
    keySet: !!key,
    keyPrefix: key ? key.substring(0, 8) + '...' : null,
    keyLength: key ? key.length : 0
  };

  if (!key) {
    status.test = 'FAIL: No API key set';
    return res.json(status);
  }

  // Smoke test: make a minimal Gemini call
  try {
    const testRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Reply with exactly: OK' }] }],
          generationConfig: { maxOutputTokens: 10 }
        })
      }
    );
    if (testRes.ok) {
      const data = await testRes.json();
      const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      status.test = 'PASS';
      status.reply = reply.trim();
    } else {
      const errText = await testRes.text();
      let errMsg = '';
      try { errMsg = JSON.parse(errText).error?.message || ''; } catch(e) { errMsg = errText.substring(0, 200); }
      status.test = `FAIL ${testRes.status}: ${errMsg}`;
    }
  } catch (e) {
    status.test = `FAIL: ${e.message}`;
  }

  res.json(status);
});

// --- Voice AI (Gemini) ---
app.post('/api/voice', auth, async (req, res) => {
  try {
    const { transcript } = req.body;
    if (!transcript || !transcript.trim()) return res.status(400).json({ error: 'No transcript provided' });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error('GEMINI_API_KEY is not set. Available env vars:', Object.keys(process.env).filter(k => k.includes('GEMINI') || k.includes('gemini') || k.includes('API')).join(', ') || '(none matching)');
      return res.status(500).json({ error: 'GEMINI_API_KEY environment variable is not set on the server' });
    }

    const db = await getDb();
    const meds = await db.collection('medications').find({ user_id: req.userId, active: 1 }).toArray();
    const today = new Date().toISOString().split('T')[0];
    const upcomingVisits = await db.collection('doctor_visits').find({ user_id: req.userId, visit_date: { $gte: today } }).sort({ visit_date: 1 }).limit(3).toArray();
    const lastCheckin = await db.collection('checkins').find({ user_id: req.userId }).sort({ date: -1 }).limit(1).toArray();

    const medsContext = meds.map(m => `- ${m.name}${m.dosage ? ' (' + m.dosage + ')' : ''}${m.time_of_day ? ', ' + m.time_of_day : ''} [id: ${m._id}]`).join('\n');
    const visitsContext = upcomingVisits.map(v => `- ${v.doctor_name} on ${v.visit_date}${v.visit_time ? ' at ' + v.visit_time : ''}`).join('\n');
    const checkinContext = lastCheckin.length > 0 ? `Last check-in: ${lastCheckin[0].date}, mood ${lastCheckin[0].mood}/5, energy ${lastCheckin[0].energy}/5` : 'No recent check-ins';

    const systemPrompt = `You are a health tracking voice assistant. Parse the user's voice command and return a JSON action.

Today's date: ${today}

User's active medications:
${medsContext || '(none)'}

Upcoming visits:
${visitsContext || '(none)'}

${checkinContext}

Return ONLY valid JSON (no markdown, no backticks) with one of these action types:

1. Log medication taken:
{"action":"log_med","medication_id":"<id>","skipped":false,"message":"Logged Advil!"}

2. Skip medication:
{"action":"log_med","medication_id":"<id>","skipped":true,"message":"Skipped Advil"}

3. Add new medication:
{"action":"add_med","name":"<name>","dosage":"<dosage or empty>","frequency":"<Once daily|Twice daily|Three times daily|As needed|Weekly or empty>","time_of_day":"<Morning|Afternoon|Evening|Bedtime|With meals or empty>","message":"Added Tylenol 500mg!"}

4. Daily check-in:
{"action":"checkin","mood":<1-5>,"energy":<1-5>,"sleep_quality":<1-5>,"pain_level":<0-10>,"symptoms":"<if mentioned>","notes":"<original transcript>","message":"Check-in saved! Feeling good today."}

5. Add doctor visit:
{"action":"add_visit","doctor_name":"<name>","specialty":"<if mentioned>","visit_date":"<YYYY-MM-DD>","visit_time":"<HH:MM or null>","location":"<if mentioned>","reason":"<if mentioned>","message":"Visit with Dr. Smith added for tomorrow!"}

6. Navigate to a page:
{"action":"navigate","page":"<dashboard|meds|visits|checkin|history>","message":"Opening medications"}

7. Conversational reply (health question, greeting, or unclear command):
{"action":"reply","message":"<helpful response>"}

Rules:
- Match medication names fuzzily (e.g., "advil" matches "Advil", "ibu" matches "Ibuprofen")
- For dates: "tomorrow" = next day, "next Monday" = the actual date, etc.
- For mood words: great/amazing=5, good/fine=4, okay/alright=3, bad/rough=2, terrible/awful=1
- If the user just says how they feel without explicitly saying "check in", still create a checkin
- Keep messages short, warm, and encouraging
- If unsure, use "reply" action with a helpful clarification`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: transcript }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 300,
            responseMimeType: 'application/json'
          }
        })
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error('Gemini API error:', geminiRes.status, errText);
      let errMsg = '';
      try { errMsg = JSON.parse(errText).error?.message || ''; } catch(e) { errMsg = errText.substring(0, 100); }
      return res.status(502).json({ error: `Gemini ${geminiRes.status}: ${errMsg}` });
    }

    const geminiData = await geminiRes.json();
    const responseText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!responseText) {
      console.error('Gemini empty response:', JSON.stringify(geminiData));
      return res.status(502).json({ error: 'Gemini returned an empty response' });
    }

    let parsed;
    try {
      parsed = JSON.parse(responseText);
    } catch (parseErr) {
      console.error('Gemini JSON parse error:', responseText);
      return res.json({ action: 'reply', message: responseText });
    }
    res.json(parsed);
  } catch (err) {
    console.error('Voice AI error:', err.message || err);
    res.status(500).json({ error: 'Voice AI error: ' + (err.message || 'unknown') });
  }
});

module.exports = app;
