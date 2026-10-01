// Construye un vehículo paramétrico a partir de una configuración de vehicle-configs.js.
// Solo BoxGeometry subdividida (segmentos adaptativos) y cilindros para las ruedas. Las 13 piezas
// diagnosticables son THREE.Group con userData estructurado; el resto es carrocería o decoración.
import * as THREE from '../vendor/three/three.module.min.js';
import { segmentsFor } from './vehicle-configs.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function shapedBox(width, height, depth, deform) {
  const geometry = new THREE.BoxGeometry(
    width,
    height,
    depth,
    segmentsFor(width),
    segmentsFor(height),
    segmentsFor(depth),
  );
  if (deform) {
    const position = geometry.attributes.position,
      vertex = new THREE.Vector3();
    for (let i = 0; i < position.count; i++) {
      vertex.fromBufferAttribute(position, i);
      deform(vertex);
      position.setXYZ(i, vertex.x, vertex.y, vertex.z);
    }
    geometry.computeVertexNormals();
  }
  return geometry;
}

export function createMaterials(paintColor) {
  const paint = () =>
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      vertexColors: true,
      metalness: 0.72,
      roughness: 0.3,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
      envMapIntensity: 1.25,
    });
  const bodyPaint = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(paintColor),
    metalness: 0.72,
    roughness: 0.3,
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
    envMapIntensity: 1.25,
  });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x0c1522,
    transparent: true,
    opacity: 0.9,
    metalness: 0.55,
    roughness: 0.05,
    side: THREE.DoubleSide,
    envMapIntensity: 1.4,
  });
  const trim = new THREE.MeshStandardMaterial({ color: 0x0d1016, roughness: 0.62, metalness: 0.2 });
  const tire = new THREE.MeshStandardMaterial({ color: 0x0b0c0f, roughness: 0.92 });
  const rim = new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 1, roughness: 0.24 });
  const headlight = new THREE.MeshStandardMaterial({
    color: 0xe8f1ff,
    emissive: 0xbfd8ff,
    emissiveIntensity: 0.9,
    roughness: 0.15,
    metalness: 0.3,
  });
  const taillight = new THREE.MeshStandardMaterial({
    color: 0x5a0a12,
    emissive: 0xff2238,
    emissiveIntensity: 0.75,
    roughness: 0.25,
  });
  const plate = new THREE.MeshStandardMaterial({ color: 0xf2f4f7, roughness: 0.5 });
  for (const material of [bodyPaint, glass, trim, tire, rim, headlight, taillight, plate])
    material.userData.baseOpacity = material.opacity;
  return { paint, bodyPaint, glass, trim, tire, rim, headlight, taillight, plate };
}

