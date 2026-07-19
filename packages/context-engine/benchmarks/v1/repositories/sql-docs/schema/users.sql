CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, refresh_token_hash TEXT);
