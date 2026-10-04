// Smoke tests for the API (in-memory store). Usage: node scripts/test-api.js
process.env.ADMIN_KEY = 'test-admin-key';
delete process.env.KV_REST_API_URL;
delete process.env.UPSTASH_REDIS_REST_URL;

const assert = require('assert');
const crypto = require('crypto');
const { createServer } = require('./dev-server');

const server = createServer().listen(0);
const base = `http://localhost:${server.address().port}`;

const post = (body, headers = {}) => fetch(`${base}/api/submit`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
});
const good = () => ({
  respondentId: crypto.randomUUID(),
  present: { economic: 60, environment: 15, community: 25 },
  future: { economic: 30.3, environment: 33.3, community: 36.4 },
});

(async () => {
  let r;

  // valid submission
  const a = good();
  r = await post(a);
  assert.strictEqual(r.status, 201, 'valid submission accepted');
  assert.match(r.headers.get('set-cookie'), /ds_submitted=1/, 'cookie set');

  // same respondent id again -> rejected (one submission per plot)
  r = await post(a);
  assert.strictEqual(r.status, 409, 'duplicate respondent id rejected');

  // new id but carrying the submitted cookie -> rejected
  r = await post(good(), { Cookie: 'ds_submitted=1' });
  assert.strictEqual(r.status, 409, 'submitted cookie rejected');

  // status endpoint
  r = await (await fetch(`${base}/api/status?id=${a.respondentId}`)).json();
  assert.strictEqual(r.submitted, true, 'status reports submitted');
  r = await (await fetch(`${base}/api/status?id=${crypto.randomUUID()}`)).json();
  assert.strictEqual(r.submitted, false, 'status reports not submitted');

  // invalid payloads
  r = await post({ ...good(), future: null });
  assert.strictEqual(r.status, 400, 'missing future plot rejected');
  r = await post({ ...good(), present: { economic: 90, environment: 90, community: 90 } });
  assert.strictEqual(r.status, 400, 'non-composition rejected');
  r = await post({ ...good(), respondentId: 'abc' });
  assert.strictEqual(r.status, 400, 'bad id rejected');
  r = await fetch(`${base}/api/submit`);
  assert.strictEqual(r.status, 405, 'GET submit rejected');

  // admin export
  r = await fetch(`${base}/api/responses?key=wrong`);
  assert.strictEqual(r.status, 401, 'wrong admin key rejected');
  r = await (await fetch(`${base}/api/responses?key=test-admin-key`)).json();
  assert.strictEqual(r.count, 1, 'one stored response');
  const rec = r.responses[0];
  for (const p of ['present', 'future']) {
    const sum = rec[p].economic + rec[p].environment + rec[p].community;
    assert.ok(Math.abs(sum - 100) < 1e-9, `${p} sums to 100 (got ${sum})`);
  }
  const csv = await (await fetch(`${base}/api/responses?key=test-admin-key&format=csv`)).text();
  assert.ok(csv.startsWith('id,submittedAt,present_economic'), 'csv export');

  // rate limit (10/hour per IP; 2 already counted above)
  let limited = false;
  for (let i = 0; i < 12; i++) if ((await post(good())).status === 429) limited = true;
  assert.ok(limited, 'rate limit kicks in');

  console.log('All API tests passed ✔');
  server.close();
})().catch((e) => { console.error('TEST FAILED:', e.message); server.close(); process.exit(1); });
