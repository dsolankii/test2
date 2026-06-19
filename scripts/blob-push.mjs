import { DATA_DIR, dataPath } from "./data-dir.mjs";
process.argv[2] = "push";
await import("./blob-sync.mjs");
