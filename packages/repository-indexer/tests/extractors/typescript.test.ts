import { describe, it, expect } from "vitest";
import { TypeScriptExtractor } from "../../src/extractors/typescript.js";

describe("TypeScriptExtractor", () => {
  it("extracts functions", () => {
    const extractor = new TypeScriptExtractor();
    const content = `
      export function sayHello() {
        console.log("hello");
      }
    `;
    const symbols = extractor.extract("test.ts", content);
    
    expect(symbols).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "sayHello",
        kind: "function",
        startLine: 2,
        endLine: 4,
      })
    ]));
  });

  it("extracts classes and methods", () => {
    const extractor = new TypeScriptExtractor();
    const content = `
      class User {
        constructor(public name: string) {}
        
        greet() {
          return "Hi " + this.name;
        }
      }
    `;
    const symbols = extractor.extract("test.ts", content);
    
    expect(symbols).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "User",
        kind: "class",
        startLine: 2,
        endLine: 8,
      }),
      expect.objectContaining({
        name: "User.greet",
        kind: "method",
        startLine: 5,
        endLine: 7,
      })
    ]));
  });

  it("extracts interfaces and type aliases", () => {
    const extractor = new TypeScriptExtractor();
    const content = `
      export interface Person {
        name: string;
      }
      export type ID = string | number;
    `;
    const symbols = extractor.extract("test.ts", content);
    
    expect(symbols).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "Person",
        kind: "interface",
      }),
      expect.objectContaining({
        name: "ID",
        kind: "type",
      })
    ]));
  });

  it("extracts imports and exports", () => {
    const extractor = new TypeScriptExtractor();
    const content = `
      import { resolve } from "node:path";
      import ts from "typescript";
      export const foo = "bar";
    `;
    const symbols = extractor.extract("test.ts", content);
    
    expect(symbols).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "import { resolve }",
        kind: "import",
      }),
      expect.objectContaining({
        name: "import ts",
        kind: "import",
      }),
      expect.objectContaining({
        name: "foo",
        kind: "constant",
      })
    ]));
  });

  it("extracts test declarations", () => {
    const extractor = new TypeScriptExtractor();
    const content = `
      describe("something", () => {
        it("should work", () => {
          expect(true).toBe(true);
        });
      });
    `;
    const symbols = extractor.extract("test.ts", content);
    
    expect(symbols).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "something",
        kind: "test",
      }),
      expect.objectContaining({
        name: "should work",
        kind: "test",
      })
    ]));
  });
});
