// Estudio de diagnóstico 3D de MecanCloud. Lee y guarda el diagnóstico de la orden mediante la API
// del servidor (PostgreSQL); la escena es solo una vista: al recargar se reconstruye desde los datos.
import * as THREE from '../vendor/three/three.module.min.js';
import { OrbitControls } from '../vendor/three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from '../vendor/three/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from '../vendor/three/addons/loaders/GLTFLoader.js';
import {
  VEHICLE_MODELS,
  MODEL_KEYS,
  keyForBodyType,
  PAINT_PRESETS,
  SEVERITY_ORDER,
  SEVERITY_COLORS,
  BRUSH,
  pressureColor,
  pressureLabel,
  easeInOutCubic,
} from './vehicle-configs.js';
import { buildVehicle } from './vehicle-builder.js';
import {
  initDamageField,
  applyStamp,
  replayStrokes,
  clearField,
  paintPart,
  toStamp,
  describeZone,
} from './damage-painter.js';

const studio = document.querySelector('[data-studio]');
if (studio)
  start(studio).catch((error) => {
    console.error('[Auto3D] No se pudo iniciar el diagnóstico 3D.', error);
    studio.querySelector('.studio-loader')?.classList.add('is-hidden');
    const box = studio.querySelector('.studio-error');
    if (box) {
      box.hidden = false;
      box.textContent =
        'No se pudo iniciar el diagnóstico 3D. Recarga la página; los datos guardados se conservan.';
    }
  });

// ---------- utilidades de interfaz (sin innerHTML con datos del servidor) ----------
function h(tag, attributes = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === false || value == null) continue;
    if (key === 'class') element.className = value;
    else if (key === 'text') element.textContent = value;
    else if (key.startsWith('on')) element.addEventListener(key.slice(2), value);
    else if (key === 'style')
      for (const [name, rule] of Object.entries(value))
        name.startsWith('--')
          ? element.style.setProperty(name, rule)
          : (element.style[name] = rule);
    else element.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat())
    if (child != null && child !== false)
      element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return element;
}
const panel = (className, title, ...children) =>
  h(
    'section',
    { class: `studio-panel ${className}` },
    title ? h('h3', { text: title }) : null,
    ...children,
  );

