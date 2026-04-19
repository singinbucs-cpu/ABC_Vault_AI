import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const outputDir = path.join(projectRoot, "mobile-web");

const staticFiles = ["index.html", "app.js", "styles.css"];

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

await Promise.all(
  staticFiles.map((fileName) =>
    cp(path.join(projectRoot, fileName), path.join(outputDir, fileName)),
  ),
);

console.log(`Prepared mobile web assets in ${outputDir}`);
