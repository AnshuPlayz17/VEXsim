/**
 * Builds the files in reference/ (field spec + original SVG diagrams) from the
 * simulator's own field data, so the docs, the drawings and the game can't drift
 * apart. Run `npm run reference` to regenerate; `npm test` fails if they're stale.
 */
import { OVERRIDE_FIELD as F, startingLayout } from '../games/override/game';
import { OVERRIDE } from '../games/override/rules';

const IN = 0.0254;
const r1 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const inch = (m: number) => r1(m / IN);

const COLOR = { red: '#c8291e', blue: '#1f45c7', yellow: '#ecbd19' } as const;

export function fieldSpec() {
  const layout = startingLayout();
  const pt = (x: number, z: number) => ({ x_in: inch(x), z_in: inch(z), x_m: r3(x), z_m: r3(z) });
  return {
    game: 'VEX V5 Robotics Competition 2026–27: Override',
    note: 'Facts the simulator uses. Each entry says where it comes from; "assumption" marks values the sim had to choose. Check the official game manual for rulings.',
    coordinates: {
      origin: 'center of the field',
      x: 'toward the blue Alliance Station wall (East); red stands on the West wall',
      z: 'toward the South wall (top-down diagrams put North at the top)',
      units: 'inches (x_in, z_in) and meters (x_m, z_m)',
    },
    field: {
      size_in: 144,
      tiles: '36 foam tiles, 6 × 6, each 24 in square',
      tape: ['two corner-to-corner diagonals splitting the field into four Quadrants (N, E, S, W)', 'Midfield: a 48 in diamond (|x| + |z| ≤ 24 in) with a center cross'],
      perimeterHeight_in: { value: inch(F.wallHeight), source: 'assumption (sim value)' },
      source: 'game manual summary; VEXcode VR Override playground layout',
    },
    counts: {
      pins: { total: 63, redYellow: OVERRIDE.pinCounts.redYellow, blueYellow: OVERRIDE.pinCounts.blueYellow, yellowYellow: OVERRIDE.pinCounts.yellowYellow, redBlue: OVERRIDE.pinCounts.redBlue },
      cups: 56,
      goals: { total: 9, tall: 1, shortNeutral: 4, allianceRed: 2, allianceBlue: 2 },
      toggles: 4,
      loaders: 4,
      source: 'game manual',
    },
    goals: F.goals.map((g) => ({
      id: g.id,
      kind: g.kind,
      alliance: g.alliance ?? null,
      quadrant: g.quadrant,
      ...pt(g.x, g.z),
      height_in: inch(F.goalHeight[g.kind]),
      shape: 'octagonal, tapered',
      baseAcrossFlats_in: inch(F.goal.flats),
      topAcrossFlats_in: inch(F.goal.topFlats),
      baseHeight_in: inch(F.goal.baseHeight[g.kind]),
      color: g.kind === 'alliance' ? g.alliance : 'black',
      source: 'official field layout (VEXcode VR) and element dimensions',
    })),
    toggles: F.toggles.map((t) => ({
      quadrant: t.q,
      ...pt(t.x, t.z),
      length_in: inch(F.toggleLength),
      faces: ['yellow (neutral)', 'red', 'blue'],
      rule: 'counts for an alliance only when set to its color and no Robot is touching it',
      source: 'game manual; official field layout',
    })),
    loaders: F.loaders.map((l) => ({ alliance: l.alliance, ...pt(l.x, l.z), source: 'official field layout (one beside each Alliance Station)' })),
    elements: {
      pin: {
        length_in: inch(F.pin.length),
        collarAcrossCorners_in: inch(F.pin.radius * 2),
        acrossFlats_in: 3.02,
        tipAcross_in: inch(F.pin.tipRadius * 2),
        tipLength_in: inch(F.pin.tipLength),
        taperEndFromTip_in: inch(F.pin.taperEnd),
        shape: 'symmetric, hexagonal: each half is a tip, a taper and a center collar; either end nests into a Goal or Cup',
        source: 'game manual element drawings',
      },
      cup: {
        height_in: inch(F.cup.height),
        topAcross_in: inch(F.cup.topRadius * 2),
        waistAcross_in: inch(F.cup.waistRadius * 2),
        shape: 'straight-tapered hourglass, waist at mid-height; lower half clear, upper half opaque',
        source: 'game manual element drawings; SC3',
      },
      goal: {
        footprint: `chamfered square, ${inch(F.goal.flats)} in across the flats, ${inch(F.goal.corner)} in center to corner`,
        module: `every Goal is topped by the same ${inch(F.goal.module)} in tapered module: ${inch(F.goal.flange)} in flange, tapering to ${inch(F.goal.topFlats)} in across, ${inch(F.goal.hole)} in hole, code marker 1.49 in up`,
        bases: { tall_in: inch(F.goal.baseHeight.tall), short_in: inch(F.goal.baseHeight.short), alliance_in: 0 },
        colors: 'neutral Goals black with yellow line art; Alliance Goals red or blue',
        source: 'game manual element drawings',
      },
      stacking: {
        pinInGoal: `the Pin’s ${inch(F.pin.tipLength)} in tip drops into the Goal hole`,
        cupOnPin: 'a Cup’s clear lower half slides over the Pin and rests on its center collar',
        pinInCup: 'the next Pin’s tip sits at the Cup’s waist, inside its opaque upper half (that half is hidden, SC3)',
        source: 'derived from the manual element drawings',
      },
    },
    matchLoads: {
      match: { perAlliance: '10 Cups + 10 alliance-color Pins + 1 yellow/yellow Pin', source: 'game manual summary; order of release is an assumption' },
      skills: { redYellowPins: 3, blueYellowPins: 4, cups: 7, note: 'begin off the field as Match Loads', source: 'game manual (Skills), as quoted' },
    },
    preloads: { perRobot: '1 alliance-color Pin', source: 'VEXcode VR playground; game manual summary' },
    robotStartTiles: (['red', 'blue'] as const).flatMap((a) => F.startPoses(a).map((p) => ({ alliance: a, label: p.label, ...pt(p.x, p.z), source: 'assumption' }))),
    startingLayout: {
      note: 'Elements marked "official" are the 20 in the VEXcode VR layout. "filled" elements complete the full field count symmetrically and are an assumption until checked against the manual.',
      pins: layout.pins.map((p) => ({ ...pt(p.x, p.z), colors: p.colors, source: p.source })),
      cups: layout.cups.map((c) => ({ ...pt(c.x, c.z), source: c.source })),
      tallGoal: { pin: ['yellow', 'yellow'], source: 'assumption' },
    },
  };
}

