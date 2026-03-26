const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');

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
  await db.collection('medications').createIndex({ active: 1, time_of_day: 1, name: 1 });
  await db.collection('medication_logs').createIndex({ medication_id: 1, taken_at: -1 });
  await db.collection('medication_logs').createIndex({ taken_at: -1 });
  await db.collection('doctor_visits').createIndex({ visit_date: -1 });
  await db.collection('checkins').createIndex({ date: -1 });
}

let dbInitPromise = null;
app.use(async (req, res, next) => {
  try {
    if (!dbInitPromise) {
      dbInitPromise = initDb();
    }
    await dbInitPromise;
    next();
  } catch (err) {
    dbInitPromise = null;
    res.status(500).json({ error: 'Database initialization failed' });
  }
});

// --- Validation helpers ---
function parseObjectId(raw) {
  try {
    return new ObjectId(raw);
  } catch {
    return null;
  }
}

function requireFields(body, fields) {
  for (const f of fields) {
    if (!body[f] || (typeof body[f] === 'string' && !body[f].trim())) {
      return f;
    }
  }
  return null;
}

// Normalize MongoDB docs: rename _id to id as a string
function normalize(doc) {
  if (!doc) return doc;
  const { _id, ...rest } = doc;
  return { id: _id.toString(), ...rest };
}

function normalizeAll(docs) {
  return docs.map(normalize);
}

// --- Medications API ---
app.get('/api/medications', async (req, res) => {
  try {
    const db = await getDb();
    const meds = await db.collection('medications').find().sort({ created_at: -1 }).toArray();
    res.json(normalizeAll(meds));
  } catch (err) {
    res.status(500).json({ error: 'Failed to load medications' });
  }
});

app.post('/api/medications', async (req, res) => {
  try {
    const missing = requireFields(req.body, ['name']);
    if (missing) return res.status(400).json({ error: `${missing} is required` });

    const db = await getDb();
    const { name, dosage, frequency, time_of_day, notes } = req.body;
    const doc = {
      name,
      dosage: dosage || null,
      frequency: frequency || null,
      time_of_day: time_of_day || null,
      notes: notes || null,
      active: 1,
      created_at: new Date(),
      updated_at: new Date()
    };
    const result = await db.collection('medications').insertOne(doc);
    res.json({ id: result.insertedId.toString(), ...doc });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add medication' });
  }
});

