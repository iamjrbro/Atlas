import { loadConfig } from "../src/config.js";
import { database } from "../src/db.js";
import { ensureTenant } from "../src/store.js";
import { z } from "zod";
const args = process.argv.slice(2),
  id = z.uuid().parse(args[args.indexOf("--id") + 1]),
  name = z
    .string()
    .min(1)
    .max(100)
    .parse(args[args.indexOf("--name") + 1]);
if (!args.includes("--id") || !args.includes("--name"))
  throw new Error("Use --id TENANT_UUID --name Nome");
const pool = await database(loadConfig());
try {
  await ensureTenant(pool, id, name);
  console.log("Tenant cadastrado: " + id);
} finally {
  await pool.end();
}
