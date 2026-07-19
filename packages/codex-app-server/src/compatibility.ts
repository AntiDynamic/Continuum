import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { CodexIntegrationError } from "./errors.js";

export const TESTED_CODEX_VERSION = "0.133.0";
export const CODEX_PROTOCOL_MODE = "stable" as const;

export function resolveCodexExecutable(): string {
  const command = process.platform === "win32" ? "where.exe" : "which";
  const result = spawnSync(command, ["codex"], { encoding: "utf8", windowsHide: true });
  const paths = result.status === 0 ? result.stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean) : [];
  const selected = process.platform === "win32" ? paths.find((value) => /\.(?:cmd|exe)$/i.test(value)) : paths[0];
  if (!selected) throw new CodexIntegrationError("CODEX_EXECUTABLE_UNAVAILABLE", "Codex is not installed or is not available on PATH.");
  return selected;
}

export function resolveCodexInvocation(executable = resolveCodexExecutable()): { command: string; argsPrefix: string[] } {
  if (process.platform === "win32" && /\.(?:cmd|bat)$/i.test(executable)) {
    const script=join(dirname(executable),"node_modules","@openai","codex","bin","codex.js");
    if (!existsSync(script)) throw new CodexIntegrationError("CODEX_EXECUTABLE_UNAVAILABLE", `Unsupported Codex command shim: ${executable}`);
    return {command:process.execPath,argsPrefix:[script]};
  }
  return {command:executable,argsPrefix:[]};
}

export function detectCodexVersion(executable = resolveCodexExecutable()): string {
  const invocation=resolveCodexInvocation(executable);
  const result = spawnSync(invocation.command, [...invocation.argsPrefix,"--version"], { encoding: "utf8", windowsHide: true, shell: false });
  if (result.status !== 0) throw new CodexIntegrationError("CODEX_EXECUTABLE_UNAVAILABLE", "Codex version detection failed.");
  const match = result.stdout.match(/(\d+\.\d+\.\d+)/);
  if (!match) throw new CodexIntegrationError("PROTOCOL_INCOMPATIBILITY", "Codex returned an unrecognized version string.");
  return match[1]!;
}

export function compatibilityFor(version: string): { tested: boolean; warning: string | null } {
  const [major, minor] = version.split(".").map(Number);
  const [testedMajor, testedMinor] = TESTED_CODEX_VERSION.split(".").map(Number);
  const tested = major === testedMajor && minor === testedMinor;
  return { tested, warning: tested ? null : `Codex ${version} is outside the tested 0.133.x range; required capabilities will be probed at runtime.` };
}

export function stableSchemaFingerprint(): string {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "schema", TESTED_CODEX_VERSION);
  const schema = readFileSync(join(root, "codex_app_server_protocol.schemas.json"));
  return createHash("sha256").update(schema).digest("hex");
}