export function buildVehicle(cfg, { paintColor, labels = {} } = {}) {
  const materials = createMaterials(paintColor);
  const root = new THREE.Group();
  root.name = `vehiculo-${cfg.key}`;
  const parts = new Map();
  const decor = [];
  const W = cfg.width,
    L = cfg.length,
    front = L / 2,
    rear = -L / 2;
  const bumperTop = cfg.bumperY + cfg.bumperH / 2;
  const hoodFrontZ = front - 0.13;
  const tailTopY = cfg.hatch
    ? cfg.trunkY + (Math.sin(cfg.trunkTilt) * cfg.trunkLen) / 2
    : cfg.beltY;
  const topProfile = (z) => {
    if (z >= cfg.cowlZ)
      return (
        cfg.cowlY +
        (cfg.noseY - cfg.cowlY) * clamp((z - cfg.cowlZ) / (hoodFrontZ - cfg.cowlZ), 0, 1)
      );
    if (z >= cfg.glassBaseZ) return cfg.beltY;
    const rearEnd = rear + 0.13;
    const startY = cfg.hatch ? tailTopY : cfg.beltY,
      endY = cfg.hatch ? bumperTop : cfg.trunkY - (Math.sin(cfg.trunkTilt) * cfg.trunkLen) / 2;
    return (
      startY + (endY - startY) * clamp((cfg.glassBaseZ - z) / (cfg.glassBaseZ - rearEnd), 0, 1)
    );
  };

  function addDecor(mesh, role, parent = root) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.role = role;
    parent.add(mesh);
    decor.push(mesh);
    return mesh;
  }

  function addPart(code, geometry, { position, rotation = [0, 0, 0], normal, size }) {
    const material = materials.paint();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.role = 'part';
    const group = new THREE.Group();
    group.name = code;
    group.add(mesh);
    group.position.set(...position);
    group.rotation.set(...rotation);
    const count = geometry.attributes.position.count;
    const colors = new Float32Array(count * 3);
    const base = new THREE.Color(paintColor);
    for (let i = 0; i < count; i++) colors.set([base.r, base.g, base.b], i * 3);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    group.userData = {
      isPart: true,
      partId: code,
      partName: labels[code] || code,
      pressure: 0,
      meshes: [mesh],
      paintColor,
      originalVertexColorsData: colors.slice(),
      hasDamage: false,
      size: new THREE.Vector3(...size),
      normal: new THREE.Vector3(...normal).normalize(),
      basePosition: group.position.clone(),
      baseQuaternion: group.quaternion.clone(),
    };
    root.add(group);
    parts.set(code, group);
    return group;
  }

  // Carrocería interior: da volumen y cierra los huecos entre paneles.
  const coreHalf = W / 2 - 0.05;
  const coreBottom = (z) => Math.min(2 * cfg.wheelR + 0.08, topProfile(z) - 0.1);
  const upper = new THREE.Mesh(
    shapedBox(W - 0.1, 1, L - 0.26, (v) => {
      const z = v.z;
      v.y = v.y > 0 ? topProfile(z) - 0.03 : coreBottom(z);
    }),
    materials.bodyPaint,
  );
  addDecor(upper, 'body');
  addDecor(
    new THREE.Mesh(
      shapedBox(W - 0.58, 1, L - 0.46, (v) => {
        v.y = v.y > 0 ? coreBottom(v.z) + 0.02 : cfg.clearance + 0.04;
      }),
      materials.trim,
    ),
    'trim',
  );
  const fascia = (z, top) => {
    const height = Math.max(0.04, top - bumperTop + 0.03);
    const mesh = new THREE.Mesh(shapedBox(W * 0.97, height, 0.15), materials.bodyPaint);
    mesh.position.set(0, bumperTop - 0.03 + height / 2, z);
    return addDecor(mesh, 'body');
  };
  fascia(front - 0.125, cfg.noseY - 0.01);
  if (!cfg.hatch) fascia(rear + 0.13, topProfile(rear + 0.14) - 0.01);

  // Cabina: cristales en trapecio con caída lateral (tumblehome).
  const bPillarZ = cfg.doorFrontZ - cfg.doorFrontLen / 2 - 0.01;
  const cabinRearBase = cfg.cargo ? bPillarZ : cfg.glassBaseZ + 0.02;
  const cabinRearTop = cfg.cargo ? bPillarZ : cfg.roofRearZ + 0.02;
  const greenhouse = new THREE.Mesh(
    shapedBox(1, 1, 1, (v) => {
      const t = v.y + 0.5;
      const zFront = THREE.MathUtils.lerp(cfg.cowlZ - 0.02, cfg.roofFrontZ - 0.02, t);
      const zRear = THREE.MathUtils.lerp(cabinRearBase, cabinRearTop, t);
      const half = THREE.MathUtils.lerp(W / 2 - 0.08, W / 2 - 0.17, t);
      v.x = v.x * 2 * half;
      v.z = THREE.MathUtils.lerp(zRear, zFront, v.z + 0.5);
      v.y = THREE.MathUtils.lerp(cfg.beltY - 0.01, cfg.roofY - 0.035, t);
    }),
    materials.glass,
  );
  addDecor(greenhouse, 'glass').castShadow = false;
  if (cfg.cargo) {
    const cargo = new THREE.Mesh(
      shapedBox(W - 0.1, cfg.roofY - cfg.beltY - 0.02, bPillarZ - (rear + 0.16)),
      materials.bodyPaint,
    );
    cargo.position.set(0, (cfg.roofY + cfg.beltY) / 2 - 0.02, (bPillarZ + rear + 0.16) / 2);
    addDecor(cargo, 'body');
  }
  const pillarHeight = cfg.roofY - cfg.beltY;
  const lean = Math.atan2(0.09, pillarHeight);
  const pillars = [bPillarZ];
  if (cfg.numDoors === 4 && !cfg.cargo) pillars.push(cfg.doorRearZ - cfg.doorRearLen / 2 - 0.02);
  for (const z of cfg.numDoors === 4 || cfg.cargo ? pillars : [])
    for (const side of [1, -1]) {
      const pillar = new THREE.Mesh(shapedBox(0.03, pillarHeight, 0.09), materials.trim);
      pillar.position.set(side * (W / 2 - 0.125), cfg.beltY + pillarHeight / 2, z);
      pillar.rotation.z = side * lean;
      addDecor(pillar, 'trim');
    }
  for (const side of [1, -1]) {
    const belt = new THREE.Mesh(
      shapedBox(0.03, 0.03, Math.max(0.2, cfg.cowlZ - cabinRearBase)),
      materials.trim,
    );
    belt.position.set(side * (W / 2 - 0.075), cfg.beltY + 0.005, (cfg.cowlZ + cabinRearBase) / 2);
    addDecor(belt, 'trim');
  }

  // Ruedas y pasos de rueda.
  for (const axle of [cfg.frontAxleZ, cfg.rearAxleZ])
    for (const side of [1, -1]) {
      const wheel = new THREE.Group();
      wheel.position.set(side * (W / 2 - cfg.wheelW / 2 - 0.035), cfg.wheelR, axle);
      const tire = new THREE.Mesh(
        new THREE.CylinderGeometry(cfg.wheelR, cfg.wheelR, cfg.wheelW, 40, 1),
        materials.tire,
      );
      tire.rotation.z = Math.PI / 2;
      addDecor(tire, 'wheel', wheel);
      const rimMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(cfg.wheelR * 0.64, cfg.wheelR * 0.64, cfg.wheelW + 0.012, 28, 1),
        materials.rim,
      );
      rimMesh.rotation.z = Math.PI / 2;
      addDecor(rimMesh, 'wheel', wheel);
      for (let spoke = 0; spoke < 5; spoke++) {
        const arm = new THREE.Mesh(shapedBox(0.02, cfg.wheelR * 1.12, 0.05), materials.trim);
        arm.position.x = side * (cfg.wheelW / 2 + 0.008);
        arm.rotation.x = (spoke / 5) * Math.PI;
        addDecor(arm, 'wheel', wheel);
      }
      root.add(wheel);
      const well = new THREE.Mesh(
        shapedBox(0.34, cfg.wheelR * 0.9, cfg.wheelR * 2.25),
        materials.trim,
      );
      well.position.set(side * (W / 2 - 0.22), cfg.wheelR * 1.62, axle);
      addDecor(well, 'trim');
    }
  for (const side of [1, -1]) {
    const start = cfg.frontAxleZ - cfg.wheelR - 0.08,
      end = cfg.rearAxleZ + cfg.wheelR + 0.08;
    const rocker = new THREE.Mesh(
      shapedBox(0.08, cfg.sillY - cfg.clearance - 0.04, start - end),
      materials.trim,
    );
    rocker.position.set(
      side * (W / 2 - 0.06),
      (cfg.sillY + cfg.clearance + 0.06) / 2,
      (start + end) / 2,
    );
    addDecor(rocker, 'trim');
  }

  // Piezas diagnosticables.
  const PANEL = 0.05;
  const crown = (width, amount) => (v) => {
    v.y += amount * (1 - Math.pow((2 * v.x) / width, 2));
  };
  addPart('hood', shapedBox(W - 0.12, PANEL, cfg.hoodLen, crown(W - 0.12, 0.028)), {
    position: [0, cfg.hoodY + PANEL / 2, cfg.hoodZ],
    rotation: [cfg.hoodTilt, 0, 0],
    normal: [0, Math.cos(cfg.hoodTilt), Math.sin(cfg.hoodTilt)],
    size: [W - 0.12, PANEL, cfg.hoodLen],
  });
  addPart('roof', shapedBox(W - 0.3, PANEL, cfg.roofLen, crown(W - 0.3, 0.035)), {
    position: [0, cfg.roofY, cfg.roofZ],
    normal: [0, 1, 0],
    size: [W - 0.3, PANEL, cfg.roofLen],
  });
  const trunkWidth = cfg.hatch ? W * 0.86 : W - 0.12;
  addPart(
    'trunk',
    shapedBox(trunkWidth, PANEL, cfg.trunkLen, crown(trunkWidth, cfg.hatch ? 0.02 : 0.025)),
    {
      position: [
        0,
        cfg.trunkY + (cfg.hatch ? 0 : PANEL / 2),
        cfg.trunkZ - (cfg.hatch ? PANEL / 2 : 0),
      ],
      rotation: [-cfg.trunkTilt, 0, 0],
      normal: [0, Math.cos(cfg.trunkTilt), -Math.sin(cfg.trunkTilt)],
      size: [trunkWidth, PANEL, cfg.trunkLen],
    },
  );

  const sidePanel = (length, height, centerZ, centerY, side, axleZ = null, bulge = 0.022) =>
    shapedBox(PANEL, height, length, (v) => {
      const z = centerZ + v.z;
      let y = centerY + v.y;
      if (axleZ !== null) {
        const radius = cfg.wheelR + 0.07,
          dz = z - axleZ;
        if (Math.abs(dz) < radius) {
          const arch = cfg.wheelR + Math.sqrt(radius * radius - dz * dz);
          if (y < arch) y = arch;
        }
        y = Math.min(y, topProfile(z) + 0.012);
      }
      v.y = y - centerY;
      const u = clamp((2 * v.z) / length, -1, 1),
        w = clamp((2 * (y - centerY)) / height, -1, 1);
      v.x += side * bulge * (1 - u * u) * (1 - 0.6 * w * w);
    });
  const sides = [
    ['left', 1],
    ['right', -1],
  ];
  for (const [name, side] of sides) {
    const x = side * (W / 2 - PANEL / 2);
    const doorPart = (code, length, z) => {
      const group = addPart(code, sidePanel(length, cfg.doorH, z, cfg.doorY, side), {
        position: [x, cfg.doorY, z],
        normal: [side, 0, 0],
        size: [PANEL, cfg.doorH, length],
      });
      const handle = new THREE.Mesh(shapedBox(0.025, 0.032, 0.15), materials.trim);
      handle.position.set(side * 0.04, cfg.doorH / 2 - 0.13, length * 0.22);
      addDecor(handle, 'trim', group);
      return group;
    };
    doorPart(`door_front_${name}`, cfg.doorFrontLen, cfg.doorFrontZ);
    if (cfg.numDoors === 4) doorPart(`door_rear_${name}`, cfg.doorRearLen, cfg.doorRearZ);
    addPart(
      `fender_front_${name}`,
      sidePanel(cfg.fenderLen, cfg.fenderH, cfg.fenderFrontZ, cfg.fenderY, side, cfg.frontAxleZ),
      {
        position: [x, cfg.fenderY, cfg.fenderFrontZ],
        normal: [side, 0, 0],
        size: [PANEL, cfg.fenderH, cfg.fenderLen],
      },
    );
    addPart(
      `fender_rear_${name}`,
      sidePanel(cfg.fenderRearLen, cfg.fenderH, cfg.fenderRearZ, cfg.fenderY, side, cfg.rearAxleZ),
      {
        position: [x, cfg.fenderY, cfg.fenderRearZ],
        normal: [side, 0, 0],
        size: [PANEL, cfg.fenderH, cfg.fenderRearLen],
      },
    );
    const mirror = new THREE.Mesh(shapedBox(0.17, 0.1, 0.09), materials.bodyPaint);
    mirror.position.set(
      side * (W / 2 + 0.075),
      cfg.beltY + 0.07,
      cfg.doorFrontZ + cfg.doorFrontLen / 2 - 0.1,
    );
    addDecor(mirror, 'body');
  }
  const bumper = (code, z, direction) =>
    addPart(
      code,
      shapedBox(W * 0.985, cfg.bumperH, cfg.bumperDepth, (v) => {
        const edge = Math.max(0, Math.abs(v.x) - W * 0.36) / (W * 0.13);
        v.z -= direction * 0.13 * edge * edge;
        v.z += direction * 0.02 * (1 - Math.pow((2 * v.y) / cfg.bumperH, 2));
      }),
      {
        position: [0, cfg.bumperY, z],
        normal: [0, 0, direction],
        size: [W * 0.985, cfg.bumperH, cfg.bumperDepth],
      },
    );
  bumper('bumper_front', front - cfg.bumperDepth / 2, 1);
  bumper('bumper_rear', rear + cfg.bumperDepth / 2, -1);

  // Luces, parrilla y chapas.
  for (const side of [1, -1]) {
    const head = new THREE.Mesh(shapedBox(0.34, 0.09, 0.07), materials.headlight);
    head.position.set(side * (W / 2 - 0.25), cfg.noseY - 0.075, front - 0.05);
    addDecor(head, 'light');
    const tail = new THREE.Mesh(
      cfg.hatch ? shapedBox(0.2, 0.26, 0.06) : shapedBox(0.36, 0.1, 0.06),
      materials.taillight,
    );
    tail.position.set(
      side * (W / 2 - (cfg.hatch ? 0.13 : 0.22)),
      cfg.hatch ? bumperTop + 0.2 : topProfile(rear + 0.14) - 0.08,
      rear + (cfg.hatch ? 0.12 : 0.1),
    );
    addDecor(tail, 'light');
  }
  const grille = new THREE.Mesh(
    shapedBox(W * 0.36, Math.max(0.05, (cfg.noseY - bumperTop) * 0.6), 0.04),
    materials.trim,
  );
  grille.position.set(0, (cfg.noseY + bumperTop) / 2 - 0.02, front - 0.045);
  addDecor(grille, 'trim');
  for (const [z, direction] of [
    [front + 0.012, 1],
    [rear - 0.012, -1],
  ]) {
    const plate = new THREE.Mesh(shapedBox(0.44, 0.12, 0.012), materials.plate);
    plate.position.set(0, cfg.bumperY, z - direction * 0.004);
    addDecor(plate, 'trim');
  }

  root.updateMatrixWorld(true);
  return { root, parts, decor, materials, config: cfg };
}
