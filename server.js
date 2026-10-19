const express = require('express');
const { DatabaseSync } = require('node:sqlite'); // built into Node 22.5+, no native build needed
const path = require('path');
const crypto = require('crypto');

const STAGES = ['Applied', 'Screening', 'Interview', 'Offer', 'Hired', 'Rejected'];
const db = new DatabaseSync(process.env.DB_PATH || path.join(__dirname, 'ats.db'));
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS candidates(
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
  phone TEXT DEFAULT '', role TEXT NOT NULL, source TEXT NOT NULL,
  exp REAL DEFAULT 0, skills TEXT DEFAULT '', notes TEXT DEFAULT '',
  stage TEXT NOT NULL, created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS history(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  stage TEXT NOT NULL, at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_stage ON candidates(stage);`);

// Run fn inside a transaction (commit on success, rollback on error)
const tx = fn => { db.exec('BEGIN'); try { fn(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } };
const uid = () => crypto.randomBytes(4).toString('hex');
const now = () => new Date().toISOString();
const histOf = db.prepare('SELECT stage, at FROM history WHERE candidate_id=? ORDER BY id');
const hydrate = c => c && { ...c, history: histOf.all(c.id) };

function validate(b, partial = false) {
  const e = [];
  const v = {
    name: String(b.name ?? '').trim(), email: String(b.email ?? '').trim().toLowerCase(),
    phone: String(b.phone ?? '').trim(), role: String(b.role ?? '').trim(),
    source: String(b.source ?? '').trim(), skills: String(b.skills ?? '').trim(),
    notes: String(b.notes ?? '').trim(), stage: b.stage || 'Applied',
    exp: Math.max(0, Number(b.exp) || 0),
  };
  if (!v.name) e.push('Name is required');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) e.push('Valid email is required');
  if (!v.role) e.push('Role is required');
  if (!v.source) e.push('Source is required');
  if (!STAGES.includes(v.stage)) e.push('Invalid stage');
  return { v, error: e.join('. ') };
}

const app = express();
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (_, res) => res.json({ ok: true }));

// List with server-side search, filters and sort
app.get('/api/candidates', (req, res) => {
  const { q = '', stage = '', role = '', sort = 'new' } = req.query;
  const where = [], args = [];
  if (q) {
    where.push("(name||' '||email||' '||role||' '||skills||' '||source||' '||phone) LIKE ?");
    args.push(`%${q}%`);
  }
  if (stage) { where.push('stage=?'); args.push(stage); }
  if (role) { where.push('role=?'); args.push(role); }
  const order = { new: 'created DESC', old: 'created ASC', name: 'name COLLATE NOCASE', exp: 'exp DESC' }[sort] || 'created DESC';
  const rows = db.prepare(`SELECT * FROM candidates ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order}`).all(...args);
  res.json(rows.map(hydrate));
});

app.get('/api/candidates/:id', (req, res) => {
  const c = hydrate(db.prepare('SELECT * FROM candidates WHERE id=?').get(req.params.id));
  c ? res.json(c) : res.status(404).json({ error: 'Not found' });
});

app.post('/api/candidates', (req, res) => {
  const { v, error } = validate(req.body);
  if (error) return res.status(400).json({ error });
  if (db.prepare('SELECT 1 FROM candidates WHERE email=?').get(v.email))
    return res.status(409).json({ error: 'A candidate with this email already exists' });
  const id = uid(), t = now();
  tx(() => {
    db.prepare('INSERT INTO candidates(id,name,email,phone,role,source,exp,skills,notes,stage,created) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, v.name, v.email, v.phone, v.role, v.source, v.exp, v.skills, v.notes, v.stage, t);
    db.prepare('INSERT INTO history(candidate_id,stage,at) VALUES(?,?,?)').run(id, v.stage, t);
  });
  res.status(201).json(hydrate(db.prepare('SELECT * FROM candidates WHERE id=?').get(id)));
});

app.put('/api/candidates/:id', (req, res) => {
  const cur = db.prepare('SELECT * FROM candidates WHERE id=?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Not found' });
  const { v, error } = validate(req.body);
  if (error) return res.status(400).json({ error });
  if (db.prepare('SELECT 1 FROM candidates WHERE email=? AND id<>?').get(v.email, cur.id))
    return res.status(409).json({ error: 'A candidate with this email already exists' });
  tx(() => {
    db.prepare('UPDATE candidates SET name=?,email=?,phone=?,role=?,source=?,exp=?,skills=?,notes=?,stage=? WHERE id=?')
      .run(v.name, v.email, v.phone, v.role, v.source, v.exp, v.skills, v.notes, v.stage, cur.id);
    if (cur.stage !== v.stage) db.prepare('INSERT INTO history(candidate_id,stage,at) VALUES(?,?,?)').run(cur.id, v.stage, now());
  });
  res.json(hydrate(db.prepare('SELECT * FROM candidates WHERE id=?').get(cur.id)));
});

app.patch('/api/candidates/:id/stage', (req, res) => {
  const { stage } = req.body || {};
  if (!STAGES.includes(stage)) return res.status(400).json({ error: 'Invalid stage' });
  const cur = db.prepare('SELECT * FROM candidates WHERE id=?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Not found' });
  if (cur.stage !== stage) tx(() => {
    db.prepare('UPDATE candidates SET stage=? WHERE id=?').run(stage, cur.id);
    db.prepare('INSERT INTO history(candidate_id,stage,at) VALUES(?,?,?)').run(cur.id, stage, now());
  });
  res.json(hydrate(db.prepare('SELECT * FROM candidates WHERE id=?').get(cur.id)));
});

app.delete('/api/candidates/:id', (req, res) => {
  const r = db.prepare('DELETE FROM candidates WHERE id=?').run(req.params.id);
  r.changes ? res.status(204).end() : res.status(404).json({ error: 'Not found' });
});

// Dashboard metrics computed in SQL
app.get('/api/stats', (_, res) => {
  const by = col => db.prepare(`SELECT ${col} AS label, COUNT(*) AS count FROM candidates GROUP BY ${col} ORDER BY count DESC`).all();
  const total = db.prepare('SELECT COUNT(*) n FROM candidates').get().n;
  const reached = Object.fromEntries(STAGES.map(s => [s, db.prepare('SELECT COUNT(DISTINCT candidate_id) n FROM history WHERE stage=?').get(s).n]));
  const hired = db.prepare("SELECT COUNT(*) n FROM candidates WHERE stage='Hired'").get().n;
  const week = db.prepare('SELECT COUNT(*) n FROM candidates WHERE created > ?').get(new Date(Date.now() - 7 * 864e5).toISOString()).n;
  res.json({ total, hired, newThisWeek: week, hireRate: total ? +(hired / total * 100).toFixed(1) : 0,
    byStage: by('stage'), bySource: by('source'), byRole: by('role'), funnel: reached });
});

app.use('/api', (_, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: 'Server error' }); });

function seed() {
  if (db.prepare('SELECT COUNT(*) n FROM candidates').get().n) return;
  const d = n => new Date(Date.now() - n * 864e5).toISOString();
  const rows = [['Ananya Rao','Full Stack Developer','LinkedIn','Offer',2,12],['Rohit Sharma','Backend Developer','Referral','Interview',3,9],['Meera Nair','Frontend Developer','Job Portal','Screening',1,6],['Kiran Patel','Data Analyst','Campus','Applied',0,2],['Sneha Iyer','UI/UX Designer','Website','Hired',4,20],['Arjun Das','QA Engineer','LinkedIn','Rejected',2,14],['Divya Menon','Full Stack Developer','Referral','Interview',2,8],['Vikram Singh','Backend Developer','Job Portal','Applied',0,1],['Pooja Reddy','Frontend Developer','Campus','Screening',1,5],['Imran Khan','Full Stack Developer','Website','Applied',0,3]];
  rows.forEach(([name, role, source, stage, exp, age], i) => {
    const id = uid(), path = stage === 'Rejected' ? ['Applied', 'Screening', 'Rejected'] : STAGES.slice(0, STAGES.indexOf(stage) + 1);
    db.prepare('INSERT INTO candidates VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id, name, name.toLowerCase().replace(' ', '.') + '@mail.com', '98765' + (10000 + i * 137), role, source, exp, 'React, Node.js, SQL', '', stage, d(age));
    path.forEach((s, k) => db.prepare('INSERT INTO history(candidate_id,stage,at) VALUES(?,?,?)').run(id, s, d(Math.max(0, age - k))));
  });
}
seed();

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`HireFlow ATS running on http://localhost:${port}`));
}
module.exports = app;
