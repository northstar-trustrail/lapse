import { build } from "esbuild";
import { cpSync, mkdirSync } from "node:fs";
mkdirSync("web/dist", { recursive: true });
await build({ entryPoints: ["web/app.js"], bundle: true, format: "esm", minify: true, outfile: "web/dist/app.js", target: "es2022" });
cpSync("web/index.html", "web/dist/index.html");
cpSync("web/public", "web/dist", { recursive: true });
console.log("built web/dist");
