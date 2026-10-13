import { mkdtemp, readdir, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, relative, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ts from "typescript";

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const supported = new Set(["small-local-cache-timeout", "small-local-token-refresh", "mono-cross-user-session", "mono-cross-web-contract", "sql-migration-users", "sql-migration-refresh", "small-api-contract", "mono-api-contract", "small-security-token", "sql-security-refresh", "small-config-timeout", "small-doc-mismatch"]);

async function filesAt(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (["node_modules", ".git", ".continuum"].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesAt(path));
    else if (entry.isFile() && /\.ts$/.test(entry.name)) files.push(path);
  }
  return files;
}

/** Execute evaluator-owned assertions in a bounded child process, outside the agent repository. */
export async function verifyBehavior({ repository, taskId, hidden = false, timeoutMs = 10000, expectedConfigTimeout }) {
  if (!supported.has(taskId)) return { status: "not_configured", taskId, checks: [], behavioral: true, validator: "executable-behavior-v1" };
  const scratch = await mkdtemp(join(tmpdir(), "continuum-evaluator-"));
  try {
    const compiled = join(scratch, "compiled");
    await mkdir(compiled);
    await writeFile(join(compiled, "package.json"), '{"type":"commonjs"}');
    const sources = await filesAt(repository);
    const program = ts.createProgram(sources, { noEmit: true, strict: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10, types: [], skipLibCheck: true });
    const diagnostics = ts.getPreEmitDiagnostics(program);
    if (diagnostics.some(x => x.category === ts.DiagnosticCategory.Error)) throw new Error(ts.flattenDiagnosticMessageText(diagnostics[0].messageText, " "));
    for (const path of sources) {
      const source = await readFile(path, "utf8");
      const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }, fileName: path, reportDiagnostics: true });
      if (output.diagnostics?.some(x => x.category === ts.DiagnosticCategory.Error)) throw new Error("Invalid TypeScript: " + relative(repository, path));
      const target = join(compiled, relative(repository, path).replace(/\.ts$/, ".js"));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, output.outputText);
    }
    const result = await exec(process.execPath, [fileURLToPath(import.meta.url), "--evaluate", compiled, repository, taskId, hidden ? "hidden" : "visible", expectedConfigTimeout===undefined?"":String(expectedConfigTimeout)], { cwd: scratch, timeout: timeoutMs, maxBuffer: 1024 * 1024 });
    return { status: "passed", taskId, checks: [{ name: hidden ? "independent-behavior" : "fixture-behavior", status: "passed" }], behavioral: true, validator: "executable-behavior-v1", output: result.stdout.trim() };
  } catch (error) {
    return { status: "failed", taskId, checks: [{ name: hidden ? "independent-behavior" : "fixture-behavior", status: "failed", error: error.stderr || error.message }], behavioral: true, validator: "executable-behavior-v1" };
  } finally { await rm(scratch, { recursive: true, force: true }); }
}

