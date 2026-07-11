import { describe, it, expect } from "vitest";
import { padLeft, padRight, ellipsis, camelToKebab, capitalise } from "../src/formatter.js";

describe("padLeft", () => {
  it("pads a short string", () => {
    expect(padLeft("hi", 5)).toBe("   hi");
  });
  it("returns unchanged string when already at width", () => {
    expect(padLeft("hello", 5)).toBe("hello");
  });
  it("supports custom fill character", () => {
    expect(padLeft("3", 4, "0")).toBe("0003");
  });
});

describe("padRight", () => {
  it("pads to the right", () => {
    expect(padRight("hi", 5)).toBe("hi   ");
  });
  it("supports custom fill", () => {
    expect(padRight("a", 4, "-")).toBe("a---");
  });
});

describe("ellipsis", () => {
  it("truncates with ellipsis", () => {
    const result = ellipsis("Hello, World!", 8);
    expect(result.length).toBe(8);
    expect(result.endsWith("…")).toBe(true);
  });
  it("returns unchanged string within limit", () => {
    expect(ellipsis("Hello", 10)).toBe("Hello");
  });
});

describe("camelToKebab", () => {
  it("converts camelCase to kebab-case", () => {
    expect(camelToKebab("helloWorld")).toBe("hello-world");
    expect(camelToKebab("myTestString")).toBe("my-test-string");
  });
  it("handles single word", () => {
    expect(camelToKebab("hello")).toBe("hello");
  });
});

describe("capitalise", () => {
  it("capitalises the first letter", () => {
    expect(capitalise("hello")).toBe("Hello");
  });
  it("handles empty string", () => {
    expect(capitalise("")).toBe("");
  });
});
