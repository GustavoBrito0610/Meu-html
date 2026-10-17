import * as THREE from "three";
import { createMixer, type Mixer } from "@/game/audio";
import {
  ROAD_HALF,
  TOTAL_LAPS,
  WALL_LIMIT,
  buildTrack,
  project,
  sampleAt,
  type Pose,
  type Proj,
  type Sample,
  type TrackData,
} from "@/game/track";

export type Phase = "menu" | "race" | "paused" | "finish";

export type Standing = { name: string; you: boolean };

export type FinishPayload = {
  place: number;
  raceTime: number;
  lapTimes: number[];
  bestLap: number | null;
  bestRace: number | null;
  standings: Standing[];
};

export type SaveData = {
  version: 1;
  bestLap: number | null;
  bestRace: number | null;
  volume: number;
};

export type Hud = {
  speed: HTMLElement | null;
  lap: HTMLElement | null;
  time: HTMLElement | null;
  best: HTMLElement | null;
  place: HTMLElement | null;
  drift: HTMLElement | null;
  banner: HTMLElement | null;
  boost: HTMLElement | null;
  rows: (HTMLElement | null)[];
  map: HTMLCanvasElement | null;
};

export type EngineHooks = {
  onPhase: (phase: Phase, payload?: FinishPayload) => void;
  onRecord: (save: SaveData) => void;
};

export type Engine = {
  start: () => void;
  pause: () => void;
  resume: () => void;
  restart: () => void;
  toMenu: () => void;
  hold: (code: string, down: boolean) => void;
  setVolume: (v: number) => void;
  setMuted: (m: boolean) => void;
  dispose: () => void;
};

const SAVE_KEY = "vertice-save-v1";
const STEP = 1 / 120;

export function formatTime(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec)) return "—";
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}

export function readSave(): SaveData {
  const fallback: SaveData = { version: 1, bestLap: null, bestRace: null, volume: 0.8 };
  if (typeof localStorage === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw) as Partial<SaveData>;
    if (p.version !== 1) return fallback;
    return {
      version: 1,
      bestLap: typeof p.bestLap === "number" ? p.bestLap : null,
      bestRace: typeof p.bestRace === "number" ? p.bestRace : null,
      volume: typeof p.volume === "number" ? Math.min(1, Math.max(0, p.volume)) : 0.8,
    };
  } catch {
    return fallback;
  }
}

declare global {
  interface Window {
    __controlsTest?: {
      getYaw: () => number;
      getSpeed: () => number;
      setSteer?: (v: number) => void;
      setKeys?: (codes: string[]) => void;
    };
  }
}

type Rig = {
  group: THREE.Group;
  wheels: THREE.Object3D[];
  steers: THREE.Object3D[];
  tail: THREE.MeshStandardMaterial;
  spin: number;
};

type Racer = {
  name: string;
  you: boolean;
  offset: number;
  base: number;
  phase: number;
  s: number;
  lap: number;
  speed: number;
  rig: Rig;
};

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

function hash(i: number) {
  let x = Math.imul(i, 374761393) + 668265263;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967295;
}

