import { describe, it, expect } from "vitest";
import { MarkdownExtractor } from "../../src/extractors/markdown.js";
describe("MarkdownExtractor", () => {
    it("extracts sections based on headings", () => {
        const extractor = new MarkdownExtractor();
        const content = `
# Title

Some text here.

## Subtitle

More text.
    `;
        const symbols = extractor.extract("test.md", content.trim());
        expect(symbols).toEqual(expect.arrayContaining([
            expect.objectContaining({
                name: "Title",
                kind: "heading",
            }),
            expect.objectContaining({
                name: "Subtitle",
                kind: "heading",
            })
        ]));
    });
});
//# sourceMappingURL=markdown.test.js.map