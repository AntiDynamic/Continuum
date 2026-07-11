import { describe, it, expect } from "vitest";
import { factorial, sum, mean } from "../src/calculator.js";

describe("factorial", () => {
  it("factorial(0) should equal 1", () => {
    // This test FAILS with the current buggy implementation.
    // The agent's task is to fix this.
    expect(factorial(0)).toBe(1);
  });

  it("factorial(1) equals 1", () => {
    expect(factorial(1)).toBe(1);
  });

  it("factorial(5) equals 120", () => {
    expect(factorial(5)).toBe(120);
  });

  it("factorial(10) equals 3628800", () => {
    expect(factorial(10)).toBe(3_628_800);
  });

  it("throws RangeError for negative input", () => {
    expect(() => factorial(-1)).toThrow(RangeError);
  });

  it("throws RangeError for non-integer input", () => {
    expect(() => factorial(1.5)).toThrow(RangeError);
  });
});

describe("sum", () => {
  it("sums an array of numbers", () => {
    expect(sum([1, 2, 3, 4])).toBe(10);
  });

  it("returns 0 for an empty array", () => {
    expect(sum([])).toBe(0);
  });
});

describe("mean", () => {
  it("computes the mean", () => {
    expect(mean([1, 2, 3])).toBe(2);
  });

  it("returns NaN for empty array", () => {
    expect(mean([])).toBeNaN();
  });
});