function paintAsphalt(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = "#4c535b";
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 4200; i++) {
    const v = 40 + Math.random() * 50;
    ctx.fillStyle = `rgba(${v},${v},${v},${Math.random() * 0.18})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
  ctx.fillStyle = "rgba(0,0,0,0.16)";
  ctx.fillRect(w * 0.2, 0, w * 0.16, h);
  ctx.fillRect(w * 0.64, 0, w * 0.16, h);
  ctx.fillStyle = "#f3efe4";
  ctx.fillRect(0, 0, w * 0.03, h);
  ctx.fillRect(w * 0.97, 0, w * 0.03, h);
  ctx.fillStyle = "#e8a04a";
  const dw = w * 0.04;
  for (let y = h * 0.05; y < h; y += h * 0.18) ctx.fillRect((w - dw) / 2, y, dw, h * 0.08);
}

function paintVerge(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = "#2c3824";
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 1800; i++) {
    ctx.fillStyle = Math.random() > 0.5 ? "rgba(80,100,60,0.25)" : "rgba(0,0,0,0.15)";
    ctx.fillRect(Math.random() * w, Math.random() * h, 3, 2);
  }
  ctx.fillStyle = "#c44932";
  for (let y = 0; y < h; y += 18) ctx.fillRect(0, y, w, 8);
  ctx.fillStyle = "#f3efe4";
  for (let y = 8; y < h; y += 18) ctx.fillRect(0, y, w, 6);
}

function paintWall(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = "#3c362f";
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(Math.random() * w, Math.random() * h, 4, 3);
  }
  ctx.fillStyle = "#e8a04a";
  ctx.fillRect(0, 10, w, 16);
  ctx.fillStyle = "#6d645b";
  ctx.fillRect(0, h - 22, w, 22);
}

function paintChecker(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const cols = 14;
  const cw = w / cols;
  const ch = h / 2;
  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < 2; y++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? "#f3efe4" : "#16181c";
      ctx.fillRect(x * cw, y * ch, cw + 1, ch + 1);
    }
  }
}

function paintSign(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = "#141c18";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#e8a04a";
  ctx.lineWidth = 10;
  ctx.strokeRect(8, 8, w - 16, h - 16);
  ctx.fillStyle = "#f3efe4";
  ctx.font = "700 72px Oswald, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("VÉRTICE", w / 2, h / 2 + 2);
}

function paintChevron(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = "#1a120e";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#e8a04a";
  ctx.lineWidth = 14;
  ctx.lineJoin = "miter";
  for (let i = 0; i < 3; i++) {
    const x = 36 + i * 48;
    ctx.beginPath();
    ctx.moveTo(x, 28);
    ctx.lineTo(x + 36, h / 2);
    ctx.lineTo(x, h - 28);
    ctx.stroke();
  }
}

function makeTex(w: number, h: number, paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, repeat: boolean) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D indisponível");
  paint(ctx, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  if (repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  return { tex, canvas: c, ctx };
}

function ribbonGeometry(samples: Sample[], length: number, lat0: number, lat1: number, yLift: number, uvScale: number) {
  const n = samples.length;
  const count = n + 1;
  const pos = new Float32Array(count * 2 * 3);
  const nrm = new Float32Array(count * 2 * 3);
  const uv = new Float32Array(count * 2 * 2);
  for (let i = 0; i < count; i++) {
    const s = samples[i % n];
    const dist = i === n ? length : s.s;
    let nx = s.ty * s.rz;
    let ny = s.tz * s.rx - s.tx * s.rz;
    let nz = -s.ty * s.rx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    if (ny < 0) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    for (let k = 0; k < 2; k++) {
      const lat = k === 0 ? lat0 : lat1;
      const vi = i * 2 + k;
      pos[vi * 3] = s.x + s.rx * lat;
      pos[vi * 3 + 1] = s.y + yLift;
      pos[vi * 3 + 2] = s.z + s.rz * lat;
      nrm[vi * 3] = nx;
      nrm[vi * 3 + 1] = ny;
      nrm[vi * 3 + 2] = nz;
      uv[vi * 2] = k;
      uv[vi * 2 + 1] = dist * uvScale;
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = i * 2;
    const b = a + 1;
    const c = (i + 1) * 2;
    const d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}

function wallGeometry(samples: Sample[], length: number, side: number) {
  const n = samples.length;
  const count = n + 1;
  const lat = side * 11.55;
  const pos = new Float32Array(count * 2 * 3);
  const nrm = new Float32Array(count * 2 * 3);
  const uv = new Float32Array(count * 2 * 2);
  for (let i = 0; i < count; i++) {
    const s = samples[i % n];
    const dist = i === n ? length : s.s;
    const nx = -side * s.rx;
    const nz = -side * s.rz;
    for (let k = 0; k < 2; k++) {
      const vi = i * 2 + k;
      pos[vi * 3] = s.x + s.rx * lat;
      pos[vi * 3 + 1] = s.y + k * 1.45;
      pos[vi * 3 + 2] = s.z + s.rz * lat;
      nrm[vi * 3] = nx;
      nrm[vi * 3 + 1] = 0;
      nrm[vi * 3 + 2] = nz;
      uv[vi * 2] = dist * 0.03;
      uv[vi * 2 + 1] = k;
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = i * 2;
    const b = a + 1;
    const c = (i + 1) * 2;
    const d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}

function crosses(prev: number, ds: number, cp: number, len: number) {
  if (ds <= 0) return false;
  const end = prev + ds;
  if (cp > prev && cp <= Math.min(end, len)) return true;
  if (end > len && cp <= end - len) return true;
  return false;
}

export function createEngine(
  canvas: HTMLCanvasElement,
  hudRef: { current: Hud },
  hooksRef: { current: EngineHooks },
): Engine {
  const track: TrackData = buildTrack();
  const disposables: { dispose: () => void }[] = [];
  const keep = <T extends { dispose: () => void }>(r: T) => {
    disposables.push(r);
    return r;
  };

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.setClearColor(0x1a2330, 1);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a2330);
  scene.fog = new THREE.Fog(0x1a2330, 140, 520);

  const camera = new THREE.PerspectiveCamera(62, 1, 0.12, 520);
  camera.position.set(0, 18, 40);

  scene.add(new THREE.AmbientLight(0xc5ccd4, 0.55));
  scene.add(new THREE.HemisphereLight(0xb7cbe2, 0x3d3428, 0.9));
  const moon = new THREE.DirectionalLight(0xd5e2f2, 2.4);
  moon.position.set(90, 140, 50);
  scene.add(moon);

  const asphalt = makeTex(512, 512, paintAsphalt, true);
  const vergeTex = makeTex(128, 256, paintVerge, true);
  const wallTex = makeTex(256, 128, paintWall, true);
  const checkerTex = makeTex(256, 64, paintChecker, false);
  const signTex = makeTex(512, 128, paintSign, false);
  const chevTex = makeTex(180, 96, paintChevron, false);
  for (const t of [asphalt, vergeTex, wallTex, checkerTex, signTex, chevTex]) keep(t.tex);

  const roadMat = keep(
    new THREE.MeshStandardMaterial({ map: asphalt.tex, roughness: 0.88, metalness: 0.04, side: THREE.DoubleSide }),
  );
  const vergeMat = keep(
    new THREE.MeshStandardMaterial({ map: vergeTex.tex, roughness: 1, metalness: 0, side: THREE.DoubleSide }),
  );
  const wallMat = keep(
    new THREE.MeshStandardMaterial({ map: wallTex.tex, roughness: 0.92, metalness: 0.02, side: THREE.DoubleSide }),
  );

  scene.add(new THREE.Mesh(keep(ribbonGeometry(track.samples, track.length, -12.4, 12.4, 0, 0.08)), vergeMat));
  scene.add(new THREE.Mesh(keep(ribbonGeometry(track.samples, track.length, -ROAD_HALF, ROAD_HALF, 0.07, 0.045)), roadMat));
  scene.add(new THREE.Mesh(keep(wallGeometry(track.samples, track.length, 1)), wallMat));
  scene.add(new THREE.Mesh(keep(wallGeometry(track.samples, track.length, -1)), wallMat));

  const floor = new THREE.Mesh(
    keep(new THREE.CircleGeometry(520, 48)),
    keep(new THREE.MeshStandardMaterial({ color: 0x141a16, roughness: 1 })),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -8;
  scene.add(floor);

  const pose: Pose = {
    x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 1, rx: 1, rz: 0, curvature: 0, s: 0,
  };
  sampleAt(track, 0, pose);
  const checker = new THREE.Mesh(
    keep(new THREE.PlaneGeometry(ROAD_HALF * 2, 3.4)),
    keep(new THREE.MeshStandardMaterial({ map: checkerTex.tex, roughness: 0.8 })),
  );
  {
    const xAxis = new THREE.Vector3(-pose.rx, 0, -pose.rz).normalize();
    const yAxis = new THREE.Vector3(pose.tx, 0, pose.tz).normalize();
    const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis);
    if (zAxis.y < 0) xAxis.multiplyScalar(-1);
    zAxis.crossVectors(xAxis, yAxis).normalize();
    checker.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));
    checker.position.set(pose.x, pose.y + 0.12, pose.z);
    scene.add(checker);
  }

  const bulbs: THREE.MeshStandardMaterial[] = [];
  {
    sampleAt(track, 0, pose);
    const yaw = Math.atan2(-pose.tx, -pose.tz);
    const gantry = new THREE.Group();
    gantry.position.set(pose.x, pose.y, pose.z);
    gantry.rotation.y = yaw + Math.PI;
    const concrete = keep(new THREE.MeshStandardMaterial({ color: 0x2a2826, roughness: 0.88 }));
    const pillarGeo = keep(new THREE.BoxGeometry(0.7, 4.6, 0.7));
    for (const x of [-8.3, 8.3]) {
      const p = new THREE.Mesh(pillarGeo, concrete);
      p.position.set(x, 2.3, 0);
      gantry.add(p);
    }
    const beam = new THREE.Mesh(keep(new THREE.BoxGeometry(17.4, 0.45, 0.7)), concrete);
    beam.position.set(0, 4.5, 0);
    gantry.add(beam);
    const sign = new THREE.Mesh(
      keep(new THREE.BoxGeometry(7.2, 1.5, 0.16)),
      keep(new THREE.MeshStandardMaterial({ map: signTex.tex, roughness: 0.6, emissive: 0x22180c, emissiveIntensity: 0.4 })),
    );
    sign.position.set(0, 4.5, 0.45);
    gantry.add(sign);
    const bulbGeo = keep(new THREE.SphereGeometry(0.18, 12, 10));
    for (let i = 0; i < 5; i++) {
      const mat = keep(new THREE.MeshStandardMaterial({ color: 0xc44932, emissive: 0xc44932, emissiveIntensity: 1.4 }));
      bulbs.push(mat);
      const b = new THREE.Mesh(bulbGeo, mat);
      b.position.set(-1.6 + i * 0.8, 4.15, 0.5);
      gantry.add(b);
    }
    scene.add(gantry);
  }

  const postGeo = keep(new THREE.CylinderGeometry(0.16, 0.2, 2.3, 7));
  const postMat = keep(new THREE.MeshStandardMaterial({ color: 0xe8a04a, emissive: 0x5a3a16, emissiveIntensity: 0.5, roughness: 0.5 }));
  for (const cp of track.checkpoints) {
    if (cp.index === 0) continue;
    sampleAt(track, cp.s, pose);
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(pose.x + pose.rx * side * (ROAD_HALF + 0.7), pose.y + 1.15, pose.z + pose.rz * side * (ROAD_HALF + 0.7));
      scene.add(post);
    }
  }

  const chevMat = keep(
    new THREE.MeshStandardMaterial({ map: chevTex.tex, roughness: 0.55, emissive: 0x3a2410, emissiveIntensity: 0.35, side: THREE.DoubleSide }),
  );
  const chevGeo = keep(new THREE.BoxGeometry(1.7, 0.95, 0.1));
  let lastChev = -100;
  for (let i = 0; i < track.samples.length; i++) {
    const s = track.samples[i];
    if (Math.abs(s.curvature) < 0.011 || s.s - lastChev < 32) continue;
    const side = Math.sign(s.curvature) || 1;
    const x = s.x + s.rx * side * 12.6;
    const z = s.z + s.rz * side * 12.6;
    if (!clearOfTrack(x, z, i, 12)) continue;
    lastChev = s.s;
    const board = new THREE.Mesh(chevGeo, chevMat);
    board.position.set(x, s.y + 0.85, z);
    board.rotation.y = Math.atan2(-s.tx, -s.tz);
    if (side < 0) board.scale.x = -1;
    scene.add(board);
  }

  const dummy = new THREE.Object3D();
  const trunkGeo = keep(new THREE.CylinderGeometry(0.16, 0.26, 1.3, 5));
  const crownGeo = keep(new THREE.ConeGeometry(1.15, 2.7, 6));
  const rockGeo = keep(new THREE.DodecahedronGeometry(0.8, 0));
  const cliffGeo = keep(new THREE.BoxGeometry(1, 1, 1));
  const treeMats = {
    trunk: keep(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 })),
    crown: keep(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 })),
  };
  const rockMat = keep(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 }));
  const cliffMat = keep(new THREE.MeshStandardMaterial({ color: 0x3a342e, roughness: 1 }));

  function clearOfTrack(x: number, z: number, near: number, min: number) {
  const n = track.samples.length;
  for (let i = 0; i < n; i += 2) {
    const gap = Math.min(Math.abs(i - near), n - Math.abs(i - near));
    if (gap < 18) continue;
    const s = track.samples[i];
    if ((x - s.x) * (x - s.x) + (z - s.z) * (z - s.z) < min * min) return false;
  }
  return true;
}

const treePos: { x: number; y: number; z: number; s: number; k: number }[] = [];
const rockPos: typeof treePos = [];
for (let i = 0; i < track.samples.length; i += 3) {
  const s = track.samples[i];
  const h = hash(i + 3);
  if (h > 0.55) {
    const side = hash(i + 9) > 0.5 ? 1 : -1;
    const dist = 18 + hash(i + 11) * 16;
    const x = s.x + s.rx * side * dist;
    const z = s.z + s.rz * side * dist;
    if (clearOfTrack(x, z, i, 14)) {
      treePos.push({ x, y: s.y, z, s: 0.75 + hash(i + 5) * 0.7, k: hash(i + 2) });
    }
  }
  if (hash(i + 17) > 0.7) {
    const side = hash(i + 19) > 0.5 ? 1 : -1;
    const dist = 15 + hash(i + 21) * 6;
    const x = s.x + s.rx * side * dist;
    const z = s.z + s.rz * side * dist;
    if (clearOfTrack(x, z, i, 13)) {
      rockPos.push({ x, y: s.y, z, s: 0.5 + hash(i + 23) * 1.3, k: hash(i + 29) });
    }
  }
}
  const trunks = new THREE.InstancedMesh(trunkGeo, treeMats.trunk, Math.max(1, treePos.length));
  const crowns = new THREE.InstancedMesh(crownGeo, treeMats.crown, Math.max(1, treePos.length));
  const col = new THREE.Color();
  treePos.forEach((p, i) => {
    dummy.position.set(p.x, p.y + 0.65 * p.s, p.z);
    dummy.rotation.set(0, p.k * 6, 0);
    dummy.scale.setScalar(p.s);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    dummy.position.y = p.y + 1.9 * p.s;
    dummy.updateMatrix();
    crowns.setMatrixAt(i, dummy.matrix);
    col.setHex(0x6a4a32);
    trunks.setColorAt(i, col);
    col.setHSL(0.26 + p.k * 0.08, 0.38, 0.22 + p.k * 0.08);
    crowns.setColorAt(i, col);
  });
  if (treePos.length > 0) scene.add(trunks, crowns);

  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, Math.max(1, rockPos.length));
  rockPos.forEach((p, i) => {
    dummy.position.set(p.x, p.y + 0.3 * p.s, p.z);
    dummy.rotation.set(p.k * 3, p.k * 5, p.k);
    dummy.scale.set(p.s, p.s * 0.7, p.s);
    dummy.updateMatrix();
    rocks.setMatrixAt(i, dummy.matrix);
    col.setHSL(0.07, 0.12, 0.28 + p.k * 0.12);
    rocks.setColorAt(i, col);
  });
  if (rockPos.length > 0) scene.add(rocks);

  const cliffSpots: { x: number; y: number; z: number; h: number; k: number }[] = [];
  for (let i = 0; i < track.samples.length && cliffSpots.length < 22; i += 19) {
    const s = track.samples[i];
    const side = hash(i + 40) > 0.5 ? 1 : -1;
    const dist = 34 + hash(i + 41) * 22;
    const x = s.x + s.rx * side * dist;
    const z = s.z + s.rz * side * dist;
    if (!clearOfTrack(x, z, i, 20)) continue;
    cliffSpots.push({ x, y: s.y, z, h: 8 + hash(i + 42) * 12, k: hash(i + 43) });
  }
  const cliffs = new THREE.InstancedMesh(cliffGeo, cliffMat, Math.max(1, cliffSpots.length));
  cliffSpots.forEach((p, i) => {
    dummy.position.set(p.x, p.y + p.h * 0.35 - 2, p.z);
    dummy.rotation.set(0, p.k * 3, 0);
    dummy.scale.set(7 + p.k * 8, p.h, 6 + hash(i + 44) * 7);
    dummy.updateMatrix();
    cliffs.setMatrixAt(i, dummy.matrix);
  });
  if (cliffSpots.length > 0) scene.add(cliffs);

  const starN = 160;
  const starArr = new Float32Array(starN * 3);
  for (let i = 0; i < starN; i++) {
    starArr[i * 3] = (hash(i + 80) - 0.5) * 520;
    starArr[i * 3 + 1] = 40 + hash(i + 81) * 90;
    starArr[i * 3 + 2] = (hash(i + 82) - 0.5) * 520;
  }
  const starGeo = keep(new THREE.BufferGeometry());
  starGeo.setAttribute("position", new THREE.BufferAttribute(starArr, 3));
  const stars = new THREE.Points(
    starGeo,
    keep(new THREE.PointsMaterial({ color: 0xf3efe4, size: 1.3, sizeAttenuation: false, transparent: true, opacity: 0.75, fog: false })),
  );
  scene.add(stars);
  const moonMesh = new THREE.Mesh(
    keep(new THREE.SphereGeometry(7, 20, 16)),
    keep(new THREE.MeshBasicMaterial({ color: 0xf4efe4, fog: false })),
  );
  moonMesh.position.set(-150, 86, -70);
  scene.add(moonMesh);

  const SPARK_N = 40;
  const sparkPos = new Float32Array(SPARK_N * 3);
  const sparkVel = new Float32Array(SPARK_N * 3);
  const sparkLife = new Float32Array(SPARK_N);
  sparkPos.fill(-999);
  const sparkGeo = keep(new THREE.BufferGeometry());
  sparkGeo.setAttribute("position", new THREE.BufferAttribute(sparkPos, 3));
  const sparkMat = keep(
    new THREE.PointsMaterial({ color: 0xe8a04a, size: 0.28, transparent: true, opacity: 0.95, depthWrite: false }),
  );
  scene.add(new THREE.Points(sparkGeo, sparkMat));

  const wheelGeo = keep(new THREE.CylinderGeometry(0.36, 0.36, 0.3, 14));
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = keep(new THREE.MeshStandardMaterial({ color: 0x1a1c1e, roughness: 0.55, metalness: 0.45 }));
  const glassMat = keep(new THREE.MeshStandardMaterial({ color: 0x1b242c, roughness: 0.18, metalness: 0.55 }));

  function createCar(bodyHex: number, accentHex: number, plate: string, withLight: boolean): Rig {
    const group = new THREE.Group();
    const bodyMat = keep(new THREE.MeshStandardMaterial({ color: bodyHex, roughness: 0.48, metalness: 0.22 }));
    const accentMat = keep(
      new THREE.MeshStandardMaterial({ color: accentHex, emissive: accentHex, emissiveIntensity: 0.25, roughness: 0.4, metalness: 0.3 }),
    );
    const tail = keep(
      new THREE.MeshStandardMaterial({ color: 0xc44932, emissive: 0xc44932, emissiveIntensity: 0.7, roughness: 0.4 }),
    );
    const body = new THREE.Mesh(keep(new THREE.BoxGeometry(1.78, 0.42, 3.7)), bodyMat);
    body.position.set(0, 0.64, 0);
    const hood = new THREE.Mesh(keep(new THREE.BoxGeometry(1.5, 0.16, 1.15)), bodyMat);
    hood.position.set(0, 0.8, 0.95);
    const cabin = new THREE.Mesh(keep(new THREE.BoxGeometry(1.42, 0.4, 1.4)), glassMat);
    cabin.position.set(0, 0.98, -0.2);
    const spoiler = new THREE.Mesh(keep(new THREE.BoxGeometry(1.7, 0.08, 0.28)), accentMat);
    spoiler.position.set(0, 1.18, -1.65);
    group.add(body, hood, cabin, spoiler);
    const glow = new THREE.Mesh(
      keep(new THREE.BoxGeometry(1.5, 0.05, 2.8)),
      keep(new THREE.MeshStandardMaterial({ color: accentHex, emissive: accentHex, emissiveIntensity: 0.85, roughness: 0.4 })),
    );
    glow.position.set(0, 0.28, 0);
    group.add(glow);
    const lampGeo = keep(new THREE.BoxGeometry(0.32, 0.12, 0.08));
    for (const x of [-0.55, 0.55]) {
      const lamp = new THREE.Mesh(
        lampGeo,
        keep(new THREE.MeshStandardMaterial({ color: 0xfff1d6, emissive: 0xffe2b0, emissiveIntensity: withLight ? 2.2 : 0.8 })),
      );
      lamp.position.set(x, 0.62, 1.88);
      group.add(lamp);
      const t = new THREE.Mesh(lampGeo, tail);
      t.position.set(x, 0.6, -1.88);
      group.add(t);
    }
    const plateCanvas = document.createElement("canvas");
    plateCanvas.width = 128;
    plateCanvas.height = 64;
    const pctx = plateCanvas.getContext("2d");
    if (pctx) {
      pctx.fillStyle = "#141c18";
      pctx.fillRect(0, 0, 128, 64);
      pctx.fillStyle = "#e8a04a";
      pctx.font = "700 40px Oswald, sans-serif";
      pctx.textAlign = "center";
      pctx.textBaseline = "middle";
      pctx.fillText(plate, 64, 34);
    }
    const plateTex = keep(new THREE.CanvasTexture(plateCanvas));
    plateTex.colorSpace = THREE.SRGBColorSpace;
    const plateMesh = new THREE.Mesh(
      keep(new THREE.BoxGeometry(0.7, 0.32, 0.04)),
      keep(new THREE.MeshStandardMaterial({ map: plateTex, roughness: 0.5 })),
    );
    plateMesh.position.set(0, 1.22, -0.15);
    group.add(plateMesh);

    const wheels: THREE.Object3D[] = [];
    const steers: THREE.Object3D[] = [];
    for (const [x, z, steer] of [
      [-0.86, 1.25, true],
      [0.86, 1.25, true],
      [-0.86, -1.25, false],
      [0.86, -1.25, false],
    ] as const) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.44, z);
      const mesh = new THREE.Mesh(wheelGeo, wheelMat);
      pivot.add(mesh);
      group.add(pivot);
      wheels.push(mesh);
      if (steer) steers.push(pivot);
    }
    const shadow = new THREE.Mesh(
      keep(new THREE.CircleGeometry(1.35, 14)),
      keep(new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false })),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.09;
    group.add(shadow);
    scene.add(group);
    return { group, wheels, steers, tail, spin: 0 };
  }

  const playerRig = createCar(0xd8c4a2, 0xe8a04a, "01", true);
  const aiRigs = [
    createCar(0xc44932, 0xf3efe4, "02", false),
    createCar(0x6e8f78, 0xe8a04a, "03", false),
    createCar(0xe4e0d4, 0xc44932, "04", false),
  ];

  const spot = new THREE.SpotLight(0xffe4c2, 90, 78, 0.62, 0.5, 1.4);
  scene.add(spot);
  scene.add(spot.target);

  const keys = new Set<string>();
  let scripted: Set<string> | null = null;
  let steerOverride: number | null = null;
  let phase: Phase = "menu";
  let elapsed = 0;
  let raceTime = 0;
  let shake = 0;
  let camMode: "chase" | "hood" = "chase";
  let finished = false;
  let acc = 0;
  const save = readSave();
  let bestLap = save.bestLap;
  let bestRace = save.bestRace;

  const player = {
    x: 0, y: 0, z: 0, yaw: 0, speed: 0, lateral: 0, s: 0, idx: 0,
    laps: 0, next: 1, lapTime: 0, lapTimes: [] as number[],
    lastS: 0, charge: 0, boost: 0, drifting: false, wrong: 0, hitCd: 0,
    offset: -1.7,
  };

  const ais: Racer[] = [
    { name: "NOVA", you: false, offset: 1.7, base: 32.2, phase: 0.4, s: 0, lap: 0, speed: 0, rig: aiRigs[0] },
    { name: "BRUMA", you: false, offset: -4.7, base: 30.2, phase: 1.7, s: 0, lap: 0, speed: 0, rig: aiRigs[1] },
    { name: "LUME", you: false, offset: 4.7, base: 29.4, phase: 2.4, s: 0, lap: 0, speed: 0, rig: aiRigs[2] },
  ];

  const proj: Proj = { index: 0, lateral: 0, dist: 0 };
  const aiPose: Pose = { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 1, rx: 1, rz: 0, curvature: 0, s: 0 };
  const camPos = new THREE.Vector3(0, 20, 30);
  const look = new THREE.Vector3();
  const desired = new THREE.Vector3();
  const lookT = new THREE.Vector3();
  let announce = "";
  let announceT = 0;

  function persist() {
    const next: SaveData = { version: 1, bestLap, bestRace, volume: save.volume };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(next));
    } catch {
      /* ignore quota */
    }
    hooksRef.current.onRecord(next);
  }

  function setLights(go: boolean) {
    for (const m of bulbs) {
      const hex = go ? 0x9dce7a : 0xc44932;
      m.color.setHex(hex);
      m.emissive.setHex(hex);
    }
  }

  function placeCar(rig: Rig, s: number, offset: number, speed: number, yawOverride?: number) {
    sampleAt(track, s, aiPose);
    const x = aiPose.x + aiPose.rx * offset;
    const z = aiPose.z + aiPose.rz * offset;
    const yaw = yawOverride ?? Math.atan2(-aiPose.tx, -aiPose.tz);
    rig.group.position.set(x, aiPose.y, z);
    rig.group.rotation.order = "YXZ";
    rig.group.rotation.y = yaw + Math.PI;
    const horiz = Math.hypot(aiPose.tx, aiPose.tz) || 1;
    rig.group.rotation.x = -Math.atan2(aiPose.ty, horiz);
    rig.spin -= speed * STEP * 1.6;
    for (const w of rig.wheels) w.rotation.x = rig.spin;
    for (const st of rig.steers) st.rotation.y = 0;
    return yaw;
  }

  function resetRace() {
    finished = false;
    raceTime = 0;
    player.speed = 0;
    player.lateral = 0;
    player.laps = 0;
    player.next = 1;
    player.lapTime = 0;
    player.lapTimes = [];
    player.charge = 0;
    player.boost = 0;
    player.drifting = false;
    player.wrong = 0;
    player.hitCd = 0;
    player.s = track.length - 16;
    player.lastS = player.s;
    player.offset = -1.7;
    sampleAt(track, player.s, pose);
    player.x = pose.x + pose.rx * player.offset;
    player.z = pose.z + pose.rz * player.offset;
    player.y = pose.y;
    player.yaw = Math.atan2(-pose.tx, -pose.tz);
    player.idx = 0;
    project(track, player.x, player.z, -1, proj);
    player.idx = proj.index;
    const offs = [16, 23, 23];
    ais.forEach((ai, i) => {
      ai.s = track.length - offs[i];
      ai.lap = 0;
      ai.speed = 0;
    });
    snapVisuals(0);
    setLights(false);
    camMode = "chase";
  }

  function snapVisuals(steerVisual: number) {
    playerRig.group.position.set(player.x, player.y, player.z);
    playerRig.group.rotation.order = "YXZ";
    playerRig.group.rotation.y = player.yaw + Math.PI;
    sampleAt(track, player.s, pose);
    const horiz = Math.hypot(pose.tx, pose.tz) || 1;
    playerRig.group.rotation.x = -Math.atan2(pose.ty, horiz);
    playerRig.group.rotation.z = clamp(-steerVisual * 0.12, -0.2, 0.2);
    playerRig.spin -= player.speed * STEP * 1.7;
    for (const w of playerRig.wheels) w.rotation.x = playerRig.spin;
    for (const st of playerRig.steers) st.rotation.y = steerVisual * 0.4;
    playerRig.tail.emissiveIntensity = 0.55;
    for (const ai of ais) placeCar(ai.rig, ai.s, ai.offset + Math.sin(ai.s * 0.02 + ai.phase) * 0.3, ai.speed);
  }

  function respawn() {
    sampleAt(track, player.lastS, pose);
    player.s = player.lastS;
    player.x = pose.x + pose.rx * player.offset;
    player.z = pose.z + pose.rz * player.offset;
    player.y = pose.y;
    player.yaw = Math.atan2(-pose.tx, -pose.tz);
    player.speed = 14;
    player.lateral = 0;
    project(track, player.x, player.z, -1, proj);
    player.idx = proj.index;
    announce = "DE VOLTA";
    announceT = 0.7;
  }

  function standings(): Standing[] {
    const rows = [
      { name: "VOCÊ", you: true, p: player.laps * track.length + player.s },
      ...ais.map((ai) => ({ name: ai.name, you: false, p: ai.lap * track.length + ai.s })),
    ];
    rows.sort((a, b) => b.p - a.p);
    return rows.map(({ name, you }) => ({ name, you }));
  }

  function finishRace() {
    if (finished) return;
    finished = true;
    phase = "finish";
    if (bestLap == null || player.lapTimes.some((t) => t < bestLap!)) {
      bestLap = Math.min(...player.lapTimes);
    }
    if (bestRace == null || raceTime < bestRace) bestRace = raceTime;
    persist();
    const rows = standings();
    const place = rows.findIndex((r) => r.you) + 1;
    setLights(false);
    mixer.fanfare();
    hooksRef.current.onPhase("finish", {
      place,
      raceTime,
      lapTimes: player.lapTimes.slice(),
      bestLap,
      bestRace,
      standings: rows,
    });
  }

  function held(code: string) {
    if (scripted) return scripted.has(code);
    return keys.has(code);
  }

  function emitSpark(x: number, y: number, z: number, vx: number, vy: number, vz: number) {
    for (let i = 0; i < SPARK_N; i++) {
      if (sparkLife[i] > 0) continue;
      sparkLife[i] = 0.28 + Math.random() * 0.15;
      sparkPos[i * 3] = x;
      sparkPos[i * 3 + 1] = y;
      sparkPos[i * 3 + 2] = z;
      sparkVel[i * 3] = vx;
      sparkVel[i * 3 + 1] = vy;
      sparkVel[i * 3 + 2] = vz;
      return;
    }
  }

  function simulate(dt: number) {
    let steer = 0;
    let throttle = 0;
    let brake = 0;
    let driftBtn = false;
    if (held("KeyA") || held("ArrowLeft")) steer += 1;
    if (held("KeyD") || held("ArrowRight")) steer -= 1;
    if (held("KeyW") || held("ArrowUp")) throttle = 1;
    if (held("KeyS") || held("ArrowDown")) brake = 1;
    if (held("ShiftLeft") || held("ShiftRight") || held("Space")) driftBtn = true;
    if (!scripted && typeof navigator !== "undefined" && navigator.getGamepads) {
      const pads = navigator.getGamepads();
      for (const pad of pads) {
        if (!pad) continue;
        const ax = pad.axes[0] ?? 0;
        if (Math.abs(ax) > 0.12) steer += -ax;
        const rt = pad.buttons[7];
        const lt = pad.buttons[6];
        if (rt && (rt.pressed || rt.value > 0.05)) throttle = Math.max(throttle, rt.value || 1);
        if (lt && (lt.pressed || lt.value > 0.05)) brake = Math.max(brake, lt.value || 1);
        if (pad.buttons[0]?.pressed || pad.buttons[5]?.pressed) driftBtn = true;
      }
    }
    steer = clamp(steerOverride ?? steer, -1, 1);

    const driftNow = driftBtn && player.speed > 9;
    if (driftNow) {
      player.charge = Math.min(1.4, player.charge + dt * (0.32 + Math.abs(steer) * 1.15));
      player.drifting = true;
    } else {
      if (player.drifting && player.charge > 0.48) {
        player.boost = 0.38 + player.charge * 0.5;
        player.speed = Math.min(52, Math.max(0, player.speed) + 5 + player.charge * 8);
        mixer.boostSting();
        shake = Math.max(shake, 0.22);
      }
      player.drifting = false;
      if (player.charge > 0) player.charge = Math.max(0, player.charge - dt * 1.3);
    }
    if (player.boost > 0) {
      player.boost -= dt;
      player.speed += 14 * dt;
    }

    const maxSpeed = player.boost > 0 ? 50 : 36.5;
    if (throttle) player.speed += 28 * dt * throttle;
    if (brake) player.speed -= 40 * dt * brake;
    const coast = throttle > 0 ? 0.18 : 0.7;
    player.speed -= player.speed * coast * dt;
    player.speed = clamp(player.speed, -13, maxSpeed);

    const speedFactor = clamp(Math.abs(player.speed) / 16, 0.22, 1);
    const fast = clamp(Math.abs(player.speed) / 34, 0, 1);
    const turn = (player.drifting ? 2.15 : 1.5) * (1 - fast * 0.22);
    const reverse = player.speed >= -0.4 ? 1 : -1;
    // A → steer +1 → +yaw. forward = (-sin yaw, 0, -cos yaw). Chase cam: +yaw is left.
    player.yaw += steer * turn * speedFactor * reverse * dt;

    const fx = -Math.sin(player.yaw);
    const fz = -Math.cos(player.yaw);
    const rx = Math.cos(player.yaw);
    const rz = -Math.sin(player.yaw);
    const grip = player.drifting ? 1.55 : 7.2;
    player.lateral *= Math.exp(-grip * dt);
    if (player.speed > 1) player.lateral += -steer * player.speed * (player.drifting ? 0.62 : 0.1) * dt;
    player.lateral = clamp(player.lateral, -16, 16);

    player.x += (fx * player.speed + rx * player.lateral) * dt;
    player.z += (fz * player.speed + rz * player.lateral) * dt;

    project(track, player.x, player.z, player.idx, proj);
    player.idx = proj.index;
    const sample = track.samples[proj.index];
    const onGrass = Math.abs(proj.lateral) > ROAD_HALF;
    if (onGrass) player.speed -= player.speed * 2.15 * dt;

    if (Math.abs(proj.lateral) > WALL_LIMIT) {
      const sign = Math.sign(proj.lateral) || 1;
      const overflow = Math.abs(proj.lateral) - WALL_LIMIT;
      player.x -= sample.rx * sign * overflow;
      player.z -= sample.rz * sign * overflow;
      if (player.hitCd <= 0) {
        player.speed *= 0.6;
        player.lateral *= -0.2;
        mixer.hit();
        shake = Math.max(shake, 0.48);
        player.hitCd = 0.32;
      } else {
        player.speed *= 0.94;
      }
      project(track, player.x, player.z, player.idx, proj);
      player.idx = proj.index;
    }
    if (player.hitCd > 0) player.hitCd -= dt;

    const newS = track.samples[proj.index].s;
    let ds = newS - player.s;
    if (ds < -track.length / 2) ds += track.length;
    if (ds > track.length / 2) ds -= track.length;
    const prevS = player.s;
    player.s = newS;
    player.y = track.samples[proj.index].y;

    const near = proj.dist < ROAD_HALF + 2.5;
    if (near && ds > 0.02 && ds < 40) {
      for (const cp of track.checkpoints) {
        if (!crosses(prevS, ds, cp.s, track.length)) continue;
        if (cp.index !== player.next) continue;
        player.lastS = (cp.s + 8) % track.length;
        if (cp.index === 0) {
          player.lapTimes.push(player.lapTime);
          if (bestLap == null || player.lapTime < bestLap) bestLap = player.lapTime;
          player.lapTime = 0;
          player.laps += 1;
          player.next = 1;
          if (player.laps >= TOTAL_LAPS) finishRace();
          else {
            announce = `VOLTA ${player.laps + 1}`;
            announceT = 1.15;
            mixer.lap();
            persist();
          }
        } else {
          player.next = (cp.index + 1) % track.checkpoints.length;
        }
      }
    }

    const along =
      (fx * player.speed + rx * player.lateral) * sample.tx +
      (fz * player.speed + rz * player.lateral) * sample.tz;
    if (player.speed > 6 && along < -4) player.wrong += dt;
    else player.wrong = Math.max(0, player.wrong - dt * 2);

    if (player.drifting && Math.abs(player.speed) > 10) {
      for (const side of [-1, 1]) {
        emitSpark(
          player.x - fx * 1.55 + rx * side * 0.75,
          player.y + 0.35,
          player.z - fz * 1.55 + rz * side * 0.75,
          -fx * 2 + rx * side * 1.5,
          1.2 + Math.random(),
          -fz * 2 + rz * side * 1.5,
        );
      }
    }

    raceTime += dt;
    player.lapTime += dt;
    if (announceT > 0) announceT -= dt;

    const progress = player.laps * track.length + player.s;
    for (const ai of ais) {
      sampleAt(track, ai.s, aiPose);
      const corner = clamp(Math.abs(aiPose.curvature) * 36, 0, 1);
      let target = ai.base * (1 - corner * 0.4);
      const gap = progress - (ai.lap * track.length + ai.s);
      target *= 1 + clamp(gap / 150, -1, 1) * 0.1;
      target = clamp(target, 16, 38);
      ai.speed += (target - ai.speed) * Math.min(1, dt * 1.4);
      ai.s += ai.speed * dt;
      if (ai.s >= track.length) {
        ai.s -= track.length;
        ai.lap += 1;
      }
    }

    for (const ai of ais) {
      sampleAt(track, ai.s, aiPose);
      const ax = aiPose.x + aiPose.rx * ai.offset;
      const az = aiPose.z + aiPose.rz * ai.offset;
      const dx = player.x - ax;
      const dz = player.z - az;
      const d = Math.hypot(dx, dz);
      if (d < 2.15 && d > 0.001) {
        const push = (2.15 - d) * 0.65;
        player.x += (dx / d) * push;
        player.z += (dz / d) * push;
        if (player.speed > ai.speed) ai.s = Math.max(0, ai.s - push * 0.45);
      }
    }

    playerRig.tail.emissiveIntensity = brake ? 2.2 : 0.55;
    snapVisuals(steer);
  }

  function updateSparks(dt: number) {
    let alive = false;
    for (let i = 0; i < SPARK_N; i++) {
      if (sparkLife[i] <= 0) continue;
      sparkLife[i] -= dt;
      if (sparkLife[i] <= 0) {
        sparkPos[i * 3 + 1] = -80;
        continue;
      }
      alive = true;
      sparkPos[i * 3] += sparkVel[i * 3] * dt;
      sparkPos[i * 3 + 1] += sparkVel[i * 3 + 1] * dt;
      sparkPos[i * 3 + 2] += sparkVel[i * 3 + 2] * dt;
      sparkVel[i * 3 + 1] -= 6 * dt;
    }
    if (alive) {
      const attr = sparkGeo.getAttribute("position") as THREE.BufferAttribute;
      attr.needsUpdate = true;
    }
  }

  function updateCamera(dt: number) {
    const fx = -Math.sin(player.yaw);
    const fz = -Math.cos(player.yaw);
    if (phase === "menu") {
      const s = (elapsed * 28) % track.length;
      sampleAt(track, s, pose);
      sampleAt(track, s + 46, aiPose);
      desired.set(pose.x - pose.rx * 22 - pose.tx * 8, pose.y + 32, pose.z - pose.rz * 22 - pose.tz * 8);
      lookT.set(aiPose.x, aiPose.y + 0.5, aiPose.z);
    } else if (camMode === "hood") {
      desired.set(player.x + fx * 0.9, player.y + 1.25, player.z + fz * 0.9);
      lookT.set(player.x + fx * 16, player.y + 1.05, player.z + fz * 16);
    } else {
      const follow = 9.4;
      const height = 4.05;
      desired.set(player.x - fx * follow, player.y + height, player.z - fz * follow);
      project(track, desired.x, desired.z, player.idx, proj);
      if (Math.abs(proj.lateral) > WALL_LIMIT - 0.4 && proj.dist < 18) {
        desired.set(player.x - fx * 5.2, player.y + height + 1.2, player.z - fz * 5.2);
      }
      lookT.set(player.x + fx * 7.5, player.y + 1.25, player.z + fz * 7.5);
    }
    const k = 1 - Math.exp(-(phase === "menu" ? 1.6 : camMode === "hood" ? 10 : 3.4) * dt);
    const lk = 1 - Math.exp(-7 * dt);
    camPos.lerp(desired, k);
    look.lerp(lookT, lk);
    camera.position.copy(camPos);
    if (shake > 0 && phase === "race") {
      camera.position.x += (Math.random() - 0.5) * shake;
      camera.position.y += (Math.random() - 0.5) * shake * 0.5;
      shake = Math.max(0, shake - dt * 1.7);
    }
    camera.lookAt(look);
    spot.position.set(player.x + fx * 1.15, player.y + 0.75, player.z + fz * 1.15);
    spot.target.position.set(player.x + fx * 22, player.y + 0.3, player.z + fz * 22);
    const fovTarget = camMode === "hood" ? 76 : 60 + Math.min(16, Math.abs(player.speed) * 0.32) + (player.boost > 0 ? 6 : 0);
    if (Math.abs(camera.fov - fovTarget) > 0.25) {
      camera.fov += (fovTarget - camera.fov) * Math.min(1, dt * 4);
      camera.updateProjectionMatrix();
    }
  }

  function drawMap() {
    const map = hudRef.current.map;
    if (!map || (phase !== "race" && phase !== "paused")) return;
    const ctx = map.getContext("2d");
    if (!ctx) return;
    const w = map.width;
    const h = map.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(12,18,24,0.8)";
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, 12);
    ctx.fill();
    const b = track.bounds;
    const pad = 14;
    const sc = Math.min((w - pad * 2) / (b.maxX - b.minX), (h - pad * 2) / (b.maxZ - b.minZ));
    const ox = (w - (b.maxX - b.minX) * sc) / 2;
    const oy = (h - (b.maxZ - b.minZ) * sc) / 2;
    const X = (x: number) => ox + (x - b.minX) * sc;
    const Y = (z: number) => oy + (z - b.minZ) * sc;
    ctx.beginPath();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = "#8e968c";
    ctx.lineWidth = 7;
    track.samples.forEach((s, i) => {
      const px = X(s.x);
      const py = Y(s.z);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.stroke();
    ctx.strokeStyle = "#e8a04a";
    ctx.lineWidth = 2;
    ctx.stroke();
    const dots: { x: number; z: number; color: string; you?: boolean; yaw?: number }[] = [
      ...ais.map((ai, i) => {
        sampleAt(track, ai.s, aiPose);
        return {
          x: aiPose.x + aiPose.rx * ai.offset,
          z: aiPose.z + aiPose.rz * ai.offset,
          color: ["#c44932", "#8eae98", "#f3efe4"][i] ?? "#fff",
        };
      }),
    ];
    for (const d of dots) {
      ctx.fillStyle = d.color;
      ctx.beginPath();
      ctx.arc(X(d.x), Y(d.z), 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.save();
    ctx.translate(X(player.x), Y(player.z));
    ctx.rotate(-player.yaw);
    ctx.fillStyle = "#e8a04a";
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 6);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function updateHud() {
    const hud = hudRef.current;
    if (hud.speed) hud.speed.textContent = String(Math.round(Math.abs(player.speed) * 6.8));
    if (hud.lap) hud.lap.textContent = `${Math.min(TOTAL_LAPS, player.laps + (finished ? 0 : 1))}/${TOTAL_LAPS}`;
    if (hud.time) hud.time.textContent = formatTime(raceTime);
    if (hud.best) hud.best.textContent = formatTime(bestLap);
    const rows = standings();
    const place = Math.max(1, rows.findIndex((r) => r.you) + 1);
    if (hud.place) hud.place.textContent = `${place}º`;
    hud.rows.forEach((el, i) => {
      const r = rows[i];
      if (!el || !r) return;
      el.textContent = `${i + 1}  ${r.name}`;
      el.classList.toggle("text-primary", r.you);
      el.classList.toggle("text-muted", !r.you);
    });
    if (hud.drift) {
      const t = clamp(player.charge / 1.4, 0, 1);
      hud.drift.style.transform = `scaleX(${t})`;
      hud.drift.classList.toggle("bg-clay", player.charge > 0.9);
      hud.drift.classList.toggle("bg-primary", player.charge <= 0.9);
    }
    if (hud.banner) {
      const text = player.wrong > 0.4 ? "SENTIDO ERRADO" : player.boost > 0.08 ? "TURBO" : announceT > 0 ? announce : "";
      hud.banner.textContent = text;
      hud.banner.style.opacity = text ? "1" : "0";
    }
    if (hud.boost) hud.boost.style.opacity = player.boost > 0 ? "0.55" : "0";
  }

  const mixer: Mixer = createMixer();
  mixer.setVolume(save.volume);

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w < 2 || h < 2) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(() => resize());
  ro.observe(canvas);
  resize();

  const timer = new THREE.Timer();
  timer.connect(document);
  let raf = 0;
  let dead = false;

  function frame(now: number) {
    if (dead) return;
    raf = requestAnimationFrame(frame);
    timer.update(now);
    const frameDt = Math.min(timer.getDelta(), 0.1);
    if (frameDt <= 0) {
      renderer.render(scene, camera);
      return;
    }
    elapsed += frameDt;
    if (phase === "race" && !finished) {
      acc += frameDt;
      let steps = 0;
      while (acc >= STEP && steps < 8) {
        simulate(STEP);
        acc -= STEP;
        steps++;
      }
      if (steps === 8) acc = 0;
      mixer.update(player.speed, held("KeyW") || held("ArrowUp") ? 1 : 0, player.drifting, player.boost > 0);
    } else {
      mixer.update(phase === "menu" ? 8 : 0, phase === "menu" ? 0.3 : 0, false, false);
      if (phase !== "race") snapVisuals(0);
    }
    updateSparks(frameDt);
    updateCamera(frameDt);
    updateHud();
    drawMap();
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(frame);

  function onKeyDown(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
    keys.add(e.code);
    if (e.repeat) return;
    if (e.code === "Escape") {
      if (phase === "race") pause();
      else if (phase === "paused") resume();
    } else if (e.code === "KeyR" && phase === "race") respawn();
    else if (e.code === "KeyC" && phase === "race") camMode = camMode === "chase" ? "hood" : "chase";
    else if (e.code === "Enter" && (phase === "menu" || phase === "finish")) start();
  }
  function onKeyUp(e: KeyboardEvent) {
    keys.delete(e.code);
  }
  function onBlur() {
    keys.clear();
  }
  function onVis() {
    if (document.visibilityState === "visible") mixer.unlock();
    else keys.clear();
  }
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  document.addEventListener("visibilitychange", onVis);

  function start() {
    mixer.unlock();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    resetRace();
    phase = "race";
    setLights(true);
    announce = "VAI";
    announceT = 0.9;
    hooksRef.current.onPhase("race");
  }
  function pause() {
    if (phase !== "race") return;
    phase = "paused";
    hooksRef.current.onPhase("paused");
  }
  function resume() {
    if (phase !== "paused") return;
    mixer.unlock();
    phase = "race";
    hooksRef.current.onPhase("race");
  }
  function toMenu() {
    phase = "menu";
    resetRace();
    hooksRef.current.onPhase("menu");
  }

  if (import.meta.env.DEV) {
    window.__controlsTest = {
      getYaw: () => player.yaw,
      getSpeed: () => player.speed,
      setSteer: (v: number) => {
        steerOverride = v;
      },
      setKeys: (codes: string[]) => {
        scripted = new Set(codes);
      },
    };
  }

  resetRace();
  hooksRef.current.onRecord({ version: 1, bestLap, bestRace, volume: save.volume });
  void document.fonts?.ready.then(() => {
    paintSign(signTex.ctx, signTex.canvas.width, signTex.canvas.height);
    signTex.tex.needsUpdate = true;
  });

  return {
    start,
    pause,
    resume,
    restart: start,
    toMenu,
    hold(code: string, down: boolean) {
      if (down) keys.add(code);
      else keys.delete(code);
    },
    setVolume(v: number) {
      save.volume = clamp(v, 0, 1);
      mixer.setVolume(save.volume);
      persist();
    },
    setMuted(m: boolean) {
      mixer.setMuted(m);
    },
    dispose() {
      dead = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      timer.disconnect();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVis);
      mixer.dispose();
      if (window.__controlsTest?.getYaw && import.meta.env.DEV) delete window.__controlsTest;
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
    },
  };
}
