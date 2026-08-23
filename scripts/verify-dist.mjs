import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";

const distDirectory = new URL("../dist/", import.meta.url);
const basePath = "/moviepicker/";

if (!existsSync(distDirectory)) throw new Error("dist/ does not exist. Run Vite before verifying the artifact.");

const files = readdirSync(distDirectory, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => join(entry.parentPath, entry.name));
const textFiles = files.filter((file) => [".html", ".js", ".css"].includes(extname(file)));
const references = new Set();

for (const file of textFiles) {
  const contents = readFileSync(file, "utf8");
  for (const match of contents.matchAll(/(?:src|href)=["']([^"']+)["']|url\(["']?([^"')]+)|["'`](\/moviepicker\/assets\/[^"'`?#)]+)/g)) {
    const reference = match[1] || match[2] || match[3];
    if (reference?.startsWith(basePath)) references.add(reference.split(/[?#]/)[0]);
  }
  if (contents.includes("./assets/avatar-") || contents.includes("./assets/hero-journal")) {
    throw new Error(`Unbundled source asset path remains in ${file}.`);
  }
}

if (!references.size) throw new Error("The build contains no repository-local asset references.");

for (const reference of references) {
  const relativePath = reference.slice(basePath.length);
  if (!existsSync(new URL(relativePath, distDirectory))) {
    throw new Error(`Built reference has no matching file: ${reference}`);
  }
}

const emittedImages = files.filter((file) => /\.(?:png|jpe?g|webp|svg)$/i.test(file));
if (emittedImages.length < 6) {
  throw new Error(`Expected at least six emitted application images, found ${emittedImages.length}.`);
}

console.log(`Verified ${references.size} local references and ${emittedImages.length} emitted images in dist/.`);
