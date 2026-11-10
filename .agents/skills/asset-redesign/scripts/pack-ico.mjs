#!/usr/bin/env node
// Packs PNG files into one .ico (PNG-compressed entries, supported by every current browser and
// Windows Vista onwards), so favicon.ico is built from the rendered PNGs instead of a separate tool.
// Usage: node .agents/skills/asset-redesign/scripts/pack-ico.mjs <out.ico> <16.png> <32.png> [48.png ...]
import { readFileSync, writeFileSync } from "node:fs";
import { ToolError, runMain } from "./lib.mjs";

runMain("pack-ico", () => {
  const [out, ...inputs] = process.argv.slice(2);
  if (!out || !out.endsWith(".ico") || !inputs.length) {
    throw new ToolError("usage: pack-ico.mjs <out.ico> <png> [png ...]");
  }
  const images = inputs.map((file) => {
    const data = readFileSync(file);
    if (data.length < 24 || data.toString("ascii", 1, 4) !== "PNG") throw new ToolError(`${file} is not a PNG`);
    const w = data.readUInt32BE(16);
    const h = data.readUInt32BE(20);
    if (w !== h || w > 256) throw new ToolError(`${file} is ${w}x${h}; ICO entries must be square and at most 256 px`);
    return { file, data, size: w };
  });
  const sizes = images.map((i) => i.size);
  if (new Set(sizes).size !== sizes.length) throw new ToolError(`duplicate sizes: ${sizes.join(", ")}`);

  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach((img, i) => {
    const at = 6 + 16 * i;
    header.writeUInt8(img.size === 256 ? 0 : img.size, at);
    header.writeUInt8(img.size === 256 ? 0 : img.size, at + 1);
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(img.data.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += img.data.length;
  });
  writeFileSync(out, Buffer.concat([header, ...images.map((i) => i.data)]));
  console.log(`packed ${images.map((i) => `${i.size}px`).join(", ")} -> ${out}`);
  return 0;
});
