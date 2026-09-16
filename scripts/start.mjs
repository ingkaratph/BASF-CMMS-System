import "dotenv/config";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const useWindowsFrontend = process.platform === "win32" && Number(process.env.PORT || 80) === 80;
if (useWindowsFrontend) {
  // Reuse our running frontend rather than creating a conflicting HTTP.sys listener.
  try {
    const response = await fetch("http://localhost/api/session", { signal: AbortSignal.timeout(1500) });
    const session = await response.json();
    if (response.ok && typeof session.configured === "boolean" && typeof session.loginRequired === "boolean") {
      console.log("CMMS is already running at http://localhost");
      process.exit(0);
    }
  } catch { /* Start the frontend below. */ }
}
const child = useWindowsFrontend
  ? spawn(process.env.CMMS_PWSH_PATH || "pwsh.exe", ["-NoProfile", "-File", fileURLToPath(new URL("./start-windows-http.ps1", import.meta.url))], { cwd: root, stdio: "inherit", windowsHide: true })
  : spawn(process.execPath, ["scripts/production.mjs", "--production"], { cwd: root, stdio: "inherit", windowsHide: true });
child.on("error", error => {
  console.error(useWindowsFrontend ? "Cannot start PowerShell 7. Set CMMS_PWSH_PATH to pwsh.exe, then run npm start again." : error.message);
  process.exitCode = 1;
});
child.on("exit", code => { process.exitCode = code ?? 1; });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
