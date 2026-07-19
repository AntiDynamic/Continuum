import { updateUser } from "../src/routes";
export async function updateUserContractTest(): Promise<boolean> { return (await updateUser("u1")).id === "u1"; }
