// Test bundle: the keep-alive's tick together with the api and the diagnostic
// log it writes to, from ONE module graph.
export * from "../src/modules/keepAlive";
export { isSessionLost, getAccessToken } from "../src/core/api";
export { diagDump } from "../src/core/diag";
