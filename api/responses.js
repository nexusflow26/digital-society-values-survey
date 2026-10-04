// GET /api/responses?key=<ADMIN_KEY>[&format=csv] — export every response (admin only).
const { VALUE_KEYS, storageMode, redis, send, safeEqual } = require('./_lib');

module.exports = async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const key = url.searchParams.get('key') || req.headers['x-admin-key'] || '';
  const adminKey = process.env.ADMIN_KEY;

  if (!adminKey) return send(res, 503, { error: 'ADMIN_KEY is not configured on the server' });
  if (!safeEqual(key, adminKey)) return send(res, 401, { error: 'Unauthorised' });

  let records;
  try {
    records = (await redis(['LRANGE', 'responses', '0', '-1'])).map((r) => JSON.parse(r));
  } catch (err) {
    console.error(err);
    return send(res, 500, { error: 'Could not read responses' });
  }

  if (url.searchParams.get('format') === 'csv') {
    const header = ['id', 'submittedAt', ...VALUE_KEYS.map((k) => `present_${k}`), ...VALUE_KEYS.map((k) => `future_${k}`)];
    const rows = records.map((r) => [r.id, r.submittedAt, ...VALUE_KEYS.map((k) => r.present[k]), ...VALUE_KEYS.map((k) => r.future[k])]);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="responses.csv"');
    res.setHeader('Cache-Control', 'no-store');
    return res.end([header, ...rows].map((r) => r.join(',')).join('\n') + '\n');
  }

  return send(res, 200, { count: records.length, storage: storageMode, responses: records });
};
