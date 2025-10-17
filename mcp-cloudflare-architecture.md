# 🧩 MCP Server + Cloudflare 部署架构总结（含编译脚本）

## 🎯 目标
构建一个 **可在 Cloudflare Workers 部署的 MCP Server**：

- Widgets 构建为独立 fragment，并生成 JSON 元数据；
- `createMCPServer()` 为 **框架无关的核心逻辑**；
- `src/index.ts` 为 **框架集成层**（Cloudflare Worker entry）；
- 部署时不依赖运行期文件系统；
- ✅ 本文档新增：**完整编译脚本与 package.json 脚本**。

---

## 🗂️ 项目结构

```
repo/
├─ widgets/                       # React widgets 源码与构建产物
│  ├─ user-table/
│  │  ├─ src/index.tsx
│  │  ├─ widget.config.json
│  │  └─ dist/user-table-<hash>.fragment.html
│  └─ ...
│
├─ tooling/
│  ├─ build.ts                    # ✅ esbuild：多入口 → fragment + manifest
│  └─ embed-widgets.ts            # ✅ 生成 server/src/widgets.gen.json
│
├─ server/
│  ├─ src/
│  │  ├─ index.ts                 # ✅ Cloudflare Worker 集成层（含全局单例）
│  │  ├─ mcp/
│  │  │  └─ index.ts              # ✅ 框架无关核心：createMCPServer()
│  │  ├─ tools/
│  │  │  └─ users.ts              # 示例 Tool
│  │  ├─ widgets.gen.json         # ✅ CI 自动生成：widgets 元数据
│  │  └─ types.ts
│  ├─ package.json
│  └─ tsconfig.json
│
└─ wrangler.toml                  # Cloudflare 配置
```

---

## ⚙️ 构建流程（CI 顺序）

1. **构建 Widgets**  
   ```bash
   pnpm build:widgets
   ```
   每个组件输出：
   - `widgets/<name>/dist/<name>-<hash>.js`
   - `widgets/<name>/dist/<name>-<hash>.css`（如有）
   - `widgets/<name>/dist/<name>-<hash>.fragment.html`（内联 `<style>` + `<script type="module">`）
   - `widgets/<name>/dist/manifest.json`（name/hash/文件名）

2. **生成 JSON 元数据**  
   ```bash
   pnpm build:embed
   ```
   → 生成 `server/src/widgets.gen.json`，包含 `uri/fragment/csp/desc/...`。

3. **构建 Server**
   ```bash
   pnpm --filter ./server build
   ```

4. **部署到 Cloudflare**
   ```bash
   pnpm --filter ./server deploy
   ```

---

## 📦 根 package.json（脚本）

```json
{
  "name": "mcp-cloudflare",
  "private": true,
  "workspaces": [
    "server"
  ],
  "scripts": {
    "build:widgets": "tsx tooling/build.ts",
    "build:embed": "tsx tooling/embed-widgets.ts",
    "build": "pnpm build:widgets && pnpm build:embed && pnpm --filter ./server build",
    "deploy": "pnpm --filter ./server deploy",
    "clean": "rimraf widgets/**/dist server/dist server/src/widgets.gen.json"
  },
  "devDependencies": {
    "esbuild": "^0.24.0",
    "fast-glob": "^3.3.2",
    "rimraf": "^6.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.3"
  }
}
```

---

## 🛠️ 编译脚本 1：tooling/build.ts（esbuild → fragment + manifest）

```ts
import { build } from "esbuild";
import fg from "fast-glob";
import fs from "fs";
import path from "path";
import crypto from "crypto";

function shortHash(s: string, n = 6) {
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, n);
}

const entries = fg.sync("widgets/*/src/index.{tsx,jsx}", { absolute: true });
if (!entries.length) {
  console.log("No widget entries found.");
  process.exit(0);
}

async function buildOne(entryAbs: string) {
  const widgetDir = entryAbs.split(path.sep + "src" + path.sep)[0];
  const name = path.basename(widgetDir);
  const outdir = path.join(widgetDir, "dist");

  const res = await build({
    entryPoints: [entryAbs],
    outdir,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["es2022"],
    splitting: false,
    minify: true,
    sourcemap: false,
    write: false,
    loader: { ".css": "css" }
  });

  let jsText = "", cssText = "";
  for (const f of res.outputFiles) {
    if (f.path.endsWith(".js")) jsText = f.text;
    if (f.path.endsWith(".css")) cssText = f.text;
  }
  const h = shortHash(jsText + "::" + cssText);

  fs.mkdirSync(outdir, { recursive: true });
  fs.writeFileSync(path.join(outdir, `${name}-${h}.js`), jsText);
  if (cssText) fs.writeFileSync(path.join(outdir, `${name}-${h}.css`), cssText);

  const fragment = [
    `<div id="${name}-root"></div>`,
    cssText ? `<style>
${cssText}
</style>` : "",
    `<script type="module">
${jsText}
</script>`
  ].filter(Boolean).join("\n");

  const fragFile = `${name}-${h}.fragment.html`;
  fs.writeFileSync(path.join(outdir, fragFile), fragment, "utf8");

  const manifest = {
    name,
    hash: h,
    js: `${name}-${h}.js`,
    css: cssText ? `${name}-${h}.css` : null,
    fragment: fragFile
  };
  fs.writeFileSync(path.join(outdir, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`✔ ${name} -> ${fragFile}`);
}

(async () => {
  for (const e of entries) await buildOne(e);
})();
```

