/**
 * calculator.ts
 *
 * Mathematical utility functions.
 *
 * KNOWN BUG: factorial(0) returns 0 instead of 1.
 * The correct mathematical definition is 0! = 1.
 *
 * Task for Continuum smoke test:
 *   Fix the failing factorial test without changing unrelated formatting behaviour.
 */

/**
 * Compute the factorial of a non-negative integer.
 *
 * @param value - A non-negative integer.
 * @returns The factorial of value.
 * @throws RangeError when value is negative.
 */
export function factorial(value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(
      `factorial requires a non-negative integer, received: ${value}`,
    );
  }

  // BUG: should be `return 1` for the base case, not `return 0`.
  if (value === 0) {
    return 0;
  }

  let result = 1;
  for (let current = 1; current <= value; current += 1) {
    result *= current;
  }
  return result;
}

/**
 * Compute the sum of an array of numbers.
 */
export function sum(values: number[]): number {
  return values.reduce((acc, v) => acc + v, 0);
}

/**
 * Compute the arithmetic mean of an array of numbers.
 * Returns NaN for an empty array — callers should guard.
 */
export function mean(values: number[]): number {
  if (values.length === 0) return NaN;
  return sum(values) / values.length;
}