// --------------------------------------------------------------- SVG helpers
const svgOpen = (w: number, h: number, title: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="Arial, Helvetica, sans-serif">\n<title>${title}</title>\n<rect width="${w}" height="${h}" fill="#ffffff"/>\n`;
const octagon = (cx: number, cy: number, r: number) =>
  Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    return `${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`;
  }).join(' ');

/** Top-down starting layout. North at the top, red (West) on the left. */
export function layoutSvg(): string {
  const S = 5; // px per inch
  const M = 60;
  const W = 144 * S + M * 2;
  const H = 144 * S + M * 2 + 90;
  const X = (m: number) => M + (m / IN + 72) * S;
  const Y = (m: number) => M + (m / IN + 72) * S;
  const layout = startingLayout();
  let s = svgOpen(W, H, 'Override starting layout (VEXsim)');
  // Tiles and tape.
  s += `<rect x="${M}" y="${M}" width="${144 * S}" height="${144 * S}" fill="#8d9097" stroke="#333" stroke-width="3"/>\n`;
  for (let i = 1; i < 6; i++) {
    s += `<line x1="${M + i * 24 * S}" y1="${M}" x2="${M + i * 24 * S}" y2="${M + 144 * S}" stroke="#7a7d84" stroke-width="1.5"/>\n`;
    s += `<line x1="${M}" y1="${M + i * 24 * S}" x2="${M + 144 * S}" y2="${M + i * 24 * S}" stroke="#7a7d84" stroke-width="1.5"/>\n`;
  }
  const tape = `stroke="#ffffff" stroke-width="${2 * S}" stroke-linecap="butt" fill="none"`;
  s += `<line x1="${M}" y1="${M}" x2="${M + 144 * S}" y2="${M + 144 * S}" ${tape} opacity="0.9"/>\n`;
  s += `<line x1="${M + 144 * S}" y1="${M}" x2="${M}" y2="${M + 144 * S}" ${tape} opacity="0.9"/>\n`;
  const c = M + 72 * S;
  const d = 24 * S;
  s += `<polygon points="${c - d},${c} ${c},${c - d} ${c + d},${c} ${c},${c + d}" ${tape}/>\n`;
  s += `<line x1="${c - d}" y1="${c}" x2="${c + d}" y2="${c}" ${tape}/><line x1="${c}" y1="${c - d}" x2="${c}" y2="${c + d}" ${tape}/>\n`;
  // Alliance stations.
  s += `<rect x="${M - 22}" y="${M}" width="14" height="${144 * S}" fill="${COLOR.red}"/><rect x="${M + 144 * S + 8}" y="${M}" width="14" height="${144 * S}" fill="${COLOR.blue}"/>\n`;
  s += `<text x="${M - 30}" y="${c}" font-size="16" fill="${COLOR.red}" text-anchor="middle" transform="rotate(-90 ${M - 30} ${c})">RED ALLIANCE STATION</text>\n`;
  s += `<text x="${M + 144 * S + 32}" y="${c}" font-size="16" fill="${COLOR.blue}" text-anchor="middle" transform="rotate(90 ${M + 144 * S + 32} ${c})">BLUE ALLIANCE STATION</text>\n`;
  s += `<text x="${c}" y="${M - 18}" font-size="16" text-anchor="middle" fill="#333">N</text>\n`;
  // Robot start tiles.
  for (const a of ['red', 'blue'] as const) {
    for (const p of F.startPoses(a)) {
      s += `<rect x="${X(p.x) - 9 * S}" y="${Y(p.z) - 9 * S}" width="${18 * S}" height="${18 * S}" fill="none" stroke="${COLOR[a]}" stroke-width="2" stroke-dasharray="8 5"/>\n`;
    }
  }
  // Loaders and Toggles.
  for (const l of F.loaders) {
    const lx = Math.sign(l.x) * (F.half - 0.13);
    s += `<rect x="${X(lx) - 0.13 / IN * S}" y="${Y(l.z) - 0.12 / IN * S}" width="${(0.26 / IN) * S}" height="${(0.24 / IN) * S}" fill="#9aa0a8" stroke="${COLOR[l.alliance]}" stroke-width="3"/>\n`;
    s += `<circle cx="${X(lx)}" cy="${Y(l.z)}" r="${(0.075 / IN) * S}" fill="#222"/>\n`;
  }
  for (const t of F.toggles) {
    const len = (F.toggleLength / IN) * S;
    const w = 10;
    s += t.alongX
      ? `<rect x="${X(t.x) - len / 2}" y="${Y(t.z) - w / 2}" width="${len}" height="${w}" fill="${COLOR.yellow}" stroke="#333"/>\n`
      : `<rect x="${X(t.x) - w / 2}" y="${Y(t.z) - len / 2}" width="${w}" height="${len}" fill="${COLOR.yellow}" stroke="#333"/>\n`;
  }
  // Goals.
  for (const g of F.goals) {
    const fill = g.kind === 'alliance' ? COLOR[g.alliance!] : '#dcdcdc';
    s += `<polygon points="${octagon(X(g.x), Y(g.z), (F.goalRadiusBottom / IN) * S)}" fill="${fill}" stroke="#222" stroke-width="2"/>\n`;
    s += `<circle cx="${X(g.x)}" cy="${Y(g.z)}" r="${(0.03 / IN) * S}" fill="#151515"/>\n`;
  }
  // Pins (split circle: tapered half / flat half) and Cups.
  const pinR = (F.pin.radius / IN) * S;
  for (const p of layout.pins) {
    const x = X(p.x);
    const y = Y(p.z);
    const dash = p.source === 'filled' ? ' stroke-dasharray="3 2"' : '';
    s += `<path d="M ${x - pinR} ${y} A ${pinR} ${pinR} 0 0 1 ${x + pinR} ${y} Z" fill="${COLOR[p.colors[0]]}"/>`;
    s += `<path d="M ${x - pinR} ${y} A ${pinR} ${pinR} 0 0 0 ${x + pinR} ${y} Z" fill="${COLOR[p.colors[1]]}"/>`;
    s += `<circle cx="${x}" cy="${y}" r="${pinR}" fill="none" stroke="#111" stroke-width="1.5"${dash}/>\n`;
  }
  const cupR = (0.04 / IN) * S;
  for (const cp of layout.cups) {
    const dash = cp.source === 'filled' ? ' stroke-dasharray="3 2"' : '';
    s += `<circle cx="${X(cp.x)}" cy="${Y(cp.z)}" r="${cupR}" fill="#e6eef7" stroke="#55606c" stroke-width="2"${dash}/><circle cx="${X(cp.x)}" cy="${Y(cp.z)}" r="${cupR * 0.55}" fill="#b8b8bd"/>\n`;
  }
  // Legend.
  const ly = M + 144 * S + 40;
  s += `<g font-size="14" fill="#222">
  <polygon points="${octagon(M + 10, ly, 9)}" fill="#dcdcdc" stroke="#222"/><text x="${M + 26}" y="${ly + 5}">Goal (neutral / alliance)</text>
  <circle cx="${M + 230}" cy="${ly}" r="9" fill="${COLOR.red}" stroke="#111"/><text x="${M + 246}" y="${ly + 5}">Pin</text>
  <circle cx="${M + 300}" cy="${ly}" r="9" fill="#e6eef7" stroke="#55606c" stroke-width="2"/><text x="${M + 316}" y="${ly + 5}">Cup</text>
  <rect x="${M + 370}" y="${ly - 5}" width="30" height="10" fill="${COLOR.yellow}" stroke="#333"/><text x="${M + 408}" y="${ly + 5}">Toggle</text>
  <rect x="${M + 480}" y="${ly - 9}" width="20" height="18" fill="#9aa0a8"/><text x="${M + 508}" y="${ly + 5}">Loader</text>
  <rect x="${M + 580}" y="${ly - 9}" width="18" height="18" fill="none" stroke="#333" stroke-dasharray="5 3"/><text x="${M + 606}" y="${ly + 5}">Start tile</text>
  <text x="${M}" y="${ly + 32}" fill="#555">Solid outline = official VEXcode VR position · dashed outline = filled in by VEXsim (assumption).</text>
  <text x="${M}" y="${ly + 52}" fill="#555">Original drawing by VEXsim from its field data; not an official VEX drawing.</text>
</g>\n`;
  return s + '</svg>\n';
}

/** Side views of the game elements with dimensions. */
export function elementsSvg(): string {
  const S = 40; // px per inch
  let s = svgOpen(1400, 520, 'Override game elements (VEXsim)');
  s += `<g font-size="15" fill="#222">`;
  const base = 430;
  const dim = (x1: number, y1: number, x2: number, y2: number, label: string, side = 1) => {
    s += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#666" stroke-width="1.2" marker-start="url(#a)" marker-end="url(#a)"/>`;
    s += `<text x="${(x1 + x2) / 2 + side * 8}" y="${(y1 + y2) / 2}" fill="#444" font-size="13">${label}</text>`;
  };
  s += `<defs><marker id="a" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#666"/></marker></defs>`;

  // Pin: symmetric. Lower half red, upper half blue (each half: tip, taper, collar).
  const pl = F.pin.length / IN;
  const pw = (F.pin.radius * 2) / IN;
  const pt = (F.pin.tipRadius * 2) / IN;
  const ptl = F.pin.tipLength / IN;
  const pte = F.pin.taperEnd / IN;
  const px = 120;
  const halfPts = (dir: number) => {
    const y = (v: number) => base - (dir > 0 ? v : pl - v) * S;
    return [[-pt / 2, 0], [-pt / 2, ptl], [-pw / 2 * 0.95, pte], [-pw / 2, pte + 0.04], [-pw / 2, pl / 2], [pw / 2, pl / 2], [pw / 2, pte + 0.04], [pw / 2 * 0.95, pte], [pt / 2, ptl], [pt / 2, 0]]
      .map(([x, v]) => `${px + x * S},${y(v)}`).join(' ');
  };
  s += `<polygon points="${halfPts(1)}" fill="${COLOR.red}" stroke="#111"/><polygon points="${halfPts(-1)}" fill="${COLOR.blue}" stroke="#111"/>`;
  dim(px + (pw / 2) * S + 20, base, px + (pw / 2) * S + 20, base - pl * S, `${r1(pl)}″`);
  dim(px - (pw / 2) * S, base + 22, px + (pw / 2) * S, base + 22, `${r1(pw)}″`, -1);
  s += `<text x="${px}" y="${base - pl * S - 18}" text-anchor="middle" font-weight="bold">Pin</text>`;
  s += `<text x="${px}" y="${base + 52}" text-anchor="middle" font-size="12">symmetric · ${r1(pt)}″ tips · either end nests</text>`;

  // Cup: straight tapers; clear lower half, opaque upper half; waist at mid-height.
  const ch = F.cup.height / IN;
  const ct = (F.cup.topRadius * 2) / IN;
  const cw = (F.cup.waistRadius * 2) / IN;
  const cx = 400;
  s += `<polygon points="${cx - (ct / 2) * 0.98 * S},${base} ${cx + (ct / 2) * 0.98 * S},${base} ${cx + (cw / 2) * S},${base - (ch / 2) * S} ${cx - (cw / 2) * S},${base - (ch / 2) * S}" fill="#dceaff" fill-opacity="0.6" stroke="#55606c"/>`;
  s += `<polygon points="${cx - (cw / 2) * S},${base - (ch / 2) * S} ${cx + (cw / 2) * S},${base - (ch / 2) * S} ${cx + (ct / 2) * S},${base - ch * S} ${cx - (ct / 2) * S},${base - ch * S}" fill="#2f3237" stroke="#55606c"/>`;
  dim(cx + (ct / 2) * S + 16, base, cx + (ct / 2) * S + 16, base - ch * S, `${r1(ch)}″`);
  s += `<text x="${cx}" y="${base - ch * S - 18}" text-anchor="middle" font-weight="bold">Cup</text>`;
  s += `<text x="${cx}" y="${base + 30}" text-anchor="middle" font-size="12">${r1(ct)}″ top · ${r1(cw)}″ waist · clear lower / opaque upper</text>`;

  // Goals: base (neutral) + the shared tapered module.
  const kinds: ['tall' | 'short' | 'alliance', string, string][] = [['tall', 'Tall Goal', '#18191b'], ['short', 'Short Goal', '#18191b'], ['alliance', 'Alliance Goal', COLOR.red]];
  kinds.forEach(([k, label, fill], i) => {
    const gx = 690 + i * 250;
    const h = F.goalHeight[k] / IN;
    const bh = F.goal.baseHeight[k] / IN;
    const fw = F.goal.flats / IN / 2;
    const tw = F.goal.topFlats / IN / 2;
    const fl = F.goal.flange / IN;
    if (bh > 0) s += `<rect x="${gx - fw * S}" y="${base - bh * S}" width="${fw * 2 * S}" height="${bh * S}" fill="${fill}" stroke="#222"/><circle cx="${gx}" cy="${base - bh * 0.45 * S}" r="${Math.min(bh * 0.3, 1.2) * S}" fill="none" stroke="#e8c21b" stroke-width="3"/>`;
    s += `<rect x="${gx - fw * S}" y="${base - (bh + fl) * S}" width="${fw * 2 * S}" height="${fl * S}" fill="${fill}" stroke="#222"/>`;
    s += `<polygon points="${gx - fw * 0.873 * S},${base - (bh + fl) * S} ${gx + fw * 0.873 * S},${base - (bh + fl) * S} ${gx + tw * S},${base - h * S} ${gx - tw * S},${base - h * S}" fill="${fill}" stroke="#222"/>`;
    s += `<rect x="${gx - 0.58 * S}" y="${base - (bh + 1.49 + 0.58) * S}" width="${1.16 * S}" height="${1.16 * S}" fill="#fff" stroke="#000" stroke-width="6"/>`;
    dim(gx + fw * S + 12, base, gx + fw * S + 12, base - h * S, `${r1(h)}″`);
    s += `<text x="${gx}" y="${base - h * S - 18}" text-anchor="middle" font-weight="bold">${label}</text>`;
  });
  s += `<text x="700" y="${base + 30}" font-size="12">chamfered square, ${r1(F.goal.flats / IN)}″ across the flats; all share the ${r1(F.goal.module / IN)}″ tapered top module</text>`;
  s += `<line x1="40" y1="${base}" x2="1360" y2="${base}" stroke="#999"/>`;
  s += `<text x="40" y="505" font-size="12" fill="#666">Side views, drawn to scale (${S} px = 1″). Original drawing by VEXsim from its field data; not an official VEX drawing.</text>`;
  return s + '</g></svg>\n';
}

