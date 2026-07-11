# Sample Repository

This is the Continuum fixture repository used to test and demonstrate Continuum Observer V1.

## The Bug

`src/calculator.ts` contains a deliberate bug in the `factorial` function.

**Expected behaviour:** `factorial(0)` should return `1` (the mathematical definition of 0!).

**Actual behaviour:** The current implementation returns `0` for `factorial(0)`.

## Your Task

```text
Fix the failing factorial test without changing unrelated formatting behaviour.
```

## Running the Tests

```bash
pnpm install
pnpm test
```

You should see one test failing: `factorial(0) should equal 1`.

After fixing the bug, all tests should pass.

## Files

- `src/calculator.ts` — **Contains the bug** — fix the `factorial` base case.
- `src/formatter.ts` — **Unrelated** — do not modify this file.
- `tests/calculator.test.ts` — Tests for the calculator functions.
- `tests/formatter.test.ts` — Tests for the formatter (should always pass).

## What Continuum Observes

Continuum will:
1. Record the failing baseline tests.
2. Launch Gemini CLI with your task.
3. Record which files were changed.
4. Record the passing final tests.
5. Check whether `formatter.ts` was modified unnecessarily.
6. Generate an evidence-based report.
