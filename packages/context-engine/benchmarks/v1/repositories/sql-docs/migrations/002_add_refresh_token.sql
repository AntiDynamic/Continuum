ALTER TABLE users ADD COLUMN refresh_token_hash TEXT;
CREATE INDEX users_refresh_token_idx ON users(refresh_token_hash);
-- rollback requires rebuilding users without refresh_token_hash
