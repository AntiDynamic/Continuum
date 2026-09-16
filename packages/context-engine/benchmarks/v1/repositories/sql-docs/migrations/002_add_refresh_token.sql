ALTER TABLE users ADD COLUMN refresh_token TEXT;
CREATE INDEX users_refresh_token_idx ON users(refresh_token);
-- rollback requires rebuilding users without refresh_token
