const SITE = 'https://tahi-mirusen.github.io';
const POST_ID = /^[a-z0-9-]{1,80}$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = {
      'Access-Control-Allow-Origin': SITE,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    };
    const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers });
    if (url.pathname !== '/comments') return json({ error: 'not_found' }, 404);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    const article = url.searchParams.get('article') ?? '';
    if (!POST_ID.test(article)) return json({ error: 'article' }, 400);

    try {
      if (request.method === 'GET') {
        const raw = url.searchParams.get('before');
        const before = raw === null ? Number.MAX_SAFE_INTEGER : Number(raw);
        if (!Number.isSafeInteger(before) || before < 1) return json({ error: 'before' }, 400);
        const { results } = await env.COMMENTS.prepare(
          'SELECT number, name, body, created_at FROM comments WHERE article = ? AND hidden = 0 AND number < ? ORDER BY number DESC LIMIT 51'
        ).bind(article, before).all();
        const comments = results.slice(0, 50).reverse();
        return json({ comments, before: results.length > 50 ? comments[0].number : null });
      }
      if (request.method !== 'POST') return json({ error: 'method' }, 405);
      if (request.headers.get('Origin') !== SITE) return json({ error: 'origin' }, 403);
      if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
        return json({ error: 'format' }, 415);
      }
      const reader = request.body?.getReader();
      if (!reader) return json({ error: 'format' }, 400);
      const decoder = new TextDecoder();
      let bytes = 0;
      let text = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > 10000) {
          await reader.cancel();
          return json({ error: 'size' }, 413);
        }
        text += decoder.decode(value, { stream: true });
      }
      let input;
      try { input = JSON.parse(text + decoder.decode()); }
      catch { return json({ error: 'format' }, 400); }
      const name = typeof input?.name === 'string' ? input.name.trim() : '';
      const body = typeof input?.body === 'string' ? input.body.trim() : '';
      if (!body || body.length > 1000 || name.length > 30 || /[\r\n]/.test(name) || input.website) {
        return json({ error: 'fields' }, 400);
      }
      const now = Date.now();
      // One atomic statement sets the next number and caps posting without storing IP addresses.
      const comment = await env.COMMENTS.prepare(`INSERT INTO comments (article, number, name, body, created_at)
        SELECT ?, COALESCE((SELECT MAX(number) FROM comments WHERE article = ?), 0) + 1, ?, ?, ?
        WHERE (SELECT count(*) FROM comments WHERE created_at > ?) < 20
          AND (SELECT count(*) FROM comments WHERE created_at > ?) < 300
          AND NOT EXISTS (SELECT 1 FROM comments WHERE article = ? AND body = ? AND created_at > ?)
        RETURNING number, name, body, created_at`)
        .bind(article, article, name || '名無しさん', body, now, now - 60000, now - 86400000, article, body, now - 300000).first();
      return comment ? json({ comment }, 201) : json({ error: 'rate' }, 429);
    } catch {
      return json({ error: 'unavailable' }, 503);
    }
  }
};
