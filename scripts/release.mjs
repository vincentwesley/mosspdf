// Zip the existing dist/ build: node scripts/release.mjs (run `npm run build` first).
import { crc32, deflateRawSync } from "node:zlib";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

if (!existsSync("dist/index.html")) { console.error("dist/ is missing or empty. Run `npm run build` first."); process.exit(1); }
const { version } = JSON.parse(readFileSync("package.json", "utf8"));

const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
const entries = [
  ...walk("dist").map((f) => [relative("dist", f).split("\\").join("/"), f]),
  ["serve.mjs", "scripts/serve.mjs"], ["README.txt", "scripts/release-readme.txt"],
  ["LICENSE", "LICENSE"], ["NOTICE.md", "NOTICE.md"], ["THIRD_PARTY_NOTICES.md", "THIRD_PARTY_NOTICES.md"], ["fonts-OFL.txt", "src/fonts/OFL.txt"],
].map(([name, src]) => [`mosspdf/${name}`, readFileSync(src)]);

// Minimal zip writer: deflate every entry, fixed timestamp so builds are reproducible.
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
const parts = [], central = [];
let offset = 0;
for (const [name, data] of entries) {
  const nm = Buffer.from(name), z = deflateRawSync(data, { level: 9 }), crc = crc32(data);
  const common = [u16(20), u16(0x0800), u16(8), u16(0), u16(DATE), u32(crc), u32(z.length), u32(data.length), u16(nm.length), u16(0)];
  const local = Buffer.concat([u32(0x04034b50), ...common, nm, z]);
  central.push(Buffer.concat([u32(0x02014b50), u16(20), ...common, u16(0), u16(0), u16(0), u32(0), u32(offset), nm]));
  parts.push(local); offset += local.length;
}
const cd = Buffer.concat(central);
const eocd = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(cd.length), u32(offset), u16(0)]);
mkdirSync("release", { recursive: true });
const out = `release/mosspdf-v${version}.zip`;
writeFileSync(out, Buffer.concat([...parts, cd, eocd]));
console.log(`${out}: ${entries.length} files, ${(statSync(out).size / 1048576).toFixed(1)} MB`);
