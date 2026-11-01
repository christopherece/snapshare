/**
 * The SnapShare mark (viewfinder + gold shutter) as SVG markup, so apps can inline it — crisp at any size,
 * no request. Framework-free on purpose: each app wraps it in its own tiny component.
 */
let n = 0;

/** SVG markup for the mark. Gradient ids are unique per call so several marks can share a page. */
export function logoMarkSvg(size = 28): string {
  const id = `ss${++n}`;
  return `<svg width="${size}" height="${size}" viewBox="0 0 512 512" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="${id}-bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a2825"/><stop offset="1" stop-color="#151413"/></linearGradient>
    <radialGradient id="${id}-dot" cx="0.38" cy="0.32" r="0.75"><stop offset="0" stop-color="#e2c79c"/><stop offset="1" stop-color="#b8925e"/></radialGradient>
  </defs>
  <rect width="512" height="512" rx="116" fill="url(#${id}-bg)"/>
  <rect x="126" y="126" width="260" height="260" rx="64" fill="none" stroke="#f4efe7" stroke-width="38"/>
  <circle cx="256" cy="256" r="66" fill="url(#${id}-dot)"/>
</svg>`;
}
