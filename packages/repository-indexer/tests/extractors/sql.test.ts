import { describe, it, expect } from "vitest";
import { SqlExtractor } from "../../src/extractors/sql.js";

describe("SqlExtractor", () => {
  it("extracts CREATE statements", () => {
    const extractor = new SqlExtractor();
    const content = `
CREATE TABLE users (
  id INTEGER PRIMARY KEY
);

CREATE UNIQUE INDEX idx_users_id ON users(id);

CREATE VIRTUAL TABLE fts_users USING fts5(name);
    `;
    const symbols = extractor.extract("test.sql", content.trim());
    
    expect(symbols).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "users",
        kind: "table",
      }),
      expect.objectContaining({
        name: "idx_users_id",
        kind: "index",
      }),
      expect.objectContaining({
        name: "fts_users",
        kind: "table",
      })
    ]));
  });
});
