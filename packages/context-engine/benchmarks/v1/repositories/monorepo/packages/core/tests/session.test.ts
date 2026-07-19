import { createSession } from "../src/session";
export function createSessionContractTest(): boolean { return createSession("u1").userId === "u1"; }
