// Test bundle: the watcher together with the core it uses, from ONE module
// graph, so the storage and gate state the test sets is the state it reads.
export * from "../src/modules/courseWatch";
export * as core from "../src/core/api";
export * as storage from "../src/core/storage";
export * as user from "../src/core/user";
