process.env.DB_PATH = ':memory:';
const test = require('node:test'), assert = require('node:assert');
const app = require('./server');
let base, srv;
test.before(() => new Promise(r => { srv = app.listen(0, () => { base = 'http://localhost:' + srv.address().port; r(); }); }));
test.after(() => srv.close());
const call = (p, m = 'GET', b) => fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b && JSON.stringify(b) });
test('create, validate, move stage, search, delete', async () => {
  assert.equal((await call('/api/candidates', 'POST', { name: '', email: 'x' })).status, 400);
  const ok = { name: 'Test User', email: 't@x.com', role: 'QA Engineer', source: 'Website' };
  const c = await (await call('/api/candidates', 'POST', ok)).json();
  assert.equal((await call('/api/candidates', 'POST', ok)).status, 409);
  const m = await (await call(`/api/candidates/${c.id}/stage`, 'PATCH', { stage: 'Interview' })).json();
  assert.equal(m.history.length, 2);
  const s = await (await call('/api/candidates?q=test&stage=Interview')).json();
  assert.equal(s.length, 1);
  assert.equal((await call(`/api/candidates/${c.id}`, 'DELETE')).status, 204);
});
