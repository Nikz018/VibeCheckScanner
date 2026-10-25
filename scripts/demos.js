const { spawn } = require("node:child_process");
const path = require("node:path");

const targets = [
  ["demo-targets/open-backend/server.js", "4010"],
  ["demo-targets/paywall/server.js", "4011"],
  ["demo-targets/leaky-basics/server.js", "4012"],
  ["demo-targets/logged-in/server.js", "4013"],
];

const children = targets.map(([script, port]) =>
  spawn(process.execPath, [path.join(process.cwd(), script)], {
    env: { ...process.env, PORT: port },
    stdio: "inherit",
  }),
);

function stop() {
  for (const child of children) child.kill();
  process.exit(0);
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
