import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const envPath = new URL("../.env.local", import.meta.url);
let key = "";

try {
  const contents = readFileSync(envPath, "utf8");
  const match = contents.match(/^CALLMISSED_API_KEY=(.+)$/m);
  if (match) key = match[1].trim();
} catch {
  console.error("verify-secret-leak: could not read .env.local");
  process.exit(1);
}

if (!key) {
  console.error("verify-secret-leak: CALLMISSED_API_KEY missing from .env.local");
  process.exit(1);
}

const scanRoots = [
  { dir: join(process.cwd(), ".next", "static"), label: "client bundle" },
  { dir: join(process.cwd(), ".next", "server", "app"), label: "server app chunks" },
];

const hits = [];

function walk(dir, label) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      walk(path, label);
      continue;
    }
    if (!/\.(js|css|html|json|txt|rsc)$/.test(entry)) continue;
    const contents = readFileSync(path, "utf8");
    if (contents.includes(key)) hits.push({ path, label });
  }
}

for (const root of scanRoots) {
  try {
    walk(root.dir, root.label);
  } catch (err) {
    console.error(`verify-secret-leak: unable to scan ${root.dir}: ${err.message}`);
    process.exit(1);
  }
}

const clientHits = hits.filter((hit) => hit.label === "client bundle");

if (clientHits.length > 0) {
  console.error("verify-secret-leak: SECRET EXPOSED TO CLIENT BUNDLES:");
  for (const hit of clientHits) console.error(`  - ${hit.path}`);
  process.exit(1);
}

if (hits.length > 0) {
  console.error("verify-secret-leak: key literal found in server chunks (should be runtime env):");
  for (const hit of hits) console.error(`  - ${hit.path}`);
  process.exit(1);
}

console.log("verify-secret-leak: OK - API key absent from all build output.");
