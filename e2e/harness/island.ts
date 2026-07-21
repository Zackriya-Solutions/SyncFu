// Dev harness for the ported shape generators. Renders each D3 shape state as a
// static, settled SVG island so the Playwright visual harness can screenshot it
// straight from the real modules (no reconstructed markup). Vite compiles this
// TS on the fly; see playwright.config.ts webServer.
import { notchPath, capsulePath, floatWallRadius, RADII } from "@/lib/notchPath";

const NS = "http://www.w3.org/2000/svg";
const COMPACT_FILL = "rgba(0,0,0,0.94)";
const EXPANDED_FILL = "rgba(13,13,15,0.94)";

interface Shape {
  readonly id: string;
  readonly w: number;
  readonly h: number;
  readonly d: string;
  readonly fill: string;
}

const SHAPES: readonly Shape[] = [
  {
    id: "notch-compact",
    w: 218,
    h: 34,
    d: notchPath({ W: 218, H: 34, t: RADII.compactTop, b: RADII.compactBottom }),
    fill: COMPACT_FILL,
  },
  {
    id: "notch-expanded",
    w: 380,
    h: 120,
    d: notchPath({ W: 380, H: 120, t: RADII.expandedTop, b: RADII.expandedBottom }),
    fill: EXPANDED_FILL,
  },
  {
    // Over-radius input proves the clamp: t/b collapse to min(W/4,H/4|H/2).
    id: "notch-clamped",
    w: 40,
    h: 40,
    d: notchPath({ W: 40, H: 40, t: 100, b: 100 }),
    fill: COMPACT_FILL,
  },
  {
    id: "float-compact",
    w: 200,
    h: 34,
    d: capsulePath(200, 34, floatWallRadius(34, false)),
    fill: COMPACT_FILL,
  },
  {
    id: "float-expanded",
    w: 380,
    h: 120,
    d: capsulePath(380, 120, floatWallRadius(120, true)),
    fill: EXPANDED_FILL,
  },
];

const root = document.getElementById("root")!;
for (const s of SHAPES) {
  const cell = document.createElement("div");
  cell.className = "cell";
  cell.id = s.id;

  const island = document.createElement("div");
  island.className = "island";
  island.style.width = `${s.w}px`;
  island.style.height = `${s.h}px`;

  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "shape");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("viewBox", `0 0 ${s.w} ${s.h}`);

  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", s.d);
  path.setAttribute("fill", s.fill);
  svg.appendChild(path);

  island.appendChild(svg);
  cell.appendChild(island);
  root.appendChild(cell);
}
