import { loadConfig } from "./config.js";
import { database, migrate } from "./db.js";
const pool = await database(loadConfig());
try {
  await migrate(pool);
  console.log("Schema Atlas atualizado.");
} finally {
  await pool.end();
}
