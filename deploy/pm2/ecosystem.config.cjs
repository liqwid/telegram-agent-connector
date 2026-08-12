// pm2 ecosystem for the Telegram Agent Connector backend.
//
// SINGLE INSTANCE, FORK MODE — never cluster: in-flight Telegram QR logins
// (gramjs clients, password deferreds) live in process memory, and a second
// worker would answer polls for logins it cannot see. Scaling this service
// means a bigger box, not more instances.
//
// The service env lives in /etc/tac/backend.env (written by the deploy
// workflow, mode 640 root:tac). pm2 has no EnvironmentFile= equivalent, so
// this config parses the file itself at (re)load time;
// `pm2 startOrReload … --update-env` re-reads it on every deploy.
const { readFileSync } = require("node:fs");

const ENV_FILE = "/etc/tac/backend.env";

const parseEnvLine = (vars, line) => {
  const separatorIndex = line.indexOf("=");
  return separatorIndex === -1
    ? vars
    : {
        ...vars,
        [line.slice(0, separatorIndex)]: line.slice(separatorIndex + 1),
      };
};

const parseEnvFile = (path) =>
  readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .reduce(parseEnvLine, {});

module.exports = {
  apps: [
    {
      name: "tac-backend",
      script: "/opt/tac/backend/build/index.js",
      // cwd matters: the bundle resolves its two native runtime deps
      // (bufferutil, utf-8-validate) from /opt/tac/backend/node_modules.
      cwd: "/opt/tac/backend",
      exec_mode: "fork",
      instances: 1,
      env: parseEnvFile(ENV_FILE),
      max_memory_restart: "512M",
      kill_timeout: 8000,
    },
  ],
};
