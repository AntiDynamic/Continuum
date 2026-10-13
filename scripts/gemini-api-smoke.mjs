#!/usr/bin/env node
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env");
try {
  process.loadEnvFile(envPath);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
// Accept the lowercase key used by existing local setups, while documenting
// GEMINI_API_KEY as the canonical portable name.
const apiKey = process.env.GEMINI_API_KEY ?? process.env.gemini_api_key;
const model = process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite";
const allowedModels = new Set(["gemini-3.5-flash-lite"]);

if (!apiKey) throw new Error("GEMINI_API_KEY is not configured in the local environment");
if (!allowedModels.has(model)) throw new Error(`Model is not allowed for this smoke test: ${model}`);

const startedAt = performance.now();
const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  signal: AbortSignal.timeout(30_000),
  body: JSON.stringify({
    contents: [{ parts: [{ text: "Reply with exactly READY and nothing else." }] }],
    generationConfig: { maxOutputTokens: 16, temperature: 0 },
  }),
});
const body = await response.json().catch(() => ({}));
const usage = body.usageMetadata ?? null;
const text = body.candidates?.flatMap((candidate) => candidate.content?.parts ?? []).map((part) => part.text ?? "").join("").trim() ?? "";

if (!response.ok) {
  const failureCategory = response.status === 401 ? "provider_auth"
    : response.status === 403 ? "provider_project_access"
      : response.status === 429 ? "provider_quota"
        : response.status >= 500 ? "provider_unavailable"
          : "provider_request_error";
  console.error(JSON.stringify({ ok: false, model, status: response.status, failureCategory, error: body.error?.message ?? "Gemini API request failed" }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    ok: text === "READY",
    model,
    status: response.status,
    latencyMs: Math.round(performance.now() - startedAt),
    responseText: text,
    usage: usage ? {
      promptTokenCount: usage.promptTokenCount ?? null,
      cachedContentTokenCount: usage.cachedContentTokenCount ?? null,
      candidatesTokenCount: usage.candidatesTokenCount ?? null,
      thoughtsTokenCount: usage.thoughtsTokenCount ?? null,
      totalTokenCount: usage.totalTokenCount ?? null,
    } : null,
  }, null, 2));
  if (text !== "READY") process.exitCode = 1;
}
