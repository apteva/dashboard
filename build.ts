import { $ } from "bun";
import { rmSync, mkdirSync } from "fs";

// Step 0: Clean old builds
rmSync("./dist", { recursive: true, force: true });
mkdirSync("./dist", { recursive: true });

// Step 1: Build Tailwind CSS
console.log("Building CSS...");
await $`bunx @tailwindcss/cli -i ./src/index.css -o ./dist/style.css --minify`.quiet();

// Step 2: Bundle JS/TSX
console.log("Building JS...");
const result = await Bun.build({
  entrypoints: ["./src/main.tsx"],
  outdir: "./dist",
  target: "browser",
  minify: true,
  sourcemap: "linked",
  naming: {
    entry: "[name]-[hash].[ext]",
    chunk: "[name]-[hash].[ext]",
    asset: "[name]-[hash].[ext]",
  },
});

if (!result.success) {
  console.error("Build failed:");
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

// Step 3: Generate index.html with hashed paths
const jsOutput = result.outputs.find((o) => o.path.endsWith(".js"));
const jsFile = jsOutput ? jsOutput.path.split("/").pop() : "main.js";

const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Apteva</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link rel="preload" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=block" as="style" />
    <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=block" rel="stylesheet" />
    <link rel="stylesheet" href="/style.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/${jsFile}"></script>
  </body>
</html>`;

await Bun.write("./dist/index.html", html);

console.log("\nBuild complete:");
for (const output of result.outputs) {
  const size = (output.size / 1024).toFixed(1);
  console.log(`  ${output.path.split("/").pop()} (${size} KB)`);
}
console.log("  style.css");
console.log("  index.html");