app.get('/api/medications/active', async (req, res) => {
  try {
    const db = await getDb();
    const today = new Date().toISOString().split('T')[0];
    const meds = await db.collection('medications').find({ active: 1 }).sort({ time_of_day: 1, name: 1 }).toArray();

    const startOfDay = new Date(today + 'T00:00:00.000Z');
    const endOfDay = new Date(today + 'T23:59:59.999Z');
    const todayLogs = await db.collection('medication_logs').find({
      taken_at: { $gte: startOfDay, $lte: endOfDay }
    }).toArray();

    const loggedMap = {};
    todayLogs.forEach(l => {
      loggedMap[l.medication_id.toString()] = l.skipped ? 'skipped' : 'taken';
    });

    const result = normalizeAll(meds).map(m => ({
      ...m,
      todayStatus: loggedMap[m.id] || 'pending'
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load active medications' });
  }
});

app.put('/api/medications/:id', async (req, res) => {
  try {
    const oid = parseObjectId(req.params.id);
    if (!oid) return res.status(400).json({ error: 'Invalid medication ID' });

    const missing = requireFields(req.body, ['name']);
    if (missing) return res.status(400).json({ error: `${missing} is required` });

    const db = await getDb();
    const { name, dosage, frequency, time_of_day, notes, active } = req.body;
    await db.collection('medications').updateOne({ _id: oid }, {
      $set: {
        name,
        dosage: dosage || null,
        frequency: frequency || null,
        time_of_day: time_of_day || null,
        notes: notes || null,
        active: active ?? 1,
        updated_at: new Date()
      }
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update medication' });
  }
});

app.delete('/api/medications/:id', async (req, res) => {
  try {
    const oid = parseObjectId(req.params.id);
    if (!oid) return res.status(400).json({ error: 'Invalid medication ID' });

    const db = await getDb();
    await db.collection('medications').deleteOne({ _id: oid });
    await db.collection('medication_logs').deleteMany({ medication_id: oid });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete medication' });
  }
});

// --- Medication Logs API ---
app.get('/api/medication-logs', async (req, res) => {
  try {
    const db = await getDb();
    const logs = await db.collection('medication_logs').aggregate([
      { $sort: { taken_at: -1 } },
      { $limit: 50 },
      { $lookup: {
        from: 'medications',
        localField: 'medication_id',
        foreignField: '_id',
        as: 'med'
      }},
      { $unwind: '$med' },
      { $project: {
        _id: 1,
        medication_id: 1,
        taken_at: 1,
        skipped: 1,
        notes: 1,
        medication_name: '$med.name',
        dosage: '$med.dosage'
      }}
    ]).toArray();
    res.json(normalizeAll(logs));
  } catch (err) {
    res.status(500).json({ error: 'Failed to load medication logs' });
  }
});

app.post('/api/medication-logs', async (req, res) => {
  try {
    const { medication_id, skipped, notes } = req.body;
    const medOid = parseObjectId(medication_id);
    if (!medOid) return res.status(400).json({ error: 'Valid medication_id is required' });

    const db = await getDb();
    const doc = {
      medication_id: medOid,
      skipped: skipped ? 1 : 0,
      notes: notes || null,
      taken_at: new Date()
    };
    const result = await db.collection('medication_logs').insertOne(doc);
    res.json({ id: result.insertedId.toString() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to log medication' });
  }
});

// --- Doctor Visits API ---
app.get('/api/visits', async (req, res) => {
  try {
    const db = await getDb();
    const visits = await db.collection('doctor_visits').find().sort({ visit_date: -1 }).toArray();
    res.json(normalizeAll(visits));
  } catch (err) {
    res.status(500).json({ error: 'Failed to load visits' });
  }
});

app.post('/api/visits', async (req, res) => {
  try {
    const missing = requireFields(req.body, ['doctor_name', 'visit_date']);
    if (missing) return res.status(400).json({ error: `${missing} is required` });

    const db = await getDb();
    const { doctor_name, specialty, visit_date, location, reason, notes, follow_up_date } = req.body;
    const doc = {
      doctor_name,
      specialty: specialty || null,
      visit_date,
      location: location || null,
      reason: reason || null,
      notes: notes || null,
      follow_up_date: follow_up_date || null,
      created_at: new Date()
    };
    const result = await db.collection('doctor_visits').insertOne(doc);
    res.json({ id: result.insertedId.toString(), ...doc });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add visit' });
  }
});

app.put('/api/visits/:id', async (req, res) => {
  try {
    const oid = parseObjectId(req.params.id);
    if (!oid) return res.status(400).json({ error: 'Invalid visit ID' });

    const missing = requireFields(req.body, ['doctor_name', 'visit_date']);
    if (missing) return res.status(400).json({ error: `${missing} is required` });

    const db = await getDb();
    const { doctor_name, specialty, visit_date, location, reason, notes, follow_up_date } = req.body;
    await db.collection('doctor_visits').updateOne({ _id: oid }, {
      $set: {
        doctor_name,
        specialty: specialty || null,
        visit_date,
        location: location || null,
        reason: reason || null,
        notes: notes || null,
        follow_up_date: follow_up_date || null
      }
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update visit' });
  }
});

app.delete('/api/visits/:id', async (req, res) => {
  try {
    const oid = parseObjectId(req.params.id);
    if (!oid) return res.status(400).json({ error: 'Invalid visit ID' });

    const db = await getDb();
    await db.collection('doctor_visits').deleteOne({ _id: oid });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete visit' });
  }
});

// --- Check-ins API ---
app.get('/api/checkins', async (req, res) => {
  try {
    const db = await getDb();
    const checkins = await db.collection('checkins').find().sort({ date: -1 }).limit(30).toArray();
    res.json(normalizeAll(checkins));
  } catch (err) {
    res.status(500).json({ error: 'Failed to load check-ins' });
  }
});

app.post('/api/checkins', async (req, res) => {
  try {
    const { date, mood, energy, sleep_quality, pain_level, symptoms, notes } = req.body;
    const d = date || new Date().toISOString().split('T')[0];

    const moodVal = Number(mood);
    const energyVal = Number(energy);
    const sleepVal = Number(sleep_quality);
    const painVal = Number(pain_level);

    if (isNaN(moodVal) || moodVal < 1 || moodVal > 5) return res.status(400).json({ error: 'mood must be 1-5' });
    if (isNaN(energyVal) || energyVal < 1 || energyVal > 5) return res.status(400).json({ error: 'energy must be 1-5' });
    if (isNaN(sleepVal) || sleepVal < 1 || sleepVal > 5) return res.status(400).json({ error: 'sleep_quality must be 1-5' });
    if (isNaN(painVal) || painVal < 0 || painVal > 10) return res.status(400).json({ error: 'pain_level must be 0-10' });

    const db = await getDb();
    const doc = {
      date: d,
      mood: moodVal,
      energy: energyVal,
      sleep_quality: sleepVal,
      pain_level: painVal,
      symptoms: symptoms || null,
      notes: notes || null,
      created_at: new Date()
    };
    const result = await db.collection('checkins').insertOne(doc);
    res.json({ id: result.insertedId.toString() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save check-in' });
  }
});

app.delete('/api/checkins/:id', async (req, res) => {
  try {
    const oid = parseObjectId(req.params.id);
    if (!oid) return res.status(400).json({ error: 'Invalid check-in ID' });

    const db = await getDb();
    await db.collection('checkins').deleteOne({ _id: oid });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete check-in' });
  }
});

// --- Dashboard Stats ---
app.get('/api/dashboard', async (req, res) => {
  try {
    const db = await getDb();
    const today = new Date().toISOString().split('T')[0];
    const startOfDay = new Date(today + 'T00:00:00.000Z');
    const endOfDay = new Date(today + 'T23:59:59.999Z');

    const activeMeds = await db.collection('medications').countDocuments({ active: 1 });
    const todayLogCount = await db.collection('medication_logs').countDocuments({
      taken_at: { $gte: startOfDay, $lte: endOfDay }
    });
    const todayCheckinRows = await db.collection('checkins').find({ date: today }).sort({ created_at: -1 }).limit(1).toArray();
    const upcomingVisits = await db.collection('doctor_visits').find({ visit_date: { $gte: today } }).sort({ visit_date: 1 }).limit(5).toArray();
    const recentCheckins = await db.collection('checkins').find({}, {
      projection: { date: 1, mood: 1, energy: 1, sleep_quality: 1, pain_level: 1 }
    }).sort({ date: -1 }).limit(7).toArray();

    res.json({
      activeMeds,
      todayLogCount,
      todayCheckin: todayCheckinRows[0] ? normalize(todayCheckinRows[0]) : null,
      upcomingVisits: normalizeAll(upcomingVisits),
      recentCheckins: normalizeAll(recentCheckins)
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

// --- Timeline API ---
app.get('/api/timeline', async (req, res) => {
  try {
    const db = await getDb();
    const filter = req.query.filter || 'all';
    const validFilters = ['all', 'medication', 'visit', 'checkin'];
    if (!validFilters.includes(filter)) {
      return res.status(400).json({ error: 'Invalid filter value' });
    }

    let events = [];

    if (filter === 'all' || filter === 'medication') {
      const medLogs = await db.collection('medication_logs').aggregate([
        { $sort: { taken_at: -1 } },
        { $limit: 50 },
        { $lookup: {
          from: 'medications',
          localField: 'medication_id',
          foreignField: '_id',
          as: 'med'
        }},
        { $unwind: '$med' },
        { $project: {
          date: '$taken_at',
          skipped: 1,
          name: '$med.name',
          dosage: '$med.dosage'
        }}
      ]).toArray();

      events.push(...medLogs.map(l => ({
        type: 'medication',
        date: l.date,
        title: l.name + (l.dosage ? ' (' + l.dosage + ')' : ''),
        detail: l.skipped ? 'Skipped' : 'Taken',
        icon: l.skipped ? '\u274C' : '\u{1F48A}'
      })));
    }

    if (filter === 'all' || filter === 'visit') {
      const visitsList = await db.collection('doctor_visits').find().sort({ visit_date: -1 }).limit(50).toArray();
      events.push(...visitsList.map(v => ({
        type: 'visit',
        date: v.visit_date,
        title: v.doctor_name,
        detail: [v.specialty, v.reason].filter(Boolean).join(' - '),
        icon: '\u{1F3E5}'
      })));
    }

    if (filter === 'all' || filter === 'checkin') {
      const checkinsList = await db.collection('checkins').find().sort({ date: -1 }).limit(50).toArray();
      const moodEmojis = ['', '\u{1F629}', '\u{1F61E}', '\u{1F610}', '\u{1F642}', '\u{1F601}'];
      events.push(...checkinsList.map(c => ({
        type: 'checkin',
        date: c.date,
        title: 'Daily Check-in',
        detail: `Mood: ${moodEmojis[c.mood]} Energy: ${c.energy}/5 Pain: ${c.pain_level}/10`,
        icon: moodEmojis[c.mood] || '\u{1F610}'
      })));
    }

    events.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load timeline' });
  }
});

// --- Export API ---
app.get('/api/export', async (req, res) => {
  try {
    const db = await getDb();
    const checkins = await db.collection('checkins').find().sort({ date: -1 }).toArray();
    const meds = await db.collection('medications').find().sort({ name: 1 }).toArray();
    const medLogs = await db.collection('medication_logs').aggregate([
      { $sort: { taken_at: -1 } },
      { $lookup: {
        from: 'medications',
        localField: 'medication_id',
        foreignField: '_id',
        as: 'med'
      }},
      { $unwind: '$med' },
      { $project: {
        taken_at: 1,
        skipped: 1,
        notes: 1,
        medication_name: '$med.name',
        dosage: '$med.dosage'
      }}
    ]).toArray();
    const visitsList = await db.collection('doctor_visits').find().sort({ visit_date: -1 }).toArray();

    let csv = 'HEALTH TRACKER EXPORT\n\n';

    csv += 'DAILY CHECK-INS\nDate,Mood,Energy,Sleep Quality,Pain Level,Symptoms,Notes\n';
    checkins.forEach(c => {
      csv += `${c.date},${c.mood},${c.energy},${c.sleep_quality},${c.pain_level},"${(c.symptoms || '').replace(/"/g, '""')}","${(c.notes || '').replace(/"/g, '""')}"\n`;
    });

    csv += '\nMEDICATIONS\nName,Dosage,Frequency,Time of Day,Active,Notes\n';
    meds.forEach(m => {
      csv += `"${m.name}","${m.dosage || ''}","${m.frequency || ''}","${m.time_of_day || ''}",${m.active ? 'Yes' : 'No'},"${(m.notes || '').replace(/"/g, '""')}"\n`;
    });

    csv += '\nMEDICATION LOGS\nMedication,Dosage,Date,Status,Notes\n';
    medLogs.forEach(l => {
      csv += `"${l.medication_name}","${l.dosage || ''}","${l.taken_at}",${l.skipped ? 'Skipped' : 'Taken'},"${(l.notes || '').replace(/"/g, '""')}"\n`;
    });

    csv += '\nDOCTOR VISITS\nDoctor,Specialty,Date,Location,Reason,Notes,Follow-up\n';
    visitsList.forEach(v => {
      csv += `"${v.doctor_name}","${v.specialty || ''}","${v.visit_date}","${v.location || ''}","${v.reason || ''}","${(v.notes || '').replace(/"/g, '""')}","${v.follow_up_date || ''}"\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=healthtrack-export.csv');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: 'Failed to export data' });
  }
});

module.exports = app;
