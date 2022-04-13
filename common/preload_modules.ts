// These are the node modules that will be pre-bundled with SB
// as a result they will not be included into plugos bundles and assumed to be loadable
// via require() in the sandbox
// Candidate modules for this are larger modules

// When adding a module to this list, also manually add it to sandbox_worker.ts
export const preloadModules = ["@lezer/lr", "yaml"];
