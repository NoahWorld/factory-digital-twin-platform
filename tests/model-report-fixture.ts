import { spawnSync } from "node:child_process";
import { writeFileSync,unlinkSync } from "node:fs";
import { isAbsolute,join } from "node:path";

/** Only mutates the freshly-created model in the isolated integration database. */
export function removeModelReportFields(projectId: string, model: { id: string; inspection: Record<string,unknown> }, keys: string[]) {
  const state = process.env.NEWPOWER_TEST_STATE_DIR,config = process.env.NEWPOWER_TEST_CONFIG;
  if (!state || !config || !isAbsolute(state) || !isAbsolute(config) || !state.includes("/test/") || !config.includes("/test/")) throw new Error("Legacy report fixtures require the isolated local test database.");
  const old = Object.fromEntries(Object.entries(model.inspection).filter(([key]) => !keys.includes(key)));
  const quote = (value: string) => `'${value.replaceAll("'","''")}'`;
  const file = join(state,`legacy-model-report-${crypto.randomUUID()}.sql`);
  writeFileSync(file,`UPDATE model_assets SET inspection_json=${quote(JSON.stringify(old))} WHERE project_id=${quote(projectId)} AND id=${quote(model.id)};`,{ mode: 0o600 });
  try {
    const result = spawnSync("pnpm",["--filter","@factory-twin/api","exec","wrangler","d1","execute","factory-digital-twin-config","--local","--persist-to",state,"--config",config,"--file",file],{ encoding: "utf8",timeout: 30000 });
    if (result.status !== 0) throw new Error("Isolated legacy report fixture failed.");
  } finally { unlinkSync(file); }
}
