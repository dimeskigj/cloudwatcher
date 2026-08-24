import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const source = await readFile(new URL("../public/icon-source.svg", import.meta.url));

for (const size of [16, 32, 48, 96, 128]) {
  const output = fileURLToPath(new URL(`../public/icon-${size}.png`, import.meta.url));
  await sharp(source).resize(size, size).png().toFile(output);
}