async function evaluate(compiled, repository, taskId, hidden, expectedConfigTimeout) {
  const assert = (await import("node:assert/strict")).default;
  const require = createRequire(join(compiled, "package.json"));
  const load = path => require(join(compiled, path.replace(/\.ts$/, ".js")));
  const text = path => readFile(join(repository, path), "utf8");
  if (!hidden) {
    let count = 0;
    const visit = async directory => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) await visit(path);
        else if (/\.test\.js$/.test(entry.name) && (!["small-local-token-refresh", "small-security-token", "small-doc-mismatch"].includes(taskId) || relative(compiled, path) === "tests/auth-service.test.js")) {
          for (const [name, fn] of Object.entries(require(path))) if (/test$/i.test(name) && typeof fn === "function") { assert.equal(await fn(), true, `Fixture ${name} must return true`); count++; }
        }
      }
    };
    await visit(compiled);
    assert.ok(count > 0, "No executable exported fixture tests found");
  }
  const ids = hidden ? ["u17", "different-user"] : ["u1"];
  if (taskId === "small-local-cache-timeout") {
    const { readCache } = load("src/cache.ts");
    assert.equal(readCache("timeout"), undefined);
    for (const key of ["hello", "", "timeout-other"]) assert.equal(readCache(key), key);
  } else if (["small-local-token-refresh", "small-security-token", "small-doc-mismatch"].includes(taskId)) {
    const { AuthService } = load("src/auth-service.ts"), auth = new AuthService();
    assert.throws(() => auth.validateToken(""));
    assert.throws(() => auth.refreshToken(""));
    // The task contract uses a documented expired credential representation.
    assert.throws(() => auth.validateToken("expired"));
    assert.throws(() => auth.refreshToken("expired"));
    for (const id of ids) { const before = Date.now(); const claims = auth.validateToken(id); assert.equal(claims.subject, id); assert.equal(typeof claims.expiresAt, "number"); assert.ok(Number.isFinite(claims.expiresAt)); assert.ok(claims.expiresAt > before, "Valid claims must retain future expiration"); assert.equal(auth.refreshToken(id), `${id}-refreshed`); }
    if (taskId === "small-doc-mismatch") {
      const docs = (await text("docs/authentication.md")).toLowerCase();
      assert.ok(docs.includes("expired") && docs.includes("empty"));
      assert.ok(docs.includes(String(load("src/app-config.ts").loadAppConfig().timeoutMs)));
    }
  } else if (["mono-cross-user-session", "mono-api-contract"].includes(taskId)) {
    const { updateUser } = load("packages/api/src/routes.ts");
    const { createSession } = load("packages/core/src/session.ts");
    for (const id of ids) { assert.deepEqual(await updateUser(id), { id, sessionId: `session-${id}` }); const session=createSession(id);assert.equal(session.userId,id);assert.equal(session.id,`session-${id}`); }
  } else if (taskId === "mono-cross-web-contract") {
    const { fetchUser } = load("packages/web/src/client.ts");
    for (const id of ids) assert.deepEqual(await fetchUser(id), { id, sessionId: `session-${id}` });
  } else if (taskId === "small-api-contract") {
    const { UserController } = load("src/api.ts");
    for (const id of ids) {const result=new UserController().getUser(id);assert.equal(typeof result?.then,"function","The public API must remain asynchronous");assert.deepEqual(await result,{id});}
  } else if (taskId === "small-config-timeout") {
    const yaml = createRequire(join(root, "packages/repository-indexer/package.json"))("yaml");
    const config = yaml.parse(await text("config/app.yaml"));
    assert.deepEqual(load("src/app-config.ts").loadAppConfig(), config);
    assert.ok(Number.isFinite(config.timeoutMs) && config.timeoutMs > 0);
    if(expectedConfigTimeout!==undefined)assert.equal(config.timeoutMs,expectedConfigTimeout,"Configuration must implement the latest user requirement");
  } else if (taskId.startsWith("sql-")) {
    const { DatabaseSync } = await import("node:sqlite"), db = new DatabaseSync(":memory:");
    const split = source => { const parts = source.split(/^\s*--\s*(?:rollback|down migration)\b[^\n]*$/im); assert.equal(parts.length, 2, "Migration needs an executable rollback section"); assert.ok(parts[1].replace(/--[^\n]*/g, "").trim(), "Rollback cannot be only a comment"); return parts; };
    try {
      const users = split(await text("migrations/001_create_users.sql"));
      db.exec(users[0]);
      db.prepare("INSERT INTO users(id,email) VALUES(?,?)").run("u17", "audit@example.test");
      assert.throws(() => db.prepare("INSERT INTO users(id,email) VALUES(?,?)").run("u18", "audit@example.test"));
      if (taskId !== "sql-migration-users") {
        const refresh = split(await text("migrations/002_add_refresh_token.sql"));
        db.exec(refresh[0]);
        const columns = db.prepare("PRAGMA table_info(users)").all().map(x => x.name);
        assert.ok(columns.includes("refresh_token_hash")); assert.ok(!columns.includes("refresh_token"));
        const indexes = db.prepare("PRAGMA index_list(users)").all();
        assert.ok(indexes.some(x => db.prepare(`PRAGMA index_info("${String(x.name).replaceAll('"', '""')}")`).all().some(c => c.name === "refresh_token_hash")));
        db.exec(refresh[1]);
        assert.equal(db.prepare("SELECT email FROM users WHERE id='u17'").get().email, "audit@example.test");
        assert.ok(!db.prepare("PRAGMA table_info(users)").all().some(x => x.name === "refresh_token_hash"));
      }
      db.exec(users[1]);
      assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='users'").get().n, 0);
    } finally { db.close(); }
  }
  console.log("Executable behavior passed");
}

if (process.argv[2] === "--evaluate") await evaluate(process.argv[3], process.argv[4], process.argv[5], process.argv[6] === "hidden",process.argv[7]?Number(process.argv[7]):undefined);
