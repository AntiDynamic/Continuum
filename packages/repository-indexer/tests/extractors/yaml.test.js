import { describe, it, expect } from "vitest";
import { YamlExtractor } from "../../src/extractors/yaml.js";
describe("YamlExtractor", () => {
    it("extracts top-level keys", () => {
        const extractor = new YamlExtractor();
        const content = `
name: continuum
version: 1.0.0
dependencies:
  yaml: ^2.0.0
    `;
        const symbols = extractor.extract("test.yaml", content.trim());
        expect(symbols).toEqual(expect.arrayContaining([
            expect.objectContaining({
                name: "name",
                kind: "yaml_key",
            }),
            expect.objectContaining({
                name: "dependencies",
                kind: "yaml_key",
            })
        ]));
    });
});
//# sourceMappingURL=yaml.test.js.map