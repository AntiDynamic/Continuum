CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE);
CREATE INDEX users_email_idx ON users(email);
-- rollback
DROP INDEX users_email_idx;
DROP TABLE users;
