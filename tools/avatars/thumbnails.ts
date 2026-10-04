// Renders each avatar with three.js and three-vrm (the same WebGPU/node-material path the game
// uses) in headless Chromium, and saves content/avatars/<id>.png thumbnails for the avatar picker.
// Run `pnpm avatars` afterwards to embed the thumbnails in the VRM files.
//
//   pnpm avatars:thumbnails                 thumbnails for every avatar
//   pnpm avatars:thumbnails --review <dir>  also a sheet per avatar (views, pose, every expression)
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, extname, join } from "node:path";
import { chromium } from "@playwright/test";
import { AvatarLibrary } from "@superworld/schema";
import { LIGHT_RIGS, PALETTES } from "@superworld/style";

const root = join(import.meta.dirname, "..", "..");
const avatarDir = join(root, "content", "avatars");
const library = AvatarLibrary.parse(
  JSON.parse(readFileSync(join(avatarDir, "avatars.json"), "utf8")),
);
const reviewAt = process.argv.indexOf("--review");
const reviewDir = reviewAt >= 0 ? process.argv[reviewAt + 1] : undefined;

// Serve the avatars plus three.js and three-vrm as the render package resolves them.
const fromRender = createRequire(join(root, "packages", "render", "package.json"));
// Both entry points live one folder down (three/build/, three-vrm/lib/).
const threeDir = dirname(dirname(fromRender.resolve("three")));
const vrmDir = dirname(dirname(fromRender.resolve("@pixiv/three-vrm")));
const mounts: Record<string, string> = {
  "/three/": threeDir + "/",
  "/vrm/": vrmDir + "/",
  "/avatars/": avatarDir + "/",
};

const rig = LIGHT_RIGS.noon;
const page = /* html */ `<!doctype html><html><body style="margin:0;background:transparent">
<script type="importmap">{"imports":{
  "three":"/three/build/three.module.js",
  "three/webgpu":"/three/build/three.webgpu.js",
  "three/tsl":"/three/build/three.tsl.js",
  "three/addons/":"/three/examples/jsm/",
  "@pixiv/three-vrm":"/vrm/lib/three-vrm.module.js",
  "@pixiv/three-vrm/nodes":"/vrm/lib/nodes/index.module.js"}}</script>
<script type="module">
import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MToonMaterialLoaderPlugin, VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import { MToonNodeMaterial } from "@pixiv/three-vrm/nodes";
const SIZE = 512;
const renderer = new THREE.WebGPURenderer({ antialias: true, alpha: true });
renderer.setSize(SIZE, SIZE);
renderer.setClearColor(0x000000, 0);
await renderer.init();
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(${JSON.stringify(rig.ambient)}, "#b9d48a", ${rig.ambientIntensity}));
const sun = new THREE.DirectionalLight(${JSON.stringify(rig.sun)}, ${rig.sunIntensity});
sun.position.set(${rig.sunDir.map((v) => v * 10).join(",")});
scene.add(sun);
// The same sky-gradient environment the game gives physically based avatar materials.
const sky = (() => {
  const w = 32, h = 16, data = new Uint8Array(w * h * 4);
  const top = new THREE.Color(${JSON.stringify(rig.skyTop)}), horizon = new THREE.Color(${JSON.stringify(rig.skyBottom)});
  const ground = new THREE.Color("#b9d48a"), c = new THREE.Color(), rgb = {};
  for (let y = 0; y < h; y++) {
    const v = y / (h - 1);
    if (v < 0.5) c.copy(ground).lerp(horizon, Math.pow(v * 2, 3));
    else c.copy(horizon).lerp(top, Math.pow((v - 0.5) * 2, 0.6));
    c.getRGB(rgb, THREE.SRGBColorSpace);
    for (let x = 0; x < w; x++) data.set([rgb.r * 255, rgb.g * 255, rgb.b * 255, 255], (y * w + x) * 4);
  }
  const t = new THREE.DataTexture(data, w, h);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
})();
const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 20);
const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser, {
  mtoonMaterialPlugin: new MToonMaterialLoaderPlugin(parser, { materialType: MToonNodeMaterial }),
}));
let vrm;
window.load = async (url) => {
  if (vrm) { scene.remove(vrm.scene); VRMUtils.deepDispose(vrm.scene); }
  vrm = (await loader.loadAsync(url)).userData.vrm;
  VRMUtils.rotateVRM0(vrm);
  vrm.scene.traverse((o) => {
    for (const m of [o.material ?? []].flat()) if (m.isMeshStandardMaterial) m.envMap = sky;
  });
  scene.add(vrm.scene);
  const box = new THREE.Box3().setFromObject(vrm.scene);
  return { height: box.max.y, style: vrm.scene.userData.superworld,
    expressions: vrm.expressionManager.expressions.length, springs: vrm.springBoneManager?.joints.size ?? 0 };
};
function pose(name) {
  const h = vrm.humanoid;
  for (const b of Object.keys(h.humanBones)) h.getNormalizedBoneNode(b)?.rotation.set(0, 0, 0);
  const n = (b) => h.getNormalizedBoneNode(b);
  if (name === "rest") { n("leftUpperArm").rotation.z = -1.1; n("rightUpperArm").rotation.z = 1.1; }
  if (name === "wave") {
    n("leftUpperArm").rotation.z = -1.1; n("rightUpperArm").rotation.z = -1.2;
    n("rightLowerArm").rotation.z = -0.6; n("head").rotation.z = 0.12;
  }
  if (name === "walk") {
    n("leftUpperArm").rotation.set(0.5, 0, -1.15); n("rightUpperArm").rotation.set(-0.5, 0, 1.15);
    n("leftUpperLeg").rotation.x = -0.5; n("leftLowerLeg").rotation.x = 0.3; n("rightUpperLeg").rotation.x = 0.45;
  }
  // VRM 0.x normalized bones live in the 0.x frame: the same pose has x and z negated.
  if (vrm.meta.metaVersion === "0") {
    for (const b of Object.keys(h.humanBones)) {
      const r = h.getNormalizedBoneNode(b)?.rotation;
      r?.set(-r.x, r.y, -r.z);
    }
  }
}
async function render(o) {
  const ex = vrm.expressionManager;
  for (const e of ex.expressions) ex.setValue(e.expressionName, 0);
  for (const [k, v] of Object.entries(o.expr ?? {})) ex.setValue(k, v);
  pose(o.pose ?? "rest");
  vrm.scene.rotation.y = o.yaw ?? 0;
  const h = window.height;
  if (o.face) { camera.position.set(0, h * 0.74, 1.5); camera.lookAt(0, h * 0.72, 0); }
  else { camera.position.set(0, h * 0.55, 4.1); camera.lookAt(0, h * 0.5, 0); }
  for (let i = 0; i < 30; i++) vrm.update(1 / 30);
  // Render from the animation loop: the node renderer refreshes skinning once per loop frame.
  await new Promise((done) => renderer.setAnimationLoop(() => {
    renderer.render(scene, camera);
    o.after?.();
    renderer.setAnimationLoop(null);
    done();
  }));
}
window.thumbnail = async () => {
  let url;
  await render({ yaw: 0.45, expr: { happy: 0.35 }, after: () => (url = renderer.domElement.toDataURL("image/png")) });
  return url;
};
window.sheet = async (cells, cols, bg) => {
  const cell = 256, rows = Math.ceil(cells.length / cols);
  const out = document.createElement("canvas"); out.width = cols * cell; out.height = rows * cell;
  const g = out.getContext("2d"); g.fillStyle = bg; g.fillRect(0, 0, out.width, out.height);
  g.font = "16px sans-serif"; g.fillStyle = "#000";
  for (let i = 0; i < cells.length; i++) {
    await render({ ...cells[i], after: () =>
      g.drawImage(renderer.domElement, (i % cols) * cell, Math.floor(i / cols) * cell, cell, cell) });
    g.fillText(cells[i].label, (i % cols) * cell + 8, Math.floor(i / cols) * cell + 20);
  }
  return out.toDataURL("image/png");
};
window.ready = true;
</script></body></html>`;