/** Toggle cross-section and top view. */
export function toggleSvg(): string {
  let s = svgOpen(860, 300, 'Override Toggle (VEXsim)');
  const cx = 140;
  const cy = 150;
  const r = 70;
  const tri = [0, 1, 2].map((i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 3 + Math.PI;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  });
  const face = (a: number[], b: number[], color: string) => `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${color}" stroke-width="12" stroke-linecap="round"/>`;
  s += face(tri[1], tri[2], COLOR.yellow) + face(tri[0], tri[1], COLOR.red) + face(tri[2], tri[0], COLOR.blue);
  s += `<circle cx="${cx}" cy="${cy}" r="8" fill="#222"/>`;
  s += `<g font-family="Arial" font-size="14" fill="#222"><text x="${cx}" y="40" text-anchor="middle" font-weight="bold">Cross-section</text>`;
  s += `<text x="${cx}" y="270" text-anchor="middle" font-size="12">three faces: yellow (neutral), red, blue</text>`;
  const len = (F.toggleLength / IN) * 18;
  // (300 + 464 + mounts fits the 860 px width)
  s += `<rect x="300" y="135" width="${len}" height="30" fill="${COLOR.yellow}" stroke="#222"/>`;
  s += `<rect x="290" y="120" width="10" height="60" fill="#9aa3ad"/><rect x="${300 + len}" y="120" width="10" height="60" fill="#9aa3ad"/>`;
  s += `<text x="${300 + len / 2}" y="40" text-anchor="middle" font-weight="bold">Top view (mounted at the center of a field wall)</text>`;
  s += `<text x="${300 + len / 2}" y="210" text-anchor="middle">${r1(F.toggleLength / IN)}″ long, turns on a shaft along its length</text>`;
  s += `<text x="${300 + len / 2}" y="270" text-anchor="middle" font-size="12">Counts for an alliance only when showing its color with no Robot touching it.</text></g>`;
  return s + '</svg>\n';
}

