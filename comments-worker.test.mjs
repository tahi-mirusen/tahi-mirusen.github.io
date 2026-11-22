import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from './comments-worker.mjs';

const db = new DatabaseSync(':memory:');
db.exec(readFileSync(new URL('./comments-schema.sql', import.meta.url), 'utf8'));
const env = { COMMENTS: { prepare: sql => ({ bind: (...args) => ({
  all: () => ({ results: db.prepare(sql).all(...args) }),
  first: () => db.prepare(sql).get(...args)
}) }) } };
const site = 'https://tahi-mirusen.github.io';
const call = (article, input, origin = site) => worker.fetch(new Request(
  `https://example.com/comments?article=${article}`,
  input === undefined ? {} : { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(input) }
), env);

assert.equal((await call('first', { body: '  ' })).status, 400);
assert.equal((await call('first', { body: 'ok' }, 'https://other.example')).status, 403);
assert.equal((await call('first', { body: 'x'.repeat(11000) })).status, 413);
const first = await call('first', { body: '<b>こんにちは</b>' });
assert.equal(first.status, 201);
assert.equal(first.headers.get('Access-Control-Allow-Origin'), site);
assert.equal((await first.json()).comment.name, '名無しさん');
assert.equal((await call('first', { body: '<b>こんにちは</b>' })).status, 429);
assert.equal((await (await call('first', { name: 'テスト', body: '返信' })).json()).comment.number, 2);
assert.equal((await (await call('second', { body: '別記事' })).json()).comment.number, 1);
db.exec("UPDATE comments SET hidden=1 WHERE article='first' AND number=1");
assert.deepEqual((await (await call('first')).json()).comments.map(({ number }) => number), [2]);
assert.equal((await (await call('first', { body: '次の返信' })).json()).comment.number, 3);
for (let i = 1; i <= 55; i++) db.prepare('INSERT INTO comments (article, number, name, body, created_at) VALUES (?, ?, ?, ?, ?)').run('archive', i, '名無し', String(i), 1);
const archive = await (await call('archive')).json();
assert.equal(archive.before, 6);
assert.equal(archive.comments.length, 50);
assert.deepEqual((await (await call('archive&before=6')).json()).comments.map(({ number }) => number), [1, 2, 3, 4, 5]);
console.log('OK: anonymous posting, numbering, article isolation, moderation, validation, pagination');
