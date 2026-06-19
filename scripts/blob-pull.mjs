import { DATA_DIR, dataPath } from "./data-dir.mjs";
process.argv[2] = "pull";
await import("./blob-sync.mjs");
