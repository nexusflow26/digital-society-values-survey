// POST /api/submit — store one response (present-day plot + 2060 plot) per respondent.
const {
  COOKIE_NAME, RATE_LIMIT_PER_HOUR, UUID_RE, storageMode,
  redis, normalisePlot, parseCookies, clientIpHash, readJsonBody, send,
} = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { ok: false, error: 'Method not allowed' });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return send(res, 400, { ok: false, error: 'Invalid JSON' });
  }

  const id = String(body.respondentId || '');
  const present = normalisePlot(body.present);
  const future = normalisePlot(body.future);
  if (!UUID_RE.test(id)) return send(res, 400, { ok: false, error: 'Missing or invalid respondent id' });
  if (!present || !future) {
    return send(res, 400, { ok: false, error: 'Both plots need exactly one dot (three values summing to 100%)' });
  }

  // Layer 1: this browser already has the "submitted" cookie
  if (parseCookies(req)[COOKIE_NAME]) {
    return send(res, 409, { ok: false, alreadySubmitted: true, error: 'You have already submitted a response. Thank you!' });
  }

  try {
    // Anti-spam: hashed-IP hourly counter (not a hard block — many people share campus Wi-Fi)
    const rlKey = `rl:${clientIpHash(req)}`;
    const count = await redis(['INCR', rlKey]);
    if (count === 1) await redis(['EXPIRE', rlKey, '3600']);
    if (count > RATE_LIMIT_PER_HOUR) {
      return send(res, 429, { ok: false, error: 'Too many submissions from this network. Please try again later.' });
    }

    const record = { id, submittedAt: new Date().toISOString(), present, future };

    // Layer 2: one record per respondent id, guaranteed atomically by SET NX
    const stored = await redis(['SET', `resp:${id}`, JSON.stringify(record), 'NX']);
    if (stored === null) {
      return send(res, 409, { ok: false, alreadySubmitted: true, error: 'You have already submitted a response. Thank you!' });
    }
    await redis(['RPUSH', 'responses', JSON.stringify(record)]);

    res.setHeader('Set-Cookie', `${COOKIE_NAME}=1; Max-Age=31536000; Path=/; HttpOnly; Secure; SameSite=Lax`);
    return send(res, 201, { ok: true, storage: storageMode });
  } catch (err) {
    console.error(err);
    return send(res, 500, { ok: false, error: 'Could not save your response. Please try again.' });
  }
};
