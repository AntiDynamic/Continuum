import { describe, it, expect } from "vitest";
import { parseDurationMs, formatDuration, truncate, normalisePath } from "../src/utils.js";

describe("parseDurationMs", () => {
  it("parses plain milliseconds", () => {
    expect(parseDurationMs("5000")).toBe(5000);
  });
  it("parses seconds", () => {
    expect(parseDurationMs("30s")).toBe(30_000);
  });
  it("parses minutes", () => {
    expect(parseDurationMs("5m")).toBe(300_000);
  });
  it("parses minutes and seconds", () => {
    expect(parseDurationMs("2m30s")).toBe(150_000);
  });
  it("parses hours", () => {
    expect(parseDurationMs("1h")).toBe(3_600_000);
  });
});

describe("formatDuration", () => {
  it("formats milliseconds", () => {
    expect(formatDuration(500)).toBe("500ms");
  });
  it("formats seconds", () => {
    expect(formatDuration(45_000)).toBe("45s");
  });
  it("formats minutes and seconds", () => {
    expect(formatDuration(402_000)).toBe("6m 42s");
  });
  it("formats whole minutes", () => {
    expect(formatDuration(120_000)).toBe("2m");
  });
});

describe("truncate", () => {
  it("returns the string unchanged when within limit", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });
  it("adds ellipsis when too long", () => {
    const result = truncate("hello world", 8);
    expect(result).toBe("hello...");
    expect(result.length).toBe(8);
  });
});

describe("normalisePath", () => {
  it("converts backslashes to forward slashes", () => {
    expect(normalisePath("C:\\Users\\test\\project")).toBe("C:/Users/test/project");
  });
  it("leaves forward slashes unchanged", () => {
    expect(normalisePath("/home/user/project")).toBe("/home/user/project");
  });
});
