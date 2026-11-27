// Memory guard helper (local build only): make Node report 3 CPUs so `next build` spawns ~2 page-data workers instead of 15. Loaded via NODE_OPTIONS=--require, so child workers inherit it.
const os = require("node:os");
const real = os.cpus();
os.cpus = () => real.slice(0, 3);
if (os.availableParallelism) os.availableParallelism = () => 3;
