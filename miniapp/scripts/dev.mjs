import { spawn } from "node:child_process";

const processes = [
  spawn("npm", ["run", "dev:bff"], { stdio: "inherit", env: process.env }),
  spawn("npm", ["run", "dev:web"], { stdio: "inherit", env: process.env })
];

let stopping = false;
for (const child of processes) {
  child.on("exit", (code, signal) => {
    if (stopping) return;
    stopping = true;
    for (const other of processes) {
      if (other !== child) other.kill("SIGTERM");
    }
    if (code !== 0 || signal) {
      process.exitCode = 1;
    }
  });
}