export function fieldSpecMarkdown(): string {
  const spec = fieldSpec();
  const rows = (head: string[], data: (string | number | null)[][]) =>
    `| ${head.join(' | ')} |\n| ${head.map(() => '---').join(' | ')} |\n${data.map((r) => `| ${r.map((v) => (v === null ? '—' : String(v))).join(' | ')} |`).join('\n')}\n`;
  let md = `# Override field spec (VEXsim)\n\n> Generated from the simulator's field data by \`npm run reference\`. Don't edit by hand. Each value names its source; **assumption** marks values VEXsim had to choose. The official game manual always wins.\n\n`;
  md += `![Starting layout](diagrams/starting-layout.svg)\n\n`;
  md += `## Coordinates\nOrigin at the field center. **+x** points toward the blue Alliance Station (East wall); red stands on the West wall. **+z** points toward the South wall. Diagrams put North at the top. Values are in inches, with meters in \`field-spec.json\`.\n\n`;
  md += `## Field\n- 12 ft × 12 ft, made of 36 foam tiles (6 × 6, 24″ each)\n- Tape: two corner-to-corner diagonals make the four Quadrants (N, E, S, W); the Midfield is a 48″ diamond with a center cross\n- Counts: 63 Pins (20 red/yellow, 20 blue/yellow, 19 yellow/yellow, 4 red/blue), 56 Cups, 9 Goals, 4 Toggles, 4 Loaders *(game manual)*\n\n`;
  md += `## Goals\n` + rows(['Goal', 'Kind', 'Quadrant', 'x″', 'z″', 'Height″'], spec.goals.map((g) => [g.id, g.kind + (g.alliance ? ` (${g.alliance})` : ''), g.quadrant ?? 'Midfield', g.x_in, g.z_in, g.height_in])) + `\nChamfered-square footprint, ${spec.goals[0].baseAcrossFlats_in}″ across the flats, tapering to ${spec.goals[0].topAcrossFlats_in}″ at the top.\n\n`;
  md += `## Toggles\n` + rows(['Quadrant', 'x″', 'z″', 'Length″'], spec.toggles.map((t) => [t.quadrant, t.x_in, t.z_in, t.length_in])) + `\nThree faces (yellow neutral, red, blue). A Toggle counts only when set to a color and not touched by any Robot. ![Toggle](diagrams/toggle.svg)\n\n`;
  md += `## Loaders\n` + rows(['Alliance', 'x″', 'z″'], spec.loaders.map((l) => [l.alliance, l.x_in, l.z_in])) + '\n';
  md += `## Game elements\n![Elements](diagrams/elements.svg)\n\n- **Pin:** ${spec.elements.pin.length_in}″ long, hexagonal and symmetric (${spec.elements.pin.collarAcrossCorners_in}″ across the collar's corners, ${spec.elements.pin.acrossFlats_in}″ across the flats). Each end is a ${spec.elements.pin.tipAcross_in}″ tip, so either end nests into a Goal or Cup. Each half scores separately.\n- **Cup:** ${spec.elements.cup.height_in}″ tall, ${spec.elements.cup.topAcross_in}″ across the top, ${spec.elements.cup.waistAcross_in}″ at the waist; clear lower half, opaque upper half. A Pin half inside the opaque half doesn't score.\n- **Goals:** ${spec.elements.goal.footprint}; ${spec.elements.goal.module}. ${spec.elements.goal.colors}.\n- **Stacking:** ${spec.elements.stacking.pinInGoal}; ${spec.elements.stacking.cupOnPin}; ${spec.elements.stacking.pinInCup}.\n\n`;
  md += `## Match Loads and Preloads\n- **Match:** ${spec.matchLoads.match.perAlliance} per alliance *(${spec.matchLoads.match.source})*\n- **Skills:** ${spec.matchLoads.skills.redYellowPins} red/yellow Pins, ${spec.matchLoads.skills.blueYellowPins} blue/yellow Pins and ${spec.matchLoads.skills.cups} Cups ${spec.matchLoads.skills.note} *(${spec.matchLoads.skills.source})*\n- **Preload:** ${spec.preloads.perRobot} per robot\n\n`;
  const off = spec.startingLayout.pins.filter((p) => p.source === 'official').length + spec.startingLayout.cups.filter((c) => c.source === 'official').length;
  md += `## Starting layout\n${off} elements come from the official VEXcode VR layout. The rest (${spec.startingLayout.pins.length} Pins and ${spec.startingLayout.cups.length} Cups on the field in total, plus 1 yellow Pin on the Tall Goal) are **filled in symmetrically by VEXsim (assumption)**. Replace them in \`startingLayout()\` in \`src/games/override/game.ts\` once checked against the manual, then run \`npm run reference\`.\n\n`;
  md += rows(['Element', 'Colors (tapered / flat)', 'x″', 'z″', 'Source'], [
    ...spec.startingLayout.pins.map((p) => ['Pin', p.colors.join(' / '), p.x_in, p.z_in, p.source]),
    ...spec.startingLayout.cups.map((c) => ['Cup', '—', c.x_in, c.z_in, c.source]),
  ]);
  return md;
}
