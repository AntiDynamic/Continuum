export interface ExtractedSymbol {
  /** Local symbol name, e.g., 'resolveSnapshotIdentity' */
  name: string;
  /** What kind of symbol this is, e.g., 'function', 'class', 'interface', 'import' */
  kind: string;
  /** Source code snippet containing this symbol */
  content: string;
  /** 1-based start line */
  startLine: number;
  /** 1-based end line */
  endLine: number;
}

export interface Extractor {
  /** 
   * Extract symbols from the source code of a file.
   * @param absolutePath The absolute path to the file.
   * @param content The string content of the file.
   */
  extract(absolutePath: string, content: string): ExtractedSymbol[] | Promise<ExtractedSymbol[]>;
}
