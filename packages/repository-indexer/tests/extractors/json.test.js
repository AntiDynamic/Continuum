import { describe, it, expect } from "vitest";
import { JsonExtractor } from "../../src/extractors/json.js";
describe("JsonExtractor", () => {
    it("extracts top-level keys", () => {
        const extractor = new JsonExtractor();
        const content = `
{
  "name": "continuum",
  "version": "1.0.0",
  "dependencies": {
    "yaml": "^2.0.0"
  }
}
    `;
        const symbols = extractor.extract("test.json", content.trim());
        expect(symbols).toEqual(expect.arrayContaining([
            expect.objectContaining({
                name: "name",
                kind: "json_key",
            }),
            expect.objectContaining({
                name: "dependencies",
                kind: "json_key",
            })
        ]));
    });
});
//# sourceMappingURL=json.test.js.map