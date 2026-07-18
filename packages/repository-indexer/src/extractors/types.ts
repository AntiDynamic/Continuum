import type { ExtractedContextCandidate } from "@continuum/shared";

export type ExtractedSymbol = ExtractedContextCandidate;

export interface Extractor {
  /** 
   * Extract symbols from the source code of a file.
   * @param absolutePath The absolute path to the file.
   * @param content The string content of the file.
   */
  extract(absolutePath: string, content: string): ExtractedSymbol[] | Promise<ExtractedSymbol[]>;
}
