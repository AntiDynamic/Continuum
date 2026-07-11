/**
 * Readline helper that creates a line-by-line async iterable from a Node
 * Readable stream without importing the full readline module.
 */

import { createInterface } from "node:readline";
import type { Readable } from "node:stream";

export function createReadlineInterface(stream: Readable): AsyncIterable<string> {
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  return rl;
}
