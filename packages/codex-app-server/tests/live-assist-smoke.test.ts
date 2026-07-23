import { afterAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "@continuum/database";
import { CodexAssistExecutionService, CodexIntegrationError } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, "../../../apps/cli/dist/main.js");
const allowed =
  /rate.?limit|quota|insufficient.?credits|authentication|model.+unavailable|requires a newer version of Codex|upgrade to the latest app or CLI/i;
let root = "";

function run(command: string, args: string[], cwd: string): Promise<number> {
  return new Promise((done, reject) => {
    const child = spawn(command, args, {
      cwd, env: process.env, windowsHide: true,
      shell: process.platform === "win32" && command.includes("npm"),
    });
    child.on("error", reject);
    child.on("close", (code) => done(code ?? -1));
  });
}

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
});

describe("installed Codex App Server live assist", () => {
  it("runs a genuine isolated assist turn", async (context) => {
    root = await mkdtemp(join(tmpdir(), "continuum-codex-live-assist-"));
    const repo = join(root, "repository");
    await mkdir(join(repo, "src"), { recursive: true });
    await mkdir(join(repo, "tests"));
    await writeFile(join(repo, "package.json"), JSON.stringify({
      name: "assist-smoke", type: "module", scripts: { test: "node --test" },
    }));
    await writeFile(join(repo, "src", "add.js"), "export const add = (_a, _b) => 0;\n");
    await writeFile(join(repo, "tests", "add.test.js"), [
      "import test from 'node:test';",
      "import assert from 'node:assert/strict';",
      "import { add } from '../src/add.js';",
      "test('add', () => assert.equal(add(1, 2), 3));",
      "",
    ].join("\n"));
    for (const args of [
      ["init"], ["config", "user.name", "Continuum Live"],
      ["config", "user.email", "live@example.test"], ["add", "."], ["commit", "-m", "fixture"],
    ]) expect(await run("git", args, repo)).toBe(0);
    for (const args of [["init", "--non-interactive"], ["index"]]) {
      expect(await run(process.execPath, [cli, ...args], repo)).toBe(0);
    }
    try {
      const model = process.env["CONTINUUM_CODEX_LIVE_MODEL"] ?? undefined;
      const result = await new CodexAssistExecutionService().runAssist({
        cwd: repo, task: "Fix src/add.js so `npm test` passes.",
        ...(model ? { model } : {}), sandbox: "workspace-write",
        approvalPolicy: "never", timeoutMs: 300_000,
      });
      if (result.report.execution.status !== "completed") {
        const db = openDatabase(join(repo, ".continuum", "continuum.db"));
        let raw = "";
        try {
          const row = db.prepare(
            "SELECT raw_json FROM codex_raw_events WHERE execution_id=? AND method='turn/completed' ORDER BY sequence_number DESC LIMIT 1",
          ).get(result.executionId) as { raw_json: string } | undefined;
          raw = row?.raw_json ?? "";
        } finally {
          db.close();
        }
        if (allowed.test(raw)) {
          console.warn(`SKIP: genuine Codex assist blocked by explicit provider response: ${raw}`);
          context.skip();
          return;
        }
        throw new Error(`Genuine Codex assist failed without an allowed blocked reason: ${raw}`);
      }
      const npm = process.platform === "win32" ? "npm.cmd" : "npm";
      expect(await run(npm, ["test"], repo)).toBe(0);
    } catch (error) {
      if (error instanceof CodexIntegrationError && [
        "CODEX_EXECUTABLE_UNAVAILABLE", "APP_SERVER_UNAVAILABLE", "AUTHENTICATION_REQUIRED",
      ].includes(error.code)) {
        console.warn(`SKIP: genuine Codex assist unavailable: ${error.code}: ${error.message}`);
        context.skip();
        return;
      }
      throw error;
    }
  }, 360_000);
});
