import fs from "node:fs";
import path from "node:path";
import fg from "fast-glob";

const manifests = fg.sync("widgets/*/dist/manifest.json", { absolute: true });

if (!manifests.length) {
  console.error("No widget manifests found. Did you run pnpm build:widgets?");
  process.exit(1);
}

const widgets = manifests.map((manifestPath) => {
  const distDir = path.dirname(manifestPath);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const configPath = path.join(path.dirname(distDir), "widget.config.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const fragmentPath = path.join(distDir, manifest.fragment);
  const fragment = fs.readFileSync(fragmentPath, "utf8");
  return {
    name: config.name ?? manifest.name ?? path.basename(path.dirname(distDir)),
    description: config.description ?? "",
    csp: config.csp ?? { resource_domains: [], connect_domains: [] },
    fragment,
  };
});

const output = {
  generatedAt: new Date().toISOString(),
  widgets,
};

const targetPath = path.join("server", "src", "widgets.gen.json");
fs.writeFileSync(targetPath, JSON.stringify(output, null, 2));
console.log(`Wrote ${widgets.length} widget definitions to ${targetPath}`);
