// Test bundle: api and gate from ONE module graph, so the tests exercise the
// gate instance the api actually uses (separate bundles would each inline
// their own copy and the gate assertions would pass vacuously).
export * from "../src/core/api";
export * as gate from "../src/core/gate";
