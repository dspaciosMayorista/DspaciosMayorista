// Runs `node <args>` with stdout+stderr appended to a log file (the PowerShell launcher cannot stream a long-running child).
import { spawn } from "node:child_process";
import { openSync } from "node:fs";
const [log, ...args] = process.argv.slice(2);
const fd = openSync(log, "w");
const p = spawn(process.execPath, args, { stdio: ["ignore", fd, fd], env: process.env });
p.on("exit", (c) => process.exit(c ?? 0));
