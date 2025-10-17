import { build } from "esbuild";
import fg from "fast-glob";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

function shortHash(contents: string, length = 8) {
  return crypto.createHash("sha256").update(contents).digest("hex").slice(0, length);
}

const entries = fg.sync("widgets/*/src/index.{tsx,jsx}", { absolute: true });

if (!entries.length) {
  console.log("No widget entries found.");
  process.exit(0);
}

async function buildOne(entryAbs: string) {
  const widgetDir = path.dirname(path.dirname(entryAbs));
  const widgetName = path.basename(widgetDir);
  const distDir = path.join(widgetDir, "dist");
  fs.mkdirSync(distDir, { recursive: true });

  const result = await build({
    entryPoints: [entryAbs],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["es2018"],
    write: false,
    jsx: "automatic",
    minify: true,
    sourcemap: false,
    logLevel: "silent"
  });

  const jsOutput = result.outputFiles[0];
  if (!jsOutput) {
    throw new Error(`No JavaScript output for ${widgetName}`);
  }

  const hash = shortHash(jsOutput.text);
  const jsFilename = `${widgetName}-${hash}.js`;
  const fragmentFilename = `${widgetName}-${hash}.fragment.html`;

  const jsPath = path.join(distDir, jsFilename);
  fs.writeFileSync(jsPath, jsOutput.text, "utf8");

  const fragmentHtml = `<!DOCTYPE html>\n<div id="${widgetName}-root"></div>\n<script type="module">${jsOutput.text}</script>\n`;
  const fragmentPath = path.join(distDir, fragmentFilename);
  fs.writeFileSync(fragmentPath, fragmentHtml, "utf8");

  const manifest = {
    name: widgetName,
    script: jsFilename,
    fragment: fragmentFilename,
    hash,
  };
  const manifestPath = path.join(distDir, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  console.log(`Built widget ${widgetName}`);
}

async function main() {
  for (const entry of entries) {
    await buildOne(entry);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
