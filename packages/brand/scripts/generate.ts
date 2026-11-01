/**
 * Generates every icon and image from the logo master, so the brand stays consistent:
 *
 *   bun --cwd packages/brand generate
 *
 * Outputs (committed):
 *   packages/brand/public/   favicon.svg, favicon.ico (16/32/48), apple-touch-icon.png, icon-192/512.png,
 *                            maskable-512.png, og-image.png (1200×630 social preview)
 *   apps/web-guest/public/icons/  the PWA install icons its manifest references
 */
import { mkdir } from "node:fs/promises";
import sharp from "sharp";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const out = `${root}public`;
const guestIcons = `${root}../../apps/web-guest/public/icons`;

const INK_TOP = "#2a2825";
const INK_BOTTOM = "#151413";
const PAPER = "#f4efe7";

const defs = `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${INK_TOP}"/><stop offset="1" stop-color="${INK_BOTTOM}"/>
    </linearGradient>
    <radialGradient id="dot" cx="0.38" cy="0.32" r="0.75">
      <stop offset="0" stop-color="#e2c79c"/><stop offset="1" stop-color="#b8925e"/>
    </radialGradient>
  </defs>`;

/**
 * The mark on a 512 canvas. `bold` thickens the frame and enlarges the dot so it still reads at 16px.
 * `bleed` fills the whole square (iOS and Android masks round the corners themselves).
 * `scale` shrinks the symbol towards the centre (maskable icons keep content inside the safe zone).
 */
function mark({ bold = false, bleed = false, scale = 1 } = {}) {
  const frame = bold ? { inset: 118, rx: 60, stroke: 46 } : { inset: 134, rx: 68, stroke: 30 };
  const r = bold ? 74 : 58;
  const size = 512 - frame.inset * 2;
  const symbol = `
    <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
      <rect x="${frame.inset}" y="${frame.inset}" width="${size}" height="${size}" rx="${frame.rx}"
            fill="none" stroke="${PAPER}" stroke-width="${frame.stroke}"/>
      <circle cx="256" cy="256" r="${r}" fill="url(#dot)"/>
    </g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${defs}
    <rect width="512" height="512" ${bleed ? "" : 'rx="116"'} fill="url(#bg)"/>${symbol}</svg>`;
}

const png = (svg: string, size: number) => sharp(Buffer.from(svg), { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();

/** ICO container holding PNG images (supported by every browser and Windows since Vista). */
function ico(images: { size: number; data: Buffer }[]) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, i) => {
    const e = 6 + i * 16;
    header.writeUInt8(size >= 256 ? 0 : size, e);
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt8(0, e + 2); // palette
    header.writeUInt8(0, e + 3); // reserved
    header.writeUInt16LE(1, e + 4); // colour planes
    header.writeUInt16LE(32, e + 6); // bits per pixel
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map((i) => i.data)]);
}

/** 1200×630 link preview (WhatsApp, iMessage, Facebook, Slack…). */
function ogImage() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    ${defs}
    <defs>
      <radialGradient id="glow" cx="0.82" cy="0.18" r="0.7">
        <stop offset="0" stop-color="#c8a97e" stop-opacity="0.28"/><stop offset="1" stop-color="#c8a97e" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="1200" height="630" fill="#f7f5f1"/>
    <rect width="1200" height="630" fill="url(#glow)"/>
    <g transform="translate(96 96) scale(0.25)">${mark().replace(/<\/?svg[^>]*>/g, "")}</g>
    <text x="244" y="176" font-family="Georgia, 'Times New Roman', serif" font-size="46" fill="#1b1a18">SnapShare</text>
    <text x="96" y="352" font-family="Georgia, 'Times New Roman', serif" font-size="84" fill="#1b1a18">Every guest's photos.</text>
    <text x="96" y="452" font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-size="84" fill="#9a7647">One live album.</text>
    <text x="96" y="540" font-family="Segoe UI, Arial, sans-serif" font-size="30" fill="#6f6962">Guests scan a QR code and shoot — photos appear live on the big screen.</text>
  </svg>`;
}

await mkdir(out, { recursive: true });
await mkdir(guestIcons, { recursive: true });

const write = async (path: string, data: string | Buffer) => {
  await Bun.write(path, data);
  console.log(`  ${path.replace(`${root}../../`, "").replace(root, "packages/brand/")} (${(Buffer.byteLength(data) / 1024).toFixed(1)} KB)`);
};

const regular = mark();
const small = mark({ bold: true });
const fullBleed = mark({ bleed: true });
const maskable = mark({ bleed: true, scale: 0.78 });

const icon192 = await png(regular, 192);
const icon512 = await png(regular, 512);
const apple = await png(fullBleed, 180);
const mask512 = await png(maskable, 512);

console.log("Generating brand assets:");
await write(`${out}/favicon.svg`, small);
await write(
  `${out}/favicon.ico`,
  ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(small, size) })))),
);
await write(`${out}/apple-touch-icon.png`, apple);
await write(`${out}/icon-192.png`, icon192);
await write(`${out}/icon-512.png`, icon512);
await write(`${out}/maskable-512.png`, mask512);
await write(`${out}/og-image.png`, await sharp(Buffer.from(ogImage())).png({ compressionLevel: 9 }).toBuffer());

// The guest PWA's manifest references these by fixed path.
await write(`${guestIcons}/icon-192.png`, icon192);
await write(`${guestIcons}/icon-512.png`, icon512);
await write(`${guestIcons}/maskable-512.png`, mask512);
await write(`${guestIcons}/apple-touch-icon.png`, apple);

// Self-hosted fonts, served at /brand/fonts/* (see public/fonts.css). Copied from @fontsource so they're
// versioned with the repo and never fetched from a third party.
const fontSources: Record<string, string> = {
  "inter-latin.woff2": "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
  "inter-latin-ext.woff2": "@fontsource-variable/inter/files/inter-latin-ext-wght-normal.woff2",
  "instrument-serif-latin.woff2": "@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2",
  "instrument-serif-latin-ext.woff2": "@fontsource/instrument-serif/files/instrument-serif-latin-ext-400-normal.woff2",
  "instrument-serif-latin-italic.woff2": "@fontsource/instrument-serif/files/instrument-serif-latin-400-italic.woff2",
};
await mkdir(`${out}/fonts`, { recursive: true });
for (const [name, spec] of Object.entries(fontSources)) {
  await write(`${out}/fonts/${name}`, Buffer.from(await Bun.file(Bun.resolveSync(spec, root)).arrayBuffer()));
}
