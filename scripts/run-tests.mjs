import { readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const directory=fileURLToPath(new URL(".",import.meta.url));
const files=(await readdir(directory)).filter(name=>name.endsWith(".test.mjs")).sort().map(name=>directory+name);
try {execFileSync(process.execPath,["--test",...files],{stdio:"inherit"});}
catch(error){process.exitCode=typeof error.status==="number"?error.status:1;}
