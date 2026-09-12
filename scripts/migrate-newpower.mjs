import { fileURLToPath } from "node:url";
import { migrateWithBackup } from "./migration-backup.mjs";

migrateWithBackup({ stateDirectory: process.env.NEWPOWER_TEST_STATE_DIR, configPath: process.env.NEWPOWER_TEST_CONFIG, projectDirectory: fileURLToPath(new URL("..", import.meta.url)) })
  .then((verifiedBackup) => console.log(JSON.stringify({ event: "local_migration_completed", verifiedBackup })))
  .catch((error) => { console.error(error.message); process.exitCode = 1; });
