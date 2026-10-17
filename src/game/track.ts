/** Circuito da Serra — closed superellipse with one chicane and gentle hills. */

export const ROAD_HALF = 7.6;
export const WALL_LIMIT = 10.15;
export const TOTAL_LAPS = 3;

export type Sample = {
  x: number;
  y: number;
  z: number;
  tx: number;
  ty: number;
  tz: number;
  rx: number;
  rz: number;
  s: number;
  seg: number;
  curvature: number;
};

export type Checkpoint = { s: number; index: number };

export type TrackData = {
  samples: Sample[];
  length: number;
  checkpoints: Checkpoint[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
};

export type Pose = {
  x: number;
  y: number;
  z: number;
  tx: number;
  ty: number;
  tz: number;
  rx: number;
  rz: number;
  curvature: number;
  s: number;
};

export type Proj = { index: number; lateral: number; dist: number };

function center(along: number): { x: number; y: number; z: number } {
  const n = 3.15;
  const ax = 156;
  const bz = 90;
  const a = along * Math.PI * 2 - Math.PI / 2;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const x = Math.sign(c) * Math.pow(Math.abs(c), 2 / n) * ax;
  let z = Math.sign(s) * Math.pow(Math.abs(s), 2 / n) * bz;
  const u = along - 0.5;
  const env = Math.exp(-(u * u) * 90);
  z += env * Math.sin(u * Math.PI * 7) * 13;
  const y = Math.sin(along * Math.PI * 2) * 2.1 + Math.sin(along * Math.PI * 4 + 0.4) * 2.6;
  return { x, y, z };
}

export function buildTrack(): TrackData {
  const n = 480;
  const raw: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i < n; i++) raw.push(center(i / n));

  const samples: Sample[] = raw.map((p) => ({
    x: p.x,
    y: p.y,
    z: p.z,
    tx: 0,
    ty: 0,
    tz: 1,
    rx: 1,
    rz: 0,
    s: 0,
    seg: 1,
    curvature: 0,
  }));

  let length = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = samples[j].x - samples[i].x;
    const dy = samples[j].y - samples[i].y;
    const dz = samples[j].z - samples[i].z;
    const seg = Math.hypot(dx, dy, dz) || 0.001;
    samples[i].s = length;
    samples[i].seg = seg;
    length += seg;
  }

  for (let i = 0; i < n; i++) {
    const i0 = (i - 1 + n) % n;
    const i1 = (i + 1) % n;
    let tx = samples[i1].x - samples[i0].x;
    let ty = samples[i1].y - samples[i0].y;
    let tz = samples[i1].z - samples[i0].z;
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl;
    ty /= tl;
    tz /= tl;
    const h = Math.hypot(tx, tz) || 1;
    samples[i].tx = tx;
    samples[i].ty = ty;
    samples[i].tz = tz;
    samples[i].rx = tz / h;
    samples[i].rz = -tx / h;
  }

  const curv = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const i1 = (i + 1) % n;
    const cross = samples[i].tx * samples[i1].tz - samples[i].tz * samples[i1].tx;
    const dot = samples[i].tx * samples[i1].tx + samples[i].tz * samples[i1].tz;
    curv[i] = Math.atan2(cross, dot) / samples[i].seg;
  }
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let k = -3; k <= 3; k++) acc += curv[(i + k + n) % n];
    samples[i].curvature = acc / 7;
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const s of samples) {
    minX = Math.min(minX, s.x);
    maxX = Math.max(maxX, s.x);
    minZ = Math.min(minZ, s.z);
    maxZ = Math.max(maxZ, s.z);
  }

  const gates = 6;
  const checkpoints: Checkpoint[] = [];
  for (let k = 0; k < gates; k++) {
    checkpoints.push({ s: (k / gates) * length, index: k });
  }

  return { samples, length, checkpoints, bounds: { minX, maxX, minZ, maxZ } };
}

export function sampleAt(track: TrackData, dist: number, out: Pose): void {
  const len = track.length;
  let s = dist % len;
  if (s < 0) s += len;
  const samples = track.samples;
  let lo = 0;
  let hi = samples.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (samples[mid].s <= s) lo = mid;
    else hi = mid - 1;
  }
  const a = samples[lo];
  const b = samples[(lo + 1) % samples.length];
  const t = a.seg > 1e-6 ? Math.min(1, (s - a.s) / a.seg) : 0;
  const u = 1 - t;
  out.x = a.x * u + b.x * t;
  out.y = a.y * u + b.y * t;
  out.z = a.z * u + b.z * t;
  let tx = a.tx * u + b.tx * t;
  let ty = a.ty * u + b.ty * t;
  let tz = a.tz * u + b.tz * t;
  const tl = Math.hypot(tx, ty, tz) || 1;
  tx /= tl;
  ty /= tl;
  tz /= tl;
  const h = Math.hypot(tx, tz) || 1;
  out.tx = tx;
  out.ty = ty;
  out.tz = tz;
  out.rx = tz / h;
  out.rz = -tx / h;
  out.curvature = a.curvature * u + b.curvature * t;
  out.s = s;
}

export function project(track: TrackData, x: number, z: number, hint: number, out: Proj): void {
  const samples = track.samples;
  const n = samples.length;
  let best = Infinity;
  let bi = hint;
  const scan = (from: number, to: number) => {
    for (let k = from; k <= to; k++) {
      const i = (k + n) % n;
      const s = samples[i];
      const dx = x - s.x;
      const dz = z - s.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < best) {
        best = d2;
        bi = i;
      }
    }
  };
  if (hint >= 0) scan(hint - 40, hint + 40);
  if (best > 36 * 36) {
    best = Infinity;
    for (let i = 0; i < n; i++) {
      const s = samples[i];
      const dx = x - s.x;
      const dz = z - s.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < best) {
        best = d2;
        bi = i;
      }
    }
  }
  const s = samples[bi];
  out.index = bi;
  out.dist = Math.sqrt(best);
  out.lateral = (x - s.x) * s.rx + (z - s.z) * s.rz;
}

/** Min distance between centerline samples that are not neighbors. For QA. */
export function minSeparation(track: TrackData): number {
  const s = track.samples;
  let min = Infinity;
  for (let i = 0; i < s.length; i += 2) {
    for (let j = i + 24; j < s.length; j += 2) {
      if (Math.min(j - i, s.length - (j - i)) < 24) continue;
      const d = Math.hypot(s[i].x - s[j].x, s[i].z - s[j].z);
      if (d < min) min = d;
    }
  }
  return min;
}
