// GET /api/status?id=<respondentId> — has this browser / respondent already submitted?
const { COOKIE_NAME, UUID_RE, redis, parseCookies, send } = require('./_lib');

module.exports = async (req, res) => {
  if (parseCookies(req)[COOKIE_NAME]) return send(res, 200, { submitted: true });

  const url = new URL(req.url, 'http://localhost');
  const id = url.searchParams.get('id') || '';
  if (!UUID_RE.test(id)) return send(res, 200, { submitted: false });

  try {
    const exists = await redis(['EXISTS', `resp:${id}`]);
    return send(res, 200, { submitted: exists === 1 });
  } catch (err) {
    console.error(err);
    return send(res, 200, { submitted: false });
  }
};
