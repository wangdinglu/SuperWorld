import * as THREE from "three/webgpu";
import type { Part, ResolvedStyle, Scene, Template, TemplateLibrary } from "@superworld/schema";
import { colourOf, LIGHT_RIGS } from "@superworld/style";
import { placePart } from "@superworld/core";

export interface BuiltPlace {
  root: THREE.Group;
  sun: THREE.DirectionalLight;
  /** Meshes the pointer can hit for tap-to-move (the ground). */
  pickables: THREE.Object3D[];
  dispose(): void;
}

/** Curve detail per form topic: low-poly is faceted, voxel turns every shape into boxes. */
function segments(style: ResolvedStyle): number {
  return style.form === "lowpoly" ? 7 : style.form === "voxel" ? 4 : 24;
}

function geometryFor(part: Part, style: ResolvedStyle): THREE.BufferGeometry {
  const seg = segments(style);
  if (style.form === "voxel" && part.shape !== "box") {
    const r = part.radius;
    const h = part.shape === "sphere" ? r * 2 : part.height;
    return new THREE.BoxGeometry(r * 1.8, h, r * 1.8);
  }
  switch (part.shape) {
    case "box":
      return new THREE.BoxGeometry(...part.size);
    case "cylinder":
      return new THREE.CylinderGeometry(
        part.radius,
        part.radius,
        part.height,
        Math.max(seg, part.radius > 4 ? 48 : seg),
      );
    case "sphere":
      return new THREE.SphereGeometry(part.radius, seg, Math.max(4, Math.round(seg * 0.6)));
    case "cone":
      return new THREE.ConeGeometry(part.radius, part.height, seg);
  }
}

const materialCache = new Map<string, THREE.Material>();

/** Library materials per surface topic. Shared and cached, so many objects cost few materials. */
export function materialFor(
  colour: string,
  style: ResolvedStyle,
  emissive = false,
): THREE.Material {
  const key = `${colour}|${style.surface}|${style.form}|${emissive}`;
  const cached = materialCache.get(key);
  if (cached) return cached;
  const flatShading = style.form === "lowpoly";
  let material: THREE.Material;
  if (emissive) {
    material = new THREE.MeshBasicMaterial({ color: colour });
  } else if (style.surface === "toon" || style.surface === "ink") {
    material = new THREE.MeshToonMaterial({
      color:
        style.surface === "ink"
          ? new THREE.Color(colour).lerp(new THREE.Color("#ffffff"), 0.55)
          : colour,
    });
  } else if (style.surface === "pbr") {
    material = new THREE.MeshStandardMaterial({
      color: colour,
      roughness: 0.6,
      metalness: 0.1,
      flatShading,
    });
  } else {
    material = new THREE.MeshLambertMaterial({ color: colour, flatShading });
  }
  materialCache.set(key, material);
  return material;
}

function skyDome(style: ResolvedStyle): THREE.Mesh {
  const rig = LIGHT_RIGS[style.light];
  const geometry = new THREE.SphereGeometry(400, 24, 12);
  const top = new THREE.Color(rig.skyTop);
  const bottom = new THREE.Color(rig.skyBottom);
  const colours: number[] = [];
  const pos = geometry.attributes.position!;
  for (let i = 0; i < pos.count; i++) {
    const t = Math.max(0, pos.getY(i) / 400);
    const c = bottom.clone().lerp(top, Math.pow(t, 0.6));
    colours.push(c.r, c.g, c.b);
  }
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
    }),
  );
  mesh.renderOrder = -1;
  return mesh;
}

/**
 * Builds the visible side of a place from its scene file. Repeated template parts become one
 * InstancedMesh each, so a plaza of ~70 objects draws in a few dozen calls.
 */
export function buildPlace(
  scene: Scene,
  library: TemplateLibrary,
  style: ResolvedStyle,
): BuiltPlace {
  const root = new THREE.Group();
  root.name = `place:${scene.place}`;
  const rig = LIGHT_RIGS[style.light];
  const disposables: { dispose(): void }[] = [];

  root.add(skyDome(style));

  const hemi = new THREE.HemisphereLight(
    rig.ambient,
    colourOf("ground", style),
    rig.ambientIntensity,
  );
  root.add(hemi);
  const sun = new THREE.DirectionalLight(rig.sun, rig.sunIntensity);
  sun.position.set(rig.sunDir[0] * 60, rig.sunDir[1] * 60, rig.sunDir[2] * 60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const cam = sun.shadow.camera as THREE.OrthographicCamera;
  cam.left = cam.bottom = -40;
  cam.right = cam.top = 40;
  cam.near = 1;
  cam.far = 200;
  root.add(sun, sun.target);

  const groundGeometry = new THREE.CircleGeometry(scene.environment.ground.radius, 96).rotateX(
    -Math.PI / 2,
  );
  const ground = new THREE.Mesh(
    groundGeometry,
    materialFor(colourOf(scene.environment.ground.colour, style), style),
  );
  ground.receiveShadow = true;
  ground.name = "ground";
  root.add(ground);
  disposables.push(groundGeometry);

  const templates = new Map<string, Template>(library.templates.map((t) => [t.id, t]));
  const byTemplate = new Map<string, Scene["instances"]>();
  for (const inst of scene.instances) {
    const list = byTemplate.get(inst.template) ?? [];
    list.push(inst);
    byTemplate.set(inst.template, list);
  }

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  for (const [templateId, instances] of byTemplate) {
    const template = templates.get(templateId);
    if (!template) continue;
    template.parts.forEach((part, index) => {
      const geometry = geometryFor(part, style);
      disposables.push(geometry);
      const material = materialFor(colourOf(part.colour, style), style, part.emissive);
      const mesh = new THREE.InstancedMesh(geometry, material, instances.length);
      mesh.name = `${templateId}#${index}`;
      instances.forEach((inst, i) => {
        const placed = placePart(part, inst.at, inst.yaw, inst.scale);
        q.setFromAxisAngle(up, placed.yaw);
        m.compose(
          new THREE.Vector3(...placed.pos),
          q,
          new THREE.Vector3(inst.scale, inst.scale, inst.scale),
        );
        mesh.setMatrixAt(i, m);
      });
      mesh.castShadow = !part.emissive && part.shape !== "cylinder" ? true : part.solid;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      root.add(mesh);
    });
  }

  return {
    root,
    sun,
    pickables: [ground],
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}

/** Fog colour and range for the light topic. */
export function fogFor(style: ResolvedStyle): THREE.Fog {
  const rig = LIGHT_RIGS[style.light];
  const near = style.atmosphere === "mist" ? 10 : 70;
  const far = style.atmosphere === "mist" ? 90 : 260;
  return new THREE.Fog(rig.fog, near, far);
}