const types: Record<string, string> = {
  ".js": "text/javascript",
  ".vrm": "model/gltf-binary",
  ".html": "text/html",
};
const server = createServer((req, res) => {
  const path = decodeURIComponent((req.url ?? "/").split("?")[0]!);
  if (path === "/") {
    res.writeHead(200, { "content-type": "text/html" }).end(page);
    return;
  }
  const mount = Object.keys(mounts).find((m) => path.startsWith(m));
  try {
    if (!mount || path.includes("..")) throw new Error("not found");
    const body = readFileSync(mounts[mount] + path.slice(mount.length));
    res
      .writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream" })
      .end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise<void>((r) => server.listen(0, r));
const port = (server.address() as { port: number }).port;

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
try {
  const tab = await browser.newPage({ viewport: { width: 600, height: 600 } });
  tab.on("pageerror", (e) => console.error("page error:", e.message));
  await tab.goto(`http://localhost:${port}/`);
  await tab.waitForFunction(() => (window as unknown as { ready?: boolean }).ready, null, {
    timeout: 60_000,
  });
  const save = (file: string, dataUrl: string) =>
    writeFileSync(file, Buffer.from(dataUrl.split(",")[1]!, "base64"));

  for (const avatar of library.avatars) {
    const info = await tab.evaluate(async (url) => {
      const w = window as unknown as {
        load(u: string): Promise<{ height: number }>;
        height: number;
      };
      const result = await w.load(url);
      w.height = result.height;
      return result;
    }, `/avatars/${avatar.file}`);
    console.log(`${avatar.id}: ${JSON.stringify(info)}`);
    save(
      join(avatarDir, `${avatar.id}.png`),
      await tab.evaluate(() => (window as unknown as { thumbnail(): Promise<string> }).thumbnail()),
    );
    if (reviewDir) {
      const views = [
        { label: "front", yaw: 0 },
        { label: "3/4", yaw: 0.7, pose: "walk" },
        { label: "side", yaw: Math.PI / 2 },
        { label: "back", yaw: Math.PI, pose: "wave" },
        { label: "T-pose", pose: "tpose" },
      ];
      const faces = [
        "neutral",
        "blink",
        "blinkLeft",
        "happy",
        "angry",
        "sad",
        "relaxed",
        "surprised",
        "aa",
        "ih",
        "ou",
        "ee",
        "oh",
      ].map((e) => ({ label: e, face: true, expr: { [e]: 1 } }));
      const bg = avatar.style.colour ? PALETTES[avatar.style.colour].ground : "#dde3ec";
      save(
        join(reviewDir, `${avatar.id}-sheet.png`),
        await tab.evaluate(
          ([cells, bg]) =>
            (
              window as unknown as { sheet(c: unknown, n: number, bg: string): Promise<string> }
            ).sheet(cells, 6, bg),
          [[...views, ...faces], bg] as const,
        ),
      );
    }
  }
} finally {
  await browser.close();
  server.close();
}
