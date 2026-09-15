import fs from "node:fs";
import { randomBytes } from "node:crypto";

// Preserve existing credentials and configure the current LAN login requirement.
const path = new URL("../.env", import.meta.url);
let content = fs.readFileSync(path, "utf8");
if (!/^CMMS_APP_PASSWORD=.{16,}$/m.test(content)) {
  const entry = "CMMS_APP_PASSWORD=" + randomBytes(24).toString("base64url");
  content = /^CMMS_APP_PASSWORD=.*$/m.test(content)
    ? content.replace(/^CMMS_APP_PASSWORD=.*$/m, entry)
    : content + "\n" + entry + "\n";
  fs.writeFileSync(path, content);
}
console.log("LAN login configured in .env. No credentials printed.");
