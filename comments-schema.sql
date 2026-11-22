CREATE TABLE IF NOT EXISTS comments (
  article TEXT NOT NULL,
  number INTEGER NOT NULL,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (article, number)
);
CREATE INDEX IF NOT EXISTS comments_by_time ON comments (created_at);
