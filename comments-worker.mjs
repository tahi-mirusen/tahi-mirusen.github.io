const SITE = 'https://tahi-mirusen.github.io';
const POST_ID = /^[a-z0-9-]{1,80}$/;

async function isModerator(request, env) {
  const key = request.headers.get('Authorization')?.match(/^Bearer ([a-zA-Z0-9_-]{24,128})$/)?.[1];
  const expected = env.COMMENTS_ADMIN_HASH;
  if (!key || !/^[a-f0-9]{64}$/.test(expected ?? '')) return false;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)));
  const actual = new TextEncoder().encode(Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join(''));
  const target = new TextEncoder().encode(expected);
  let difference = 0;
  for (let i = 0; i < target.length; i++) difference |= target[i] ^ actual[i];
  return difference === 0;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = {
      'Access-Control-Allow-Origin': SITE,
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    };
    const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers });
    const moderation = url.pathname === '/moderation';
    if (!moderation && url.pathname !== '/comments') return json({ error: 'not_found' }, 404);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    const article = url.searchParams.get('article') ?? '';
    if (!POST_ID.test(article)) return json({ error: 'article' }, 400);

    try {
      if (moderation) {
        if (request.headers.get('Origin') !== SITE || !(await isModerator(request, env))) {
          return json({ error: 'forbidden' }, 403);
        }
        if (request.method === 'PATCH') {
          const number = Number(url.searchParams.get('number'));
          const hidden = url.searchParams.get('hidden');
          if (!Number.isSafeInteger(number) || number < 1 || !['0', '1'].includes(hidden)) {
            return json({ error: 'fields' }, 400);
          }
          const comment = await env.COMMENTS.prepare(
            'UPDATE comments SET hidden = ? WHERE article = ? AND number = ? RETURNING number, hidden'
          ).bind(Number(hidden), article, number).first();
          return comment ? json({ comment }) : json({ error: 'not_found' }, 404);
        }
        if (request.method !== 'GET') return json({ error: 'method' }, 405);
        const before = Number(url.searchParams.get('before') ?? Number.MAX_SAFE_INTEGER);
        if (!Number.isSafeInteger(before) || before < 1) return json({ error: 'before' }, 400);
        const { results } = await env.COMMENTS.prepare(
          'SELECT number, name, body, created_at, hidden FROM comments WHERE article = ? AND number < ? ORDER BY number DESC LIMIT 51'
        ).bind(article, before).all();
        const comments = results.slice(0, 50);
        return json({ comments, before: results.length > 50 ? comments[49].number : null });
      }
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
      let body = typeof input?.body === 'string' ? input.body.trim() : '';
      if (!body || body.length > 1000 || name.length > 30 || /[\r\n]/.test(name) || input.website) {
        return json({ error: 'fields' }, 400);
      }
      if (input.replyTo != null) {
        if (!Number.isSafeInteger(input.replyTo) || input.replyTo < 1) return json({ error: 'reply' }, 400);
        const parent = await env.COMMENTS.prepare(
          'SELECT number FROM comments WHERE article = ? AND number = ? AND hidden = 0'
        ).bind(article, input.replyTo).first();
        if (!parent) return json({ error: 'reply' }, 409);
        body = `>>${parent.number}\n${body}`;
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
