const fs = require('fs');
const path = 'packages/gemini-adapter/src/parser.ts';
let code = fs.readFileSync(path, 'utf8');

if (!code.includes('redactValue')) {
  code = code.replace(
    /import \{ redactString \} from "@continuum\/shared";/,
    'import { redactString, redactValue } from "@continuum/shared";'
  );
}

// Redact tool call input
code = code.replace(
  /input: \(data\.input as Record<string, unknown>\) \?\? \{\},/g,
  'input: ctx.captureRaw ? redactValue(data.input ?? {}, ctx.redactPatterns).value as Record<string, unknown> : undefined,'
);

// Redact tool result output
code = code.replace(
  /output: data\.output,/g,
  'output: ctx.captureRaw && data.output ? redactValue(data.output, ctx.redactPatterns).value as string : undefined,'
);

// Make text optional
code = code.replace(
  /text: data\.content,/g,
  'text: ctx.captureRaw ? data.content : undefined,'
);

fs.writeFileSync(path, code);
