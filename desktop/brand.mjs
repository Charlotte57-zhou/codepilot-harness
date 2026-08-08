import { fileURLToPath } from "node:url";

export const APP_BRAND = Object.freeze({
  name: "CodePilot",
  appUserModelId: "com.codepilot.desktop",
  windowIconPath: fileURLToPath(new URL("./assets/codepilot.ico", import.meta.url)),
  canonicalMarkPath: fileURLToPath(new URL("../public/assets/codepilot-mark.png", import.meta.url))
});
