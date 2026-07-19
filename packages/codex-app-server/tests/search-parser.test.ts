import { describe, it, expect } from "vitest";
import { parseSearchCommand } from "../src/normalizer.js";

describe("parseSearchCommand", () => {
  it("parses basic rg command", () => {
    const res = parseSearchCommand(`rg "AuthService" src`);
    expect(res.tool).toBe("rg");
    expect(res.patterns).toEqual(["AuthService"]);
    expect(res.searchedSymbols).toEqual(["AuthService"]);
    expect(res.paths).toEqual(["src"]);
  });

  it("is case-insensitive for the tool name", () => {
    const res = parseSearchCommand(`RG "AuthService" src`);
    expect(res.tool).toBe("rg");
    expect(res.patterns).toEqual(["AuthService"]);
    expect(res.searchedSymbols).toEqual(["AuthService"]);
    expect(res.paths).toEqual(["src"]);
  });

  it("handles unquoted patterns and skips boolean flags", () => {
    const res = parseSearchCommand(`rg -n AuthService packages/auth`);
    expect(res.tool).toBe("rg");
    expect(res.patterns).toEqual(["AuthService"]);
    expect(res.searchedSymbols).toEqual(["AuthService"]);
    expect(res.paths).toEqual(["packages/auth"]);
  });

  it("handles consuming flags like --glob correctly", () => {
    const res = parseSearchCommand(`rg --glob "*.ts" "refreshToken" packages`);
    expect(res.tool).toBe("rg");
    expect(res.patterns).toEqual(["refreshToken"]);
    expect(res.searchedSymbols).toEqual(["refreshToken"]);
    expect(res.paths).toEqual(["packages"]);
  });

  it("parses basic grep command with boolean flags", () => {
    const res = parseSearchCommand(`grep -R "AuthService" src`);
    expect(res.tool).toBe("grep");
    expect(res.patterns).toEqual(["AuthService"]);
    expect(res.searchedSymbols).toEqual(["AuthService"]);
    expect(res.paths).toEqual(["src"]);
  });

  it("parses git grep safely recognizing it as git-grep", () => {
    const res = parseSearchCommand(`git grep "AuthService" -- packages/auth`);
    expect(res.tool).toBe("git-grep");
    expect(res.patterns).toEqual(["AuthService"]);
    expect(res.searchedSymbols).toEqual(["AuthService"]);
    expect(res.paths).toEqual(["packages/auth"]);
  });

  it("parses findstr with windows-style flags", () => {
    const res = parseSearchCommand(`findstr /S /N "AuthService" *.ts`);
    expect(res.tool).toBe("findstr");
    expect(res.patterns).toEqual(["AuthService"]);
    expect(res.searchedSymbols).toEqual(["AuthService"]);
    // findstr flags /S /N should not be treated as patterns
    expect(res.paths).toEqual(["*.ts"]);
  });

  it("parses Select-String with -Pattern and -Path named arguments", () => {
    const res = parseSearchCommand(`Select-String -Pattern "AuthService" -Path "src/*.ts"`);
    expect(res.tool).toBe("select-string");
    expect(res.patterns).toEqual(["AuthService"]);
    expect(res.searchedSymbols).toEqual(["AuthService"]);
    expect(res.paths).toEqual(["src/*.ts"]);
  });

  it("parses Select-String with dotted symbols", () => {
    const res = parseSearchCommand(`Select-String -Pattern "AuthService.refreshToken" -Path "packages/**/*.ts"`);
    expect(res.tool).toBe("select-string");
    expect(res.patterns).toEqual(["AuthService.refreshToken"]);
    expect(res.searchedSymbols).toEqual(["AuthService.refreshToken"]);
    expect(res.paths).toEqual(["packages/**/*.ts"]);
  });

  it("distinguishes regular expression patterns from code symbols", () => {
    const res = parseSearchCommand(`rg "AuthService|TokenService" src`);
    expect(res.tool).toBe("rg");
    expect(res.patterns).toEqual(["AuthService|TokenService"]);
    expect(res.searchedSymbols).toEqual([]); // Not a valid identifier
  });

  it("rejects non-identifier regex from symbols", () => {
    const res = parseSearchCommand(`grep "auth.*" src`);
    expect(res.patterns).toEqual(["auth.*"]);
    expect(res.searchedSymbols).toEqual([]);
  });

  it("rejects whitespace regex from symbols", () => {
    const res = parseSearchCommand(`rg "foo\\s+bar" src`);
    expect(res.patterns).toEqual(["foo\\s+bar"]);
    expect(res.searchedSymbols).toEqual([]);
  });
});