---

## 🛠️ 编译脚本 2：tooling/embed-widgets.ts（生成 widgets.gen.json）

```ts
import fs from "fs";
import path from "path";
import fg from "fast-glob";

type Conf = {
  name: string;
  description?: string;
  csp: { resource_domains: string[]; connect_domains: string[] };
};

const confFiles = fg.sync("widgets/*/widget.config.json", { absolute: true });
const out: Record<string, any> = {};

for (const confPath of confFiles) {
  const conf: Conf = JSON.parse(fs.readFileSync(confPath, "utf8"));
  const widgetDir = path.dirname(confPath);
  const distDir = path.join(widgetDir, "dist");
  const manifestPath = path.join(distDir, "manifest.json");

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing manifest: ${manifestPath}. Run 'pnpm build:widgets' first.`);
  }

  const man = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const fragment = fs.readFileSync(path.join(distDir, man.fragment), "utf8");
  const key = `${man.name}-${man.hash}`;
  const uri = `ui://widget/${man.name}-${man.hash}.html`;

  out[key] = {
    uri,
    fragment,
    csp: conf.csp,
    desc: conf.description ?? ""
  };
}

fs.mkdirSync("server/src", { recursive: true });
fs.writeFileSync("server/src/widgets.gen.json", JSON.stringify(out, null, 2), "utf8");
console.log("✔ server/src/widgets.gen.json generated");
```

---

## 🧠 createMCPServer()

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import widgetsData from "../widgets.gen.json" assert { type: "json" };
import type { WidgetDef } from "../types.js";
import { registerUsersTool } from "../tools/users.js";

export async function createMCPServer(): Promise<McpServer> {
  const server = new McpServer({ name: "my-mcp", version: "1.0.0" });
  const widgets: Record<string, WidgetDef> = widgetsData as any;

  for (const [key, def] of Object.entries(widgets)) {
    server.registerResource(`widget:${key}`, def.uri, {}, async () => ({
      contents: [{
        uri: def.uri,
        mimeType: "text/html+skybridge",
        text: def.fragment,
        _meta: {
          "openai/widgetCSP": def.csp,
          ...(def.desc && { "openai/widgetDescription": def.desc })
        }
      }]
    }));
  }

  const userTableKey = Object.keys(widgets).find(k => k.startsWith("user-table-"));
  if (!userTableKey) throw new Error("user-table widget missing");

  registerUsersTool(server, {
    outputTemplateUri: widgets[userTableKey].uri,
    widgetAccessible: true
  });

  return server;
}
```

---

## ☁️ Cloudflare Worker（集成层）

```ts
import { createMCPServer } from "./mcp/index.js";

declare global {
  var __MCP_SERVER__: any | undefined;
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") return new Response("ok");

    if (url.pathname === "/mcp" && request.method === "POST") {
      const server =
        globalThis.__MCP_SERVER__ ??
        (globalThis.__MCP_SERVER__ = await createMCPServer());

      // TODO: 实现 JSON-RPC 转发逻辑
      return new Response(
        JSON.stringify({ error: "Transport not implemented." }),
        { status: 501, headers: { "content-type": "application/json" } }
      );
    }

    return new Response("Not found", { status: 404 });
  }
};
```

---

## 📦 server/package.json / tsconfig.json / wrangler.toml

**server/package.json**
```json
{
  "name": "mcp-worker",
  "type": "module",
  "scripts": {
    "build": "tsc -p .",
    "deploy": "wrangler publish"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "typescript": "^5.6.3"
  }
}
```

**server/tsconfig.json**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "resolveJsonModule": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true
  },
  "include": ["src"]
}
```

**wrangler.toml**
```toml
name = "my-mcp-worker"
main = "server/dist/index.js"
compatibility_date = "2025-01-01"
```

---

## 🧱 widgets 示例

**widgets/user-table/src/index.tsx**
```tsx
export default function UserTableWidget() {
  const rows = (window as any).openai?.toolOutput?.rows ?? [];
  return (
    <div className="p-4 text-sm">
      <h2 className="font-semibold mb-2">User Table</h2>
      <table className="border-collapse border border-gray-300 w-full">
        <thead>
          <tr>
            <th className="border border-gray-300 px-2">ID</th>
            <th className="border border-gray-300 px-2">Name</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r: any) => (
            <tr key={r.id}>
              <td className="border border-gray-300 px-2">{r.id}</td>
              <td className="border border-gray-300 px-2">{r.name}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

**widgets/user-table/widget.config.json**
```json
{
  "name": "user-table",
  "description": "User list display widget",
  "csp": {
    "resource_domains": [],
    "connect_domains": []
  }
}
```

---

## ✅ 总结

- widgets 构建 → fragment.html + manifest.json  
- 生成 JSON → `server/src/widgets.gen.json`  
- `createMCPServer()` 注册 widgets + tools  
- Cloudflare Worker 管理全局单例  
- 所有产物在构建时确定，无运行时 I/O
