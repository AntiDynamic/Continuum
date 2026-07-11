import { describe, it, expect } from "vitest";
import { redactString, redactObject, redactJsonString } from "../src/redaction.js";

describe("redactString", () => {
  it("redacts a Gemini API key", () => {
    const input = "key=AIzaSyAbcdefghijklmnopqrstuvwxyz01234567";
    const result = redactString(input);
    expect(result).not.toContain("AIzaSy");
    expect(result).toContain("[REDACTED:GEMINI_KEY]");
  });

  it("redacts an OpenAI API key", () => {
    const input = "Authorization: sk-abcdefghijklmnopqrstu12345678";
    const result = redactString(input);
    expect(result).not.toContain("sk-abcde");
    expect(result).toContain("[REDACTED:OPENAI_KEY]");
  });

  it("redacts a bearer token", () => {
    const input = "Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.abc";
    const result = redactString(input);
    expect(result).not.toContain("eyJhbGci");
    expect(result).toContain("[REDACTED:BEARER]");
  });

  it("redacts a key-value assignment", () => {
    const input = "API_KEY=super_secret_value_123456";
    const result = redactString(input);
    expect(result).not.toContain("super_secret");
    expect(result).toContain("[REDACTED]");
  });

  it("does not redact normal text", () => {
    const input = "The agent completed the task successfully.";
    expect(redactString(input)).toBe(input);
  });

  it("applies user-supplied extra patterns", () => {
    const input = "MY_TOKEN=abc123xyz";
    const result = redactString(input, ["MY_TOKEN=\\S+"]);
    expect(result).not.toContain("abc123xyz");
  });

  it("skips invalid user patterns gracefully", () => {
    // Should not throw — just log a warning
    expect(() => redactString("hello", ["[invalid(regex"])).not.toThrow();
  });
});

describe("redactObject", () => {
  it("redacts string values inside an object", () => {
    const obj = { key: "AIzaSyAbcdefghijklmnopqrstuvwxyz01234567", safe: "hello" };
    const result = redactObject(obj) as typeof obj;
    expect(result["key"]).toContain("[REDACTED:GEMINI_KEY]");
    expect(result["safe"]).toBe("hello");
  });

  it("handles nested arrays and objects", () => {
    const obj = { items: [{ val: "sk-abcdefghijklmnopqrstu12345678" }] };
    const result = redactObject(obj) as typeof obj;
    expect((result["items"][0] as { val: string })["val"]).toContain("[REDACTED:OPENAI_KEY]");
  });

  it("passes through numbers and booleans unchanged", () => {
    const obj = { count: 42, flag: true };
    const result = redactObject(obj) as typeof obj;
    expect(result["count"]).toBe(42);
    expect(result["flag"]).toBe(true);
  });
});

describe("redactJsonString", () => {
  it("parses, redacts, and re-serialises JSON", () => {
    const input = JSON.stringify({ token: "AIzaSyAbcdefghijklmnopqrstuvwxyz01234567" });
    const result = redactJsonString(input);
    const parsed = JSON.parse(result) as { token: string };
    expect(parsed["token"]).toContain("[REDACTED:GEMINI_KEY]");
  });

  it("falls back to plain string redaction for non-JSON input", () => {
    const input = "Bearer AIzaSyAbcdefghijklmnopqrstuvwxyz01234567";
    const result = redactJsonString(input);
    expect(result).not.toContain("AIzaSy");
  });
});
