// Source fingerprint of the delivered tree: SHA-256 over the sorted list of (relative path, SHA-256 of content) of every tracked-or-untracked, non-ignored file under the app folder.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
const raiz = process.argv[2];
const lista = execFileSync("git", ["ls-files", "-z", "-c", "-o", "--exclude-standard", "--", ...(process.argv.slice(3).length ? process.argv.slice(3) : ["."])], { cwd: raiz, encoding: "utf8", maxBuffer: 1 << 28 }).split("\0").filter(Boolean).sort();
const h = createHash("sha256");
let n = 0;
for (const f of lista) { if (!existsSync(`${raiz}/${f}`)) continue; h.update(`${f}\0${createHash("sha256").update(readFileSync(`${raiz}/${f}`)).digest("hex")}\n`); n++; }
console.log(JSON.stringify({ archivos: n, sha256: h.digest("hex") }));
