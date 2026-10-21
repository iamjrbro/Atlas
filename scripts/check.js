import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
async function files(dir) {
  const result = [];
  for (const f of await readdir(dir, { withFileTypes: true })) {
    if (f.isDirectory()) result.push(...(await files(dir + "/" + f.name)));
    else if (/\.(mjs|js)$/.test(f.name)) result.push(dir + "/" + f.name);
  }
  return result;
}
for (const file of [
  ...(await files("src")),
  ...(await files("public")),
  ...(await files("scripts")),
  ...(await files("test")),
]) {
  const r = spawnSync(process.execPath, ["--check", file], {
    stdio: "inherit",
  });
  if (r.status !== 0) process.exit(r.status || 1);
}
console.log("Sintaxe verificada.");