async function start(root) {
  const stage = root.querySelector('.studio-stage');
  const loader = root.querySelector('.studio-loader');
  const errorBox = root.querySelector('.studio-error');
  const statusBox = root.querySelector('[data-save-status]');
  const api = root.dataset.api;
  const csrf = root.dataset.csrf;
  const showError = (message, error) => {
    if (error) console.error('[Auto3D]', message, error);
    errorBox.hidden = false;
    errorBox.textContent = message;
    loader?.classList.add('is-hidden');
  };
  const setStatus = (message, tone = '') => {
    if (!statusBox) return;
    statusBox.textContent = message;
    statusBox.dataset.tone = tone;
  };

  let data;
  try {
    const response = await fetch(api, {
      headers: { accept: 'application/json' },
      credentials: 'same-origin',
    });
    data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo leer el diagnóstico.');
  } catch (error) {
    return showError('No se pudo cargar el diagnóstico guardado. Recarga la página.', error);
  }

  const labels = Object.fromEntries(data.vocabulary.parts.map((part) => [part.code, part.label]));
  const severityLabels = Object.fromEntries(
    data.vocabulary.severities.map((s) => [s.code, s.label]),
  );
  const PART_CODES = data.vocabulary.parts.map((part) => part.code);
  const REAR_DOORS = data.vocabulary.parts.filter((part) => part.rearDoor).map((part) => part.code);
  const currency = data.currency || 'PYG';
  const moneyFormat = new Intl.NumberFormat('es-PY', { style: 'currency', currency });
  const moneyStep = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
    .maximumFractionDigits
    ? '0.01'
    : '1';
  const initialKey = keyForBodyType(data.assessment?.bodyType || data.vehicle.bodyType);
  const state = {
    bodyKey: initialKey,
    paintColor: data.assessment?.paintColor || VEHICLE_MODELS[initialKey].color,
    paintCustomized: Boolean(data.assessment),
    notes: data.assessment?.notes || '',
    parts: structuredClone(data.parts),
    revision: data.assessment?.revision || 0,
    editable: Boolean(data.permissions.edit),
    mode: 'vehicle',
    isolated: null,
    activePart: 'hood',
    brushSeverity: 'SEVERE',
    erase: false,
    brushRadius: BRUSH.initial,
    autoRotate: true,
    changes: 0,
    savedChanges: 0,
    saving: false,
    reference: null,
  };
  const partState = (code) => state.parts[code];
  const available = () =>
    PART_CODES.filter(
      (code) => VEHICLE_MODELS[state.bodyKey].numDoors === 4 || !REAR_DOORS.includes(code),
    );

  // ---------- escena ----------
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch (error) {
    return showError(
      'Este navegador no puede mostrar gráficos 3D (WebGL). El diagnóstico guardado sigue disponible en el resumen inferior.',
      error,
    );
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  stage.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  scene.add(new THREE.HemisphereLight(0x9dc4ff, 0x080c14, 0.55));
  const sun = new THREE.DirectionalLight(0xffffff, 2.3);
  sun.position.set(5, 9, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.normalBias = 0.025;
  Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 30 });
  scene.add(sun);
  const rimBlue = new THREE.DirectionalLight(0x3d7bff, 1.1);
  rimBlue.position.set(-7, 3, -5);
  const rimRed = new THREE.DirectionalLight(0xff4d6d, 0.9);
  rimRed.position.set(7, 2.5, -6);
  const fill = new THREE.DirectionalLight(0x88aaff, 0.45);
  fill.position.set(0, 2, 9);
  scene.add(rimBlue, rimRed, fill);
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(9, 72),
    new THREE.MeshStandardMaterial({ color: 0x0e131b, roughness: 0.78, metalness: 0.12 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(4.2, 4.24, 96),
    new THREE.MeshBasicMaterial({ color: 0x3d7bff, transparent: true, opacity: 0.25 }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.002;
  scene.add(ring);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(6.2, 2.7, 6.8);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.rotateSpeed = 0.85;
  controls.zoomSpeed = 0.9;
  controls.minDistance = 3;
  controls.maxDistance = 26;
  controls.maxPolarAngle = Math.PI * 0.995;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.8;
  controls.target.set(0, 0.75, 0);
  controls.addEventListener('start', () => {
    if (!state.autoRotate) return;
    state.autoRotate = false;
    controls.autoRotate = false;
    refreshControls();
  });

  const brushCursor = new THREE.Mesh(
    new THREE.RingGeometry(0.86, 1, 48),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
      side: THREE.DoubleSide,
    }),
  );
  brushCursor.visible = false;
  brushCursor.renderOrder = 10;
  scene.add(brushCursor);

  // En pantallas verticales se aleja la cámara para que el vehículo entre completo.
  const HOME = new THREE.Vector3(6.2, 2.7, 6.8);
  const homePosition = () =>
    HOME.clone().multiplyScalar(Math.max(1, 1.15 / Math.max(camera.aspect, 0.3)));
  let framed = false;
  const narrow = window.matchMedia('(max-width: 900px)');
  narrow.addEventListener('change', () => resize());
  function resize() {
    const { clientWidth, clientHeight } = stage;
    if (!clientWidth || !clientHeight) return;
    renderer.setSize(clientWidth, clientHeight, false);
    camera.aspect = clientWidth / clientHeight;
    // Con los controles en bottom sheet (≤ 900 px) el vehículo se dibuja en la mitad superior.
    if (narrow.matches)
      camera.setViewOffset(
        clientWidth,
        clientHeight,
        0,
        clientHeight * 0.2,
        clientWidth,
        clientHeight,
      );
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    if (!framed) {
      camera.position.copy(homePosition());
      framed = true;
    }
  }
  new ResizeObserver(resize).observe(stage);
  resize();

  // ---------- vehículo ----------
  let vehicle = null;
  function dispose(object) {
    object.traverse((child) => {
      child.geometry?.dispose();
      if (child.material) [child.material].flat().forEach((material) => material.dispose());
    });
  }
  function loadModel(key) {
    hideReference();
    try {
      const config = VEHICLE_MODELS[key];
      if (!config) throw new Error('Modelo desconocido: ' + key);
      const built = buildVehicle(config, { paintColor: state.paintColor, labels });
      for (const part of built.parts.values()) {
        initDamageField(part);
        const saved = partState(part.name);
        part.userData.pressure = saved.pressure;
        replayStrokes(part, saved.strokes || []);
      }
      if (vehicle) {
        scene.remove(vehicle.root);
        dispose(vehicle.root);
      }
      vehicle = built;
      state.bodyKey = key;
      scene.add(vehicle.root);
      if (!available().includes(state.activePart)) state.activePart = 'hood';
      applyMode();
      console.log('[Auto3D] Modelo cargado:', key);
      return true;
    } catch (error) {
      showError('No se pudo construir el modelo 3D seleccionado. Se conserva el anterior.', error);
      return false;
    }
  }

  const DIM = {
    glass: 0.1,
    trim: 0.16,
    tire: 0.16,
    rim: 0.16,
    headlight: 0.14,
    taillight: 0.14,
    plate: 0.14,
  };
  function applyMode() {
    if (!vehicle) return;
    const heat = state.mode === 'heat';
    for (const [code, part] of vehicle.parts) {
      const mode = state.isolated === code ? 'isolated' : heat ? 'heat' : 'vehicle';
      paintPart(part, mode, { paintColor: state.paintColor, severity: partState(code).severity });
      setFinish(part, mode);
    }
    const materials = vehicle.materials;
    materials.bodyPaint.color.set(heat ? '#1b2230' : state.paintColor);
    for (const [name, dim] of Object.entries(DIM)) {
      const material = materials[name];
      material.transparent = heat || name === 'glass';
      material.opacity = heat ? dim : material.userData.baseOpacity;
      material.depthWrite = !heat;
      material.needsUpdate = true;
    }
    materials.headlight.emissiveIntensity = heat ? 0.05 : 0.9;
    materials.taillight.emissiveIntensity = heat ? 0.05 : 0.75;
    refreshAll();
  }

  // Pintura PBR en la vista normal; acabado mate en el mapa de calor para que los colores se lean.
  function setFinish(part, mode) {
    const material = part.userData.meshes[0].material;
    const matte = mode !== 'vehicle';
    material.metalness = matte ? 0.05 : 0.72;
    material.roughness = matte ? 0.62 : 0.3;
    material.clearcoat = matte ? 0 : 1.0;
    material.envMapIntensity = matte ? 0.35 : 1.25;
  }

  // Desvanece todo lo que no es la pieza aislada (0 = oculto, 1 = normal).
  function fadeOthers(amount) {
    const isolated = vehicle.parts.get(state.isolated);
    vehicle.root.traverse((child) => {
      if (!child.isMesh) return;
      let inside = false;
      child.traverseAncestors((ancestor) => (inside ||= ancestor === isolated));
      if (inside) return;
      child.visible = amount > 0.01;
      const material = child.material;
      if (material.userData.fadeBase === undefined)
        material.userData.fadeBase = {
          opacity: material.opacity,
          transparent: material.transparent,
        };
      const transparent = amount < 1 || material.userData.fadeBase.transparent;
      if (material.transparent !== transparent) {
        material.transparent = transparent;
        material.needsUpdate = true;
      }
      material.opacity = material.userData.fadeBase.opacity * amount;
    });
    if (amount >= 1)
      vehicle.root.traverse((child) => {
        if (child.isMesh) delete child.material.userData.fadeBase;
      });
  }

  // ---------- animaciones (easing cúbico) ----------
  let tween = null;
  function animate(duration, step, done) {
    tween = { start: performance.now(), duration, step, done };
  }
  const ISOLATION_CENTER = new THREE.Vector3(0, 1.3, 0);
  let savedView = null;
  function isolate(code) {
    if (!vehicle || tween || state.isolated || state.mode !== 'vehicle' || state.reference) return;
    const part = vehicle.parts.get(code);
    if (!part) return;
    state.isolated = code;
    state.activePart = code;
    controls.autoRotate = false;
    hovered = null;
    savedView = { position: camera.position.clone(), target: controls.target.clone() };
    const from = { position: part.position.clone(), quaternion: part.quaternion.clone() };
    const normal = part.userData.normal.clone();
    // Giro sobre el eje vertical para que la cara exterior mire a la cámara y leve inclinación:
    // la pieza conserva su «arriba» (una rotación mínima la dejaría ladeada).
    const yaw = new THREE.Quaternion();
    if (Math.abs(normal.y) < 0.7 || normal.z < -0.5)
      yaw.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.atan2(normal.x, normal.z));
    const turned = normal.clone().applyQuaternion(yaw);
    const pitch = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0),
      Math.atan2(0.94, 0.34) - Math.atan2(turned.z, turned.y),
    );
    const target = pitch.multiply(yaw).multiply(part.userData.baseQuaternion.clone());
    const size = part.userData.size;
    const distance = Math.max(3.2, Math.max(size.x, size.y, size.z) * 2.4);
    const cameraTo = new THREE.Vector3(0, ISOLATION_CENTER.y + distance * 0.16, distance);
    applyMode();
    buildIsolationPanel();
    animate(
      950,
      (e) => {
        part.position
          .lerpVectors(from.position, ISOLATION_CENTER, e)
          .addScaledVector(normal, Math.sin(Math.PI * e) * 0.35);
        part.quaternion.slerpQuaternions(from.quaternion, target, e);
        fadeOthers(1 - e);
        camera.position.lerpVectors(savedView.position, cameraTo, e);
        controls.target.lerpVectors(savedView.target, ISOLATION_CENTER, e);
      },
      () => refreshAll(),
    );
  }
  function exitIsolation() {
    if (!state.isolated || tween) return;
    const part = vehicle.parts.get(state.isolated);
    const from = { position: part.position.clone(), quaternion: part.quaternion.clone() };
    const cameraFrom = camera.position.clone(),
      targetFrom = controls.target.clone();
    brushCursor.visible = false;
    commitNotes();
    animate(
      850,
      (e) => {
        part.position.lerpVectors(from.position, part.userData.basePosition, e);
        part.quaternion.slerpQuaternions(from.quaternion, part.userData.baseQuaternion, e);
        fadeOthers(e);
        camera.position.lerpVectors(cameraFrom, savedView.position, e);
        controls.target.lerpVectors(targetFrom, savedView.target, e);
      },
      () => {
        state.isolated = null;
        fadeOthers(1);
        controls.autoRotate = state.autoRotate;
        applyMode();
      },
    );
    ui.isolation.hidden = true;
  }

  // ---------- interacción: hover, selección y pincel ----------
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let hovered = null,
    down = null,
    painting = null;
  const partMeshes = () =>
    vehicle
      ? [...vehicle.parts.values()]
          .filter((part) => !state.isolated || part.name === state.isolated)
          .flatMap((part) => part.userData.meshes)
      : [];
  function pick(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(partMeshes(), false)[0];
    if (!hit) return null;
    let group = hit.object;
    while (group && !group.userData.isPart) group = group.parent;
    return group ? { part: group, hit } : null;
  }
  const brushRank = () => (state.erase ? 0 : SEVERITY_ORDER.indexOf(state.brushSeverity));
  const MAX_STAMPS = 6000;
  function stampAt(part, hit) {
    if (part.userData.strokes.length >= MAX_STAMPS) {
      setStatus(
        'Esta pieza alcanzó el máximo de trazos. Usa «Borrar mapa» y vuelve a pintar el daño.',
        'error',
      );
      return hit.point.clone();
    }
    const local = part.worldToLocal(hit.point.clone());
    const stamp = toStamp(part, local, state.brushRadius, brushRank());
    if (applyStamp(part, stamp)) {
      part.userData.strokes.push(stamp);
      paintPart(part, 'isolated', {
        paintColor: state.paintColor,
        severity: partState(part.name).severity,
      });
    }
    return hit.point.clone();
  }
  function updateBrush(result) {
    if (!result || !state.isolated || !state.editable) return void (brushCursor.visible = false);
    const normal = result.hit.face.normal.clone().transformDirection(result.hit.object.matrixWorld);
    brushCursor.position.copy(result.hit.point).addScaledVector(normal, 0.004);
    brushCursor.lookAt(result.hit.point.clone().add(normal));
    brushCursor.scale.setScalar(state.brushRadius / 100);
    brushCursor.material.color.set(state.erase ? '#ffffff' : SEVERITY_COLORS[state.brushSeverity]);
    brushCursor.visible = true;
  }
  const canvas = renderer.domElement;
  canvas.addEventListener('pointerdown', (event) => {
    down = { x: event.clientX, y: event.clientY };
    if (!state.isolated || !state.editable || tween) return;
    const result = pick(event);
    if (!result) return;
    controls.enabled = false;
    canvas.setPointerCapture(event.pointerId);
    painting = { part: result.part, last: stampAt(result.part, result.hit) };
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!vehicle || tween || state.reference) return;
    const result = state.mode === 'vehicle' ? pick(event) : null;
    if (state.isolated) {
      updateBrush(result);
      if (
        painting &&
        result &&
        result.hit.point.distanceTo(painting.last) >= (state.brushRadius / 100) * 0.3
      )
        painting.last = stampAt(painting.part, result.hit);
      return;
    }
    hovered = result?.part || null;
    canvas.style.cursor = hovered ? 'pointer' : 'grab';
    if (hovered) setTooltip(hovered.userData.partName, event);
    else setTooltip(null);
  });
  canvas.addEventListener('pointerleave', () => {
    hovered = null;
    brushCursor.visible = false;
    setTooltip(null);
  });
  const finishStroke = () => {
    if (!painting) return;
    const { part } = painting;
    painting = null;
    controls.enabled = true;
    const record = partState(part.name);
    record.strokes = part.userData.strokes.map((stamp) => [...stamp]);
    if (
      !state.erase &&
      SEVERITY_ORDER.indexOf(state.brushSeverity) > SEVERITY_ORDER.indexOf(record.severity)
    ) {
      record.severity = state.brushSeverity;
      if (ui.fields?.severity) ui.fields.severity.value = record.severity;
    }
    if (!record.affectedZone && ui.fields?.affectedZone) {
      ui.fields.affectedZone.placeholder = describeZone(part) || 'Zona afectada';
    }
    paintPart(part, 'isolated', { paintColor: state.paintColor, severity: record.severity });
    changed();
  };
  canvas.addEventListener('pointerup', (event) => {
    if (painting) return finishStroke();
    const moved = down ? Math.hypot(event.clientX - down.x, event.clientY - down.y) : 0;
    down = null;
    if (moved > 6 || state.isolated || state.mode !== 'vehicle' || state.reference) return;
    const result = pick(event);
    if (result) isolate(result.part.name);
  });
  canvas.addEventListener('pointercancel', finishStroke);
  const tooltip = h('div', { class: 'studio-tooltip', hidden: true });
  stage.append(tooltip);
  function setTooltip(text, event) {
    tooltip.hidden = !text;
    if (!text) return;
    tooltip.textContent = text;
    const rect = stage.getBoundingClientRect();
    tooltip.style.left = `${event.clientX - rect.left + 14}px`;
    tooltip.style.top = `${event.clientY - rect.top + 14}px`;
  }

  // ---------- persistencia ----------
  const hasPartData = (record) =>
    record.severity !== 'NONE' ||
    record.pressure > 0 ||
    record.repairCost > 0 ||
    record.laborCost > 0 ||
    (record.strokes || []).length > 0 ||
    Boolean(record.affectedZone || record.description || record.notes || record.materials);
  let saveTimer = null;
  function changed() {
    state.changes++;
    setStatus('Cambios sin guardar', 'pending');
    refreshAll();
    if (!state.editable) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => save(), 2500);
  }
  function payload() {
    return {
      csrf,
      revision: state.revision,
      bodyType: VEHICLE_MODELS[state.bodyKey].code,
      paintColor: state.paintColor,
      notes: state.notes,
      parts: Object.fromEntries(
        PART_CODES.map((code) => {
          const record = partState(code);
          return [
            code,
            {
              severity: record.severity,
              pressure: Math.round(record.pressure),
              affectedZone: record.affectedZone,
              description: record.description,
              notes: record.notes,
              materials: record.materials,
              repairCost: Number(record.repairCost) || 0,
              laborCost: Number(record.laborCost) || 0,
              strokes: record.strokes || [],
            },
          ];
        }),
      ),
    };
  }
  // Un diagnóstico nuevo se puede guardar aunque no tenga daños (vehículo sin daños de carrocería).
  const dirty = () => state.changes !== state.savedChanges || state.revision === 0;
  let retryDelay = 5000;
  async function save() {
    clearTimeout(saveTimer);
    // Tras un conflicto nada se guarda ni se envía: primero hay que recargar la versión vigente.
    if (state.conflict) return false;
    if (!state.editable || !dirty()) return true;
    if (state.saving) return new Promise((resolve) => setTimeout(() => resolve(save()), 400));
    state.saving = true;
    const snapshot = state.changes;
    setStatus('Guardando…', 'pending');
    try {
      const response = await fetch(api, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(payload()),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok)
        throw Object.assign(new Error(result.error || 'No se pudo guardar el diagnóstico.'), {
          code: result.code,
          status: response.status,
        });
      state.revision = result.revision;
      state.savedChanges = snapshot;
      retryDelay = 5000;
      const at = new Date(result.savedAt || Date.now()).toLocaleTimeString('es-PY', {
        hour: '2-digit',
        minute: '2-digit',
      });
      setStatus(
        state.changes === snapshot ? `Guardado · ${at}` : 'Cambios sin guardar',
        state.changes === snapshot ? 'ok' : 'pending',
      );
      if (state.changes !== snapshot) saveTimer = setTimeout(() => save(), 1500);
      return true;
    } catch (error) {
      // Sin respuesta del servidor (red, servidor detenido): se avisa y se reintenta solo. Un
      // rechazo de validación (4xx) no se reintenta: hay que corregir el dato.
      const offline = !error.status;
      setStatus(
        offline
          ? 'Sin conexión con el servidor: cambios sin guardar, se reintentará.'
          : error.message,
        'error',
      );
      if (offline || error.status >= 500) {
        saveTimer = setTimeout(() => save(), retryDelay);
        retryDelay = Math.min(retryDelay * 2, 60000);
      }
      if (error.code === 'STALE_REVISION') {
        state.conflict = true;
        state.editable = false;
        applyEditable();
        showError(error.message + ' Pulsa «Recargar» para continuar.');
        errorBox.append(
          ' ',
          h('button', {
            class: 'button button-small',
            type: 'button',
            text: 'Recargar',
            onclick: () => location.reload(),
          }),
        );
      }
      return false;
    } finally {
      state.saving = false;
    }
  }
  window.addEventListener('beforeunload', (event) => {
    if (state.editable && state.changes !== state.savedChanges) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  // En el móvil o la app Android, cambiar de aplicación puede cerrar la página sin aviso.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && state.changes !== state.savedChanges) save();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.isolated) exitIsolation();
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      save();
    }
  });
  // Los formularios del servidor (finalizar, presupuesto) guardan antes de enviarse.
  for (const form of root.querySelectorAll('form[data-save-first]'))
    form.addEventListener('submit', async (event) => {
      if (event.defaultPrevented || (!state.conflict && !(state.editable && dirty()))) return;
      event.preventDefault();
      if (await save()) return form.submit();
      // app.js ya deshabilitó el botón al enviar: se restaura para poder reintentar.
      const button = form.querySelector('button[type=submit],button:not([type])');
      if (button?.dataset.originalText) {
        button.disabled = false;
        button.textContent = button.dataset.originalText;
      }
    });

  // ---------- paneles ----------
  const ui = {};
  const overlay = h('div', { class: 'studio-overlay' });
  stage.append(overlay);
  ui.models = h('nav', { class: 'studio-models', 'aria-label': 'Carrocería' });
  for (const key of MODEL_KEYS) {
    const config = VEHICLE_MODELS[key];
    ui.models.append(
      h(
        'button',
        {
          type: 'button',
          'data-model': key,
          title: `${config.name} · ${config.numDoors} puertas · ${config.length.toFixed(2)} × ${config.width.toFixed(2)} m`,
          onclick: () => switchModel(key),
        },
        h('span', { class: 'studio-model-dot', style: { background: config.color } }),
        config.name,
      ),
    );
  }
  overlay.append(ui.models);

  // Panel de control: vista, color, presión y acciones.
  ui.viewButtons = ['vehicle', 'heat'].map((mode) =>
    h(
      'button',
      { type: 'button', 'data-view': mode, onclick: () => setMode(mode) },
      mode === 'vehicle' ? 'Vehículo' : 'Mapa de calor',
    ),
  );
  ui.swatches = PAINT_PRESETS.map((color) =>
    h('button', {
      type: 'button',
      class: 'studio-swatch',
      style: { background: color },
      title: color,
      'data-color': color,
      onclick: () => setPaint(color, true),
    }),
  );
  ui.customColor = h('input', {
    type: 'color',
    value: state.paintColor,
    title: 'Color personalizado',
    oninput: (event) => setPaint(event.target.value, true),
  });
  ui.pressurePart = h('select', {
    onchange: (event) => {
      state.activePart = event.target.value;
      refreshControls();
    },
  });
  ui.pressure = h('input', {
    type: 'range',
    min: 0,
    max: 100,
    step: 1,
    oninput: (event) => {
      const value = Number(event.target.value);
      partState(state.activePart).pressure = value;
      if (vehicle?.parts.get(state.activePart))
        vehicle.parts.get(state.activePart).userData.pressure = value;
      changed();
    },
  });
  ui.pressureValue = h('output', { class: 'studio-pressure-value' });
  ui.autoRotate = h('button', {
    type: 'button',
    onclick: () => {
      state.autoRotate = !state.autoRotate;
      controls.autoRotate = state.autoRotate && !state.isolated;
      refreshControls();
    },
  });
  const controlPanel = panel(
    'studio-control',
    null,
    h('button', {
      type: 'button',
      class: 'studio-sheet-handle',
      'aria-label': 'Mostrar u ocultar controles',
      onclick: () => controlPanel.classList.toggle('is-collapsed'),
    }),
    h('h4', { text: 'Vista' }),
    h('div', { class: 'studio-segmented' }, ui.viewButtons),
    h('h4', { text: 'Color' }),
    h(
      'div',
      { class: 'studio-swatches' },
      ui.swatches,
      h('label', { class: 'studio-custom-color' }, ui.customColor, 'Personalizado'),
    ),
    h('h4', { text: 'Presión' }),
    ui.pressurePart,
    h('div', { class: 'studio-pressure' }, ui.pressure, ui.pressureValue),
    h(
      'div',
      { class: 'studio-pressure-scale' },
      h('span', { text: 'Baja' }),
      h('span', { text: 'Media' }),
      h('span', { text: 'Alta' }),
    ),
    h('h4', { text: 'Acciones' }),
    h(
      'div',
      { class: 'studio-actions' },
      h(
        'button',
        {
          type: 'button',
          'data-edit': true,
          onclick: () => {
            const value = partState(state.activePart).pressure;
            for (const code of available()) partState(code).pressure = value;
            changed();
          },
        },
        'Aplicar a todas las piezas',
      ),
      h(
        'button',
        {
          type: 'button',
          title: 'Restablece la presión de todas las piezas y la vista. No borra daños.',
          onclick: resetAll,
        },
        'Reiniciar',
      ),
      ui.autoRotate,
    ),
  );
  ui.control = controlPanel;
  overlay.append(controlPanel);

  ui.parts = h('ul', { class: 'studio-part-list' });
  ui.partsPanel = panel('studio-parts', 'Piezas', ui.parts);
  overlay.append(ui.partsPanel);

  ui.isolation = panel('studio-isolate', null);
  ui.isolation.hidden = true;
  overlay.append(ui.isolation);

  ui.legend = h(
    'div',
    { class: 'studio-legend', hidden: true },
    SEVERITY_ORDER.slice(1).map((code) =>
      h('span', {}, h('i', { style: { background: SEVERITY_COLORS[code] } }), severityLabels[code]),
    ),
  );
  overlay.append(ui.legend);

  ui.info = panel('studio-info', 'Resumen');
  overlay.append(ui.info);
  // Hasta 900 px la escena no lleva panel de información: se ubica debajo del visor para que
  // notas, guardado, modelos de referencia e historial sigan disponibles en tablet y móvil.
  function placeInfo() {
    ui.info.classList.toggle('is-docked', narrow.matches);
    if (narrow.matches) stage.after(ui.info);
    else overlay.append(ui.info);
  }
  narrow.addEventListener('change', placeInfo);
  placeInfo();
  ui.referenceBadge = h('div', { class: 'studio-reference-badge', hidden: true });
  overlay.append(ui.referenceBadge);

  function switchModel(key) {
    if (key === state.bodyKey || state.isolated || tween || !state.editable) return;
    const next = VEHICLE_MODELS[key];
    if (next.numDoors === 2 && REAR_DOORS.some((code) => hasPartData(partState(code)))) {
      window.alert(
        'Hay datos registrados en las puertas traseras. Bórralos antes de elegir una carrocería de dos puertas.',
      );
      return;
    }
    if (!state.paintCustomized) state.paintColor = next.color;
    if (loadModel(key)) changed();
  }
  function setMode(mode) {
    if (state.isolated || tween || state.reference) return;
    state.mode = mode;
    hovered = null;
    setTooltip(null);
    applyMode();
  }
  function setPaint(color, customized) {
    state.paintColor = color.toLowerCase();
    state.paintCustomized = customized;
    applyMode();
    changed();
  }
  function resetAll() {
    if (!state.editable) {
      if (state.isolated) exitIsolation();
      else camera.position.copy(homePosition());
      return;
    }
    if (
      !window.confirm(
        '¿Restablecer la presión de todas las piezas y la vista? Los daños registrados se conservan.',
      )
    )
      return;
    for (const code of PART_CODES) partState(code).pressure = 0;
    if (state.isolated) exitIsolation();
    else {
      camera.position.copy(homePosition());
      controls.target.set(0, 0.75, 0);
    }
    changed();
  }

  function buildIsolationPanel() {
    const code = state.isolated;
    const record = partState(code);
    const part = vehicle.parts.get(code);
    const readOnly = !state.editable;
    const field = (name, label, element) => {
      element.name = name;
      element.disabled = readOnly;
      element.addEventListener('input', () => {
        record[name] = element.type === 'number' ? Number(element.value || 0) : element.value;
        if (name === 'severity')
          paintPart(part, 'isolated', { paintColor: state.paintColor, severity: record.severity });
        changed();
      });
      return h('label', { class: 'studio-field' }, h('span', { text: label }), element);
    };
    const severitySelect = h(
      'select',
      {},
      SEVERITY_ORDER.map((s) => h('option', { value: s, text: severityLabels[s] })),
    );
    severitySelect.value = record.severity;
    const text = (value, rows) => {
      const element = rows ? h('textarea', { rows }) : h('input', { type: 'text' });
      element.value = value || '';
      return element;
    };
    const amount = (value) =>
      h('input', { type: 'number', min: 0, step: moneyStep, value: value || 0 });
    ui.fields = {
      severity: severitySelect,
      affectedZone: text(record.affectedZone),
      description: text(record.description, 2),
      notes: text(record.notes, 2),
      repairCost: amount(record.repairCost),
      laborCost: amount(record.laborCost),
      materials: text(record.materials, 2),
    };
    ui.fields.affectedZone.placeholder =
      describeZone(part) || 'Ej.: sector trasero, parte inferior';
    const brushButtons = SEVERITY_ORDER.slice(1).map((s) =>
      h(
        'button',
        {
          type: 'button',
          'data-brush': s,
          style: { '--swatch': SEVERITY_COLORS[s] },
          onclick: () => {
            state.brushSeverity = s;
            state.erase = false;
            refreshIsolation();
          },
        },
        severityLabels[s],
      ),
    );
    ui.eraser = h(
      'button',
      {
        type: 'button',
        'data-brush': 'erase',
        onclick: () => {
          state.erase = !state.erase;
          refreshIsolation();
        },
      },
      'Borrador',
    );
    ui.brushSize = h('input', {
      type: 'range',
      min: BRUSH.min,
      max: BRUSH.max,
      step: 1,
      value: state.brushRadius,
      oninput: (event) => {
        state.brushRadius = Number(event.target.value);
        ui.brushValue.textContent = `${state.brushRadius} cm`;
      },
    });
    ui.brushValue = h('output', { text: `${state.brushRadius} cm` });
    ui.photoList = h('div', { class: 'studio-photos' });
    const upload = h('input', {
      type: 'file',
      accept: 'image/png,image/jpeg,image/webp',
      onchange: (event) => uploadPhoto(code, event.target),
    });
    ui.isolation.replaceChildren(
      h('p', { class: 'studio-eyebrow', text: 'Modo aislado · mapa de calor' }),
      h('h3', { text: labels[code] }),
      h('div', { class: 'studio-brushes', hidden: readOnly }, brushButtons, ui.eraser),
      h(
        'div',
        { class: 'studio-pressure', hidden: readOnly },
        h('span', { text: 'Pincel' }),
        ui.brushSize,
        ui.brushValue,
      ),
      h(
        'div',
        { class: 'studio-actions', hidden: readOnly },
        h(
          'button',
          {
            type: 'button',
            onclick: () => {
              if (!window.confirm(`¿Borrar el mapa de daños de ${labels[code]}?`)) return;
              clearField(part);
              record.strokes = [];
              paintPart(part, 'isolated', {
                paintColor: state.paintColor,
                severity: record.severity,
              });
              changed();
            },
          },
          'Borrar mapa',
        ),
      ),
      field('severity', 'Gravedad de la pieza', severitySelect),
      field('affectedZone', 'Zona afectada', ui.fields.affectedZone),
      field('description', 'Descripción del daño', ui.fields.description),
      h(
        'div',
        { class: 'studio-field-row' },
        field('repairCost', `Reparación (${currency})`, ui.fields.repairCost),
        field('laborCost', `Mano de obra (${currency})`, ui.fields.laborCost),
      ),
      field('materials', 'Materiales relacionados', ui.fields.materials),
      field('notes', 'Observaciones', ui.fields.notes),
      h('p', {
        class: 'studio-meta',
        text: record.diagnosedBy
          ? `Diagnosticado por ${record.diagnosedBy} · ${new Date(record.diagnosedAt).toLocaleString('es-PY')}`
          : 'Sin registro guardado para esta pieza.',
      }),
      h('h4', { text: 'Fotografías' }),
      ui.photoList,
      data.permissions.upload
        ? h('label', { class: 'studio-upload' }, upload, 'Adjuntar foto')
        : null,
      h(
        'button',
        { type: 'button', class: 'studio-primary', onclick: exitIsolation },
        'Volver al vehículo',
      ),
    );
    ui.isolation.hidden = false;
    refreshIsolation();
    renderPhotos();
  }
  function commitNotes() {
    const code = state.isolated;
    if (!code || !state.editable) return;
    const record = partState(code);
    if (!record.affectedZone && record.strokes?.length) {
      const zone = describeZone(vehicle.parts.get(code));
      if (zone) {
        record.affectedZone = zone;
        changed();
      }
    }
  }
  function refreshIsolation() {
    if (ui.isolation.hidden && !state.isolated) return;
    for (const button of ui.isolation.querySelectorAll('[data-brush]'))
      button.classList.toggle(
        'is-active',
        button.dataset.brush === (state.erase ? 'erase' : state.brushSeverity),
      );
  }
  function renderPhotos() {
    if (!ui.photoList || !state.isolated) return;
    const photos = data.photos.filter((photo) => photo.part === state.isolated);
    ui.photoList.replaceChildren(
      ...(photos.length
        ? photos.map((photo) =>
            h(
              'a',
              { href: photo.url, target: '_blank', rel: 'noopener' },
              h('img', { src: photo.url, alt: photo.name, loading: 'lazy' }),
            ),
          )
        : [h('p', { class: 'studio-meta', text: 'Sin fotografías para esta pieza.' })]),
    );
  }
  async function uploadPhoto(code, input) {
    const file = input.files[0];
    if (!file) return;
    if (file.size > 7_000_000) return window.alert('La imagen supera el máximo de 7 MB.');
    const content = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    setStatus('Subiendo fotografía…', 'pending');
    try {
      const response = await fetch('/workshop/documents', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          csrf,
          name: file.name,
          mimeType: file.type,
          content,
          entityType: 'WORK_ORDER',
          entityId: data.order.id,
          category: `DAMAGE:${code}`,
        }),
      });
      const url = new URL(response.url);
      if (!response.ok || url.searchParams.get('error'))
        throw new Error(url.searchParams.get('error') || 'No se pudo subir la fotografía.');
      const fresh = await (
        await fetch(api, { headers: { accept: 'application/json' }, credentials: 'same-origin' })
      ).json();
      data.photos = fresh.photos || [];
      renderPhotos();
      setStatus(
        state.changes === state.savedChanges ? 'Fotografía guardada' : 'Cambios sin guardar',
        state.changes === state.savedChanges ? 'ok' : 'pending',
      );
    } catch (error) {
      setStatus(error.message, 'error');
    } finally {
      input.value = '';
    }
  }

  // ---------- modelo de referencia del catálogo local ----------
  const gltfLoader = new GLTFLoader();
  const referenceCache = new Map();
  let referenceLoading = false;
  async function showReference(model) {
    if (state.isolated || tween || referenceLoading) return;
    if (state.reference?.id === model.id) return hideReference();
    hideReference();
    setStatus(`Cargando modelo local ${model.model}…`, 'pending');
    referenceLoading = true;
    try {
      let object = referenceCache.get(model.id);
      if (!object) {
        const gltf = await gltfLoader.loadAsync(model.url);
        object = gltf.scene;
        const box = new THREE.Box3().setFromObject(object);
        const size = box.getSize(new THREE.Vector3());
        const scale = VEHICLE_MODELS[state.bodyKey].length / Math.max(size.x, size.z, 1e-3);
        object.scale.setScalar(scale);
        const scaled = new THREE.Box3().setFromObject(object);
        object.position.y -= scaled.min.y;
        object.position.x -= (scaled.min.x + scaled.max.x) / 2;
        object.position.z -= (scaled.min.z + scaled.max.z) / 2;
        object.traverse((child) => {
          if (child.isMesh) child.castShadow = child.receiveShadow = true;
        });
        referenceCache.set(model.id, object);
      }
      state.reference = model;
      vehicle.root.visible = false;
      scene.add(object);
      ui.referenceBadge.textContent = `${model.generic ? 'Modelo genérico' : 'Modelo de referencia'}: ${model.generic ? '' : model.brand + ' '}${model.model}${model.year ? ' ' + model.year : ''} · ${model.license} · ${model.author}. Solo visual: el diagnóstico se registra sobre la carrocería paramétrica.`;
      ui.referenceBadge.hidden = false;
      setStatus(
        state.changes === state.savedChanges ? 'Sin cambios pendientes' : 'Cambios sin guardar',
        state.changes === state.savedChanges ? 'ok' : 'pending',
      );
    } catch (error) {
      console.error('[Auto3D] Modelo de referencia no disponible.', error);
      setStatus(
        'No se pudo abrir el modelo 3D local. El archivo puede estar dañado o haber sido movido.',
        'error',
      );
    } finally {
      referenceLoading = false;
    }
    refreshAll();
  }
  function hideReference() {
    if (!state.reference) return;
    scene.remove(referenceCache.get(state.reference.id));
    state.reference = null;
    vehicle.root.visible = true;
    ui.referenceBadge.hidden = true;
    refreshAll();
  }

  async function copyHistory(entry) {
    if (
      !window.confirm(
        `¿Copiar los daños de la orden #${entry.orderNumber} a este diagnóstico? Reemplaza los datos actuales sin guardar.`,
      )
    )
      return;
    try {
      const url = api.replace(data.order.id, entry.orderId);
      const previous = await (
        await fetch(url, { headers: { accept: 'application/json' }, credentials: 'same-origin' })
      ).json();
      for (const code of PART_CODES) {
        const source = previous.parts[code];
        Object.assign(partState(code), {
          severity: source.severity,
          pressure: source.pressure,
          affectedZone: source.affectedZone,
          description: source.description,
          notes: source.notes,
          materials: source.materials,
          repairCost: source.repairCost,
          laborCost: source.laborCost,
          strokes: source.strokes,
        });
      }
      loadModel(keyForBodyType(previous.assessment?.bodyType || data.vehicle.bodyType));
      changed();
    } catch (error) {
      showError('No se pudo leer el diagnóstico anterior.', error);
    }
  }

  // ---------- refresco de paneles ----------
  function refreshControls() {
    for (const button of ui.viewButtons) {
      button.classList.toggle('is-active', button.dataset.view === state.mode);
      button.disabled = Boolean(state.isolated || state.reference);
    }
    for (const swatch of ui.swatches) {
      swatch.classList.toggle('is-active', swatch.dataset.color === state.paintColor);
      swatch.disabled = !state.editable;
    }
    ui.customColor.value = state.paintColor;
    ui.customColor.disabled = !state.editable;
    const codes = available();
    if (ui.pressurePart.options.length !== codes.length)
      ui.pressurePart.replaceChildren(
        ...codes.map((code) => h('option', { value: code, text: labels[code] })),
      );
    ui.pressurePart.value = state.activePart;
    const pressure = partState(state.activePart).pressure;
    ui.pressure.value = pressure;
    ui.pressure.disabled = !state.editable;
    ui.pressure.style.setProperty('--thumb', pressureColor(pressure));
    ui.pressureValue.textContent = `${pressure} · ${pressureLabel(pressure)}`;
    ui.pressureValue.style.color = pressureColor(pressure);
    ui.autoRotate.textContent = `Auto-giro ${state.autoRotate ? 'ON' : 'OFF'}`;
    ui.autoRotate.classList.toggle('is-active', state.autoRotate);
    for (const button of ui.control.querySelectorAll('[data-edit]'))
      button.disabled = !state.editable;
    for (const button of ui.models.querySelectorAll('button')) {
      button.classList.toggle('is-active', button.dataset.model === state.bodyKey);
      button.disabled = !state.editable || Boolean(state.isolated);
    }
  }
  function refreshParts() {
    const heat = state.mode === 'heat';
    ui.partsPanel.classList.toggle('is-disabled', heat);
    ui.parts.replaceChildren(
      ...available().map((code) => {
        const record = partState(code);
        const damaged = record.severity !== 'NONE';
        return h(
          'li',
          {},
          h(
            'button',
            {
              type: 'button',
              disabled: heat || Boolean(state.isolated) || Boolean(state.reference),
              class: state.isolated === code ? 'is-active' : '',
              onclick: () => isolate(code),
              onmouseenter: () => {
                if (!heat && !state.isolated) hovered = vehicle.parts.get(code) || null;
              },
              onmouseleave: () => {
                hovered = null;
              },
            },
            h('i', {
              class: 'studio-indicator',
              style: { background: damaged ? SEVERITY_COLORS[record.severity] : '#3a4452' },
            }),
            h('span', { class: 'studio-part-name', text: labels[code] }),
            h('small', {
              text: damaged ? `Con daño · ${severityLabels[record.severity]}` : 'Sin daño',
            }),
            h('span', {
              class: 'studio-pressure-chip',
              style: { '--chip': pressureColor(record.pressure) },
              text: `P ${record.pressure}`,
            }),
          ),
        );
      }),
    );
  }
  function refreshInfo() {
    const damaged = available()
      .map((code) => [code, partState(code)])
      .filter(([, r]) => r.severity !== 'NONE');
    const repair = damaged.reduce((sum, [, r]) => sum + Number(r.repairCost || 0), 0);
    const labor = damaged.reduce((sum, [, r]) => sum + Number(r.laborCost || 0), 0);
    const reference = data.referenceModel;
    const referenceBlock = h(
      'div',
      { class: 'studio-reference' },
      h('h4', { text: 'Modelo 3D local' }),
      reference?.model
        ? h(
            'button',
            {
              type: 'button',
              class: state.reference?.id === reference.model.id ? 'is-active' : '',
              onclick: () => showReference(reference.model),
            },
            state.reference?.id === reference.model.id
              ? 'Volver a la carrocería'
              : `Ver ${reference.model.brand} ${reference.model.model}${reference.model.year ? ' ' + reference.model.year : ''}${reference.status === 'VARIANT' ? ' (variante)' : ''}`,
          )
        : h('p', {
            class: 'studio-meta',
            text: `${data.vehicle.make || 'Vehículo'} ${data.vehicle.model || ''}: 3D_NOT_AVAILABLE en el catálogo local. Se usa la carrocería paramétrica.`,
          }),
      reference?.generic?.length
        ? h(
            'details',
            // Abierto mientras se ve un genérico: ahí está el botón para volver a la carrocería.
            { open: reference.generic.some((model) => model.id === state.reference?.id) },
            h('summary', { text: `Modelos genéricos (${reference.generic.length})` }),
            reference.generic.map((model) =>
              h(
                'button',
                {
                  type: 'button',
                  class: state.reference?.id === model.id ? 'is-active' : '',
                  onclick: () => showReference(model),
                },
                state.reference?.id === model.id
                  ? `Volver a la carrocería (${model.model})`
                  : `Genérico · ${model.model}`,
              ),
            ),
          )
        : null,
    );
    const history = data.history.length
      ? h(
          'details',
          { class: 'studio-history' },
          h('summary', { text: `Historial del vehículo (${data.history.length})` }),
          data.history.map((entry) =>
            h(
              'div',
              { class: 'studio-history-entry' },
              h('a', {
                href: `/workshop/orders/${entry.orderId}/diagnosis-3d`,
                text: `Orden #${entry.orderNumber}`,
              }),
              h('small', {
                text: `${new Date(entry.updatedAt).toLocaleDateString('es-PY')} · ${entry.damagedParts} pieza/s · ${entry.parts.map((p) => p.label).join(', ') || 'sin daños'}`,
              }),
              state.editable
                ? h(
                    'button',
                    { type: 'button', class: 'link-button', onclick: () => copyHistory(entry) },
                    'Copiar daños',
                  )
                : null,
            ),
          ),
        )
      : null;
    ui.info.replaceChildren(
      h('h3', { text: 'Resumen' }),
      h(
        'dl',
        { class: 'studio-totals' },
        h('dt', { text: 'Piezas con daño' }),
        h('dd', { text: String(damaged.length) }),
        h('dt', { text: 'Reparación' }),
        h('dd', { text: moneyFormat.format(repair) }),
        h('dt', { text: 'Mano de obra' }),
        h('dd', { text: moneyFormat.format(labor) }),
        h('dt', { text: 'Total estimado' }),
        h('dd', { class: 'studio-total', text: moneyFormat.format(repair + labor) }),
      ),
      state.editable
        ? h(
            'label',
            { class: 'studio-field' },
            h('span', { text: 'Detalles técnicos del diagnóstico' }),
            (() => {
              const area = h('textarea', {
                rows: 3,
                oninput: (event) => {
                  state.notes = event.target.value;
                  changed();
                },
              });
              area.value = state.notes;
              return area;
            })(),
          )
        : state.notes
          ? h('p', { class: 'studio-meta', text: state.notes })
          : null,
      state.editable
        ? h(
            'button',
            { type: 'button', class: 'studio-primary', onclick: () => save() },
            'Guardar diagnóstico',
          )
        : h('p', {
            class: 'studio-meta',
            text: 'Solo lectura: la orden ya no admite cambios de diagnóstico o tu rol no los permite.',
          }),
      referenceBlock,
      history,
    );
  }
  function applyEditable() {
    for (const element of Object.values(ui.fields || {})) element.disabled = !state.editable;
    refreshAll();
  }
  function refreshAll() {
    refreshControls();
    refreshParts();
    const typing =
      ui.info.contains(document.activeElement) &&
      document.activeElement.matches('textarea, input, select');
    if (!typing) refreshInfo();
    ui.legend.hidden = state.mode !== 'heat' || Boolean(state.isolated);
    root.classList.toggle('is-heat', state.mode === 'heat');
    root.classList.toggle('is-isolated', Boolean(state.isolated));
  }

  // ---------- bucle de render ----------
  const clock = new THREE.Clock();
  function frame() {
    try {
      drawFrame();
      requestAnimationFrame(frame);
    } catch (error) {
      showError(
        'Se produjo un error al dibujar la escena 3D. Recarga la página; los datos guardados se conservan.',
        error,
      );
    }
  }
  function drawFrame() {
    const t = clock.getElapsedTime();
    if (tween) {
      const progress = Math.min(1, (performance.now() - tween.start) / tween.duration);
      tween.step(easeInOutCubic(progress));
      if (progress >= 1) {
        const done = tween.done;
        tween = null;
        done?.();
      }
    }
    if (vehicle)
      for (const part of vehicle.parts.values()) {
        const material = part.userData.meshes[0].material;
        const active = part === hovered && state.mode === 'vehicle' && !state.isolated;
        material.emissive.set(active ? 0x22d3ee : 0x000000);
        material.emissiveIntensity = active ? 0.55 * (0.5 + 0.5 * Math.sin(t * 7)) : 0;
      }
    controls.update();
    renderer.render(scene, camera);
  }

  try {
    if (!loadModel(state.bodyKey)) return;
    state.savedChanges = state.changes;
    setStatus(
      data.assessment
        ? `Última versión: ${new Date(data.assessment.updatedAt).toLocaleString('es-PY')}`
        : 'Diagnóstico nuevo: sin guardar todavía',
      data.assessment ? 'ok' : 'pending',
    );
    refreshAll();
    requestAnimationFrame(() => {
      frame();
      loader.classList.add('is-hidden');
    });
  } catch (error) {
    showError('No se pudo iniciar la escena 3D.', error);
  }
}
