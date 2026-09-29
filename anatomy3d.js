// ════════════════════════════════════════════════════════════
//  Fuse Biomechanics — 內建3D解剖模型 (BodyParts3D 4.0)
//
//  呢個係由 huangsum11-tech/human-atlas（React + Three.js app）嘅
//  app/scene.tsx 移植返嚟嘅 vanilla JS 版本，剝走 React 之後淨返嘅
//  Three.js 渲染邏輯基本上原封不動保留（GPU texture 驅動嘅逐部件
//  位移/可見度/選中狀態、揀選用嘅隱形 picker mesh、爆炸圖佈局）。
//  模型資源（atlas.json + models/body-N.bin.gz）已經搬咗入呢個repo，
//  离线／唔使外部服務就可以完整運作。
//
//  資料來源：BodyParts3D 4.0, © DBCLS, CC BY 4.0 — 詳見 models/ATTRIBUTION.md
// ════════════════════════════════════════════════════════════
import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const SYSTEMS = [
  { id: 'skeletal', name: '骨骼 Skeleton', color: '#e2d9ba' },
  { id: 'muscular', name: '肌肉 Muscles', color: '#a85b50' },
  { id: 'cardiac', name: '心臟 Heart', color: '#b96760' },
  { id: 'sensory', name: '感覺器官 Sensory', color: '#b0c8ce' },
  { id: 'arterial', name: '動脈 Arteries', color: '#c05245' },
  { id: 'venous', name: '靜脈 Veins', color: '#527c9f' },
  { id: 'nervous', name: '神經系統 Nervous', color: '#d8b565' },
  { id: 'respiratory', name: '呼吸系統 Respiratory', color: '#b98991' },
  { id: 'digestive', name: '消化系統 Digestive', color: '#b8916b' },
  { id: 'urinary', name: '泌尿系統 Urinary', color: '#b47961' },
  { id: 'lymphatic', name: '淋巴系統 Lymphatic', color: '#879f7c' },
  { id: 'endocrine', name: '內分泌 Endocrine', color: '#c5a09a' },
  { id: 'reproductive', name: '生殖系統 Reproductive', color: '#bda098' },
  { id: 'integumentary', name: '體表 Body surface', color: '#ba9b7d' },
  { id: 'connective', name: '結締組織 Connective', color: '#aec3bb' },
];
export const DEFAULT_VISIBLE = ['skeletal', 'muscular'];

/** Static hosts may serve .gz as a compressed response or as a gzip file;
 *  fetch() already decodes Content-Encoding, so inspect the payload to avoid
 *  decoding twice. Ported verbatim from human-atlas/app/model-download.ts. */
async function decodeModelResponse(response, expectedBytes) {
  if (!response.ok) throw new Error('An anatomy file could not be loaded.');
  const payload = await response.arrayBuffer();
  const signature = new Uint8Array(payload, 0, Math.min(2, payload.byteLength));
  const gzip = signature[0] === 0x1f && signature[1] === 0x8b;
  const buffer = gzip
    ? await new Response(new Blob([payload]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
    : payload;
  if (buffer.byteLength !== expectedBytes) throw new Error('An anatomy file was incomplete. Please reload the viewer.');
  return buffer;
}

/** Pack only visible source meshes into an exploded-view grid.
 *  Ported verbatim from human-atlas/app/explosion-layout.ts. */
function createExplosionLayout(parts, aspect = 1) {
  const cards = parts.map(p => ({
    id: p.id, system: p.system,
    width: Math.max(0.035, p.bounds[1][0] - p.bounds[0][0]) + 0.04,
    height: Math.max(0.035, p.bounds[1][1] - p.bounds[0][1]) + 0.04,
  }));
  const area = cards.reduce((n, c) => n + c.width * c.height, 0);
  const maxWidth = Math.max(0.3, ...cards.map(c => c.width));
  const targetWidth = Math.max(maxWidth, Math.sqrt(area * Math.max(0.5, Math.min(1.5, aspect))) * 1.18);
  cards.sort((a, b) => b.height - a.height || a.id.localeCompare(b.id));
  const cells = new Map(); let x = 0, y = 0, row = 0, usedWidth = 0;
  for (const c of cards) {
    if (x > 0 && x + c.width > targetWidth) { x = 0; y += row; row = 0; }
    cells.set(c.id, { x: x + c.width / 2, y: -y - c.height / 2, width: c.width, height: c.height });
    x += c.width; usedWidth = Math.max(usedWidth, x); row = Math.max(row, c.height);
  }
  const height = y + row;
  cells.forEach(c => { c.x -= usedWidth / 2; c.y += height / 2; });
  return { cells, width: usedWidth, height };
}

/** Distinguish a tap from an orbit/pinch/pan/canceled touch sequence.
 *  Ported verbatim from human-atlas/app/pointer-tap.ts. */
class PointerTap {
  constructor() { this.active = new Map(); this.blocked = false; }
  down(id, x, y, threshold) {
    if (this.active.size === 0) this.blocked = false;
    this.active.set(id, { x, y, threshold });
    if (this.active.size > 1) this.blocked = true;
  }
  move(id, x, y) {
    const start = this.active.get(id);
    if (start && Math.hypot(x - start.x, y - start.y) > start.threshold) this.blocked = true;
  }
  up(id, x, y) {
    this.move(id, x, y);
    const tap = this.active.has(id) && this.active.size === 1 && !this.blocked;
    this.active.delete(id);
    return tap;
  }
  cancel(id) { this.active.delete(id); this.blocked = true; }
}

let atlasPromise = null;
async function fetchAtlas(baseUrl) {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(baseUrl + 'atlas.json', { cache: 'force-cache' });
      if (!r.ok) throw new Error('atlas.json fetch failed: ' + r.status);
      const atlas = await r.json();
      atlas.chunks.forEach(c => { c.url = baseUrl + c.url.split('/').pop(); if (c.gzip) c.gzip = baseUrl + c.gzip.split('/').pop(); });
      return atlas;
    } catch (e) {
      if (attempt >= 2) throw e;
      await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
    }
  }
}
export function loadAtlas(baseUrl = 'models/') {
  if (!atlasPromise) {
    atlasPromise = fetchAtlas(baseUrl).catch(e => { atlasPromise = null; throw e; });
  }
  return atlasPromise;
}

/** Resolve a list of ids (either atlas.json "concept" ids, grouping several
 *  parts, or direct BodyParts3D FMA part ids) to the set of part INDEXES
 *  they refer to. */
function resolvePartIndexes(atlas, ids) {
  if (!ids || !ids.length) return [];
  const conceptById = atlas._conceptById || (atlas._conceptById = new Map(atlas.concepts.map(c => [c.id, c])));
  const partIndexById = atlas._partIndexById || (atlas._partIndexById = new Map(atlas.parts.map((p, i) => [p.id, i])));
  const partIndexesByConceptId = atlas._partIndexesByConceptId || (atlas._partIndexesByConceptId = (() => {
    const m = new Map();
    atlas.parts.forEach((p, i) => { if (!m.has(p.conceptId)) m.set(p.conceptId, []); m.get(p.conceptId).push(i); });
    return m;
  })());
  const out = new Set();
  ids.forEach(id => {
    const concept = conceptById.get(id);
    if (concept) { concept.elements.forEach(elId => { const idx = partIndexById.get(elId); if (idx !== undefined) out.add(idx); }); return; }
    (partIndexesByConceptId.get(id) || []).forEach(idx => out.add(idx));
    const direct = partIndexById.get(id); if (direct !== undefined) out.add(direct);
  });
  return Array.from(out);
}

/** Mounts an interactive BodyParts3D viewer into `container`.
 *  This is human-atlas's app/scene.tsx with the React wrapper (useEffect/
 *  refs/JSX) stripped away — the Three.js body is otherwise unchanged. */
export function createAnatomyViewer(container, atlas, { onSelect, onProgress, onError } = {}) {
  const el = container;
  let disposed = false, frame = 0, dirty = true, ready = false, lastView = '', lastReset = -1, lastIsolate = '', layoutKey = '', amount = 0;
  let lastVisKey = null, lastSelKey = null, lastIsolateVal = null, lastHidKey = null, forceRecompute = true;
  const abort = new AbortController();
  const state = { explode: 0, visible: DEFAULT_VISIBLE.slice(), selected: [], isolate: false, view: 'front', rotate: false, reset: 0, hidden: [] };

  let renderer;
  try { renderer = new T.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' }); }
  catch { onError && onError('此瀏覽器未能啟動3D檢視器，請改用支援WebGL嘅瀏覽器。'); return null; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, innerWidth < 768 ? 1.5 : 2));
  renderer.setClearColor('#0b0e14'); renderer.outputColorSpace = T.SRGBColorSpace; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.12;
  el.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('aria-label', '互動式人體解剖3D模型');

  const scene = new T.Scene(), camera = new T.PerspectiveCamera(34, 1, 0.005, 100), controls = new OrbitControls(camera, renderer.domElement);
  camera.position.set(1.4, 1.05, 3.6); controls.target.set(0, 0.85, 0); controls.enableDamping = true; controls.dampingFactor = 0.085; controls.minDistance = 0.07; controls.maxDistance = 40; controls.maxPolarAngle = Math.PI * 0.96;
  controls.addEventListener('change', () => { dirty = true; });
  const pmrem = new T.PMREMGenerator(renderer), room = new RoomEnvironment(), env = pmrem.fromScene(room, 0.04);
  scene.environment = env.texture; room.dispose(); pmrem.dispose();
  scene.add(new T.HemisphereLight(0xffffff, 0xa7acb2, 1.05));
  const key = new T.DirectionalLight(0xfffaf4, 2.3); key.position.set(-2, 4, 3); scene.add(key);
  const rim = new T.DirectionalLight(0xe9f0ff, 1.8); rim.position.set(2, 2, -3); scene.add(rim);
  const ground = new T.Mesh(new T.CircleGeometry(30, 96), new T.MeshStandardMaterial({ color: 0x1a1d24, roughness: 1 })); ground.rotation.x = -Math.PI / 2; ground.position.y = -0.019; scene.add(ground);
  const platform = new T.Mesh(new T.CylinderGeometry(0.68, 0.7, 0.028, 100), new T.MeshStandardMaterial({ color: 0x22252c, metalness: 0.12, roughness: 0.67 })); platform.position.y = -0.016; scene.add(platform);
  const ring = new T.Mesh(new T.RingGeometry(0.63, 0.632, 128), new T.MeshBasicMaterial({ color: 0x00e5a0, transparent: true, opacity: 0.35, side: T.DoubleSide })); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.001; scene.add(ring);
  const innerRing = new T.Mesh(new T.RingGeometry(0.55, 0.551, 128), new T.MeshBasicMaterial({ color: 0x00e5a0, transparent: true, opacity: 0.14, side: T.DoubleSide })); innerRing.rotation.x = -Math.PI / 2; innerRing.position.y = 0.001; scene.add(innerRing);

  const width = T.MathUtils.ceilPowerOfTwo(atlas.parts.length);
  const data = new Float32Array(width * 4), partTexture = new T.DataTexture(data, width, 1, T.RGBAFormat, T.FloatType); partTexture.needsUpdate = true;
  const selectedData = new Uint8Array(width * 4), selectionTexture = new T.DataTexture(selectedData, width, 1); selectionTexture.needsUpdate = true;
  const materials = [], geometries = [], pickers = [];
  const centers = atlas.parts.map(p => new T.Vector3().fromArray(p.bounds[0]).add(new T.Vector3().fromArray(p.bounds[1])).multiplyScalar(0.5));
  const offsets = [], bounds = atlas.parts.map(p => new T.Box3(new T.Vector3().fromArray(p.bounds[0]), new T.Vector3().fromArray(p.bounds[1])));
  let packingWidth = 1, packingHeight = 1;
  const markerPositions = new Float32Array(atlas.parts.length * 3), markerGeometry = new T.BufferGeometry();
  markerGeometry.setAttribute('position', new T.BufferAttribute(markerPositions, 3));
  const markerMaterial = new T.PointsMaterial({ color: 0x64748b, size: 5, sizeAttenuation: false, transparent: true, opacity: 0.72, depthTest: false });
  markerMaterial.onBeforeCompile = shader => { shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (distance(gl_PointCoord, vec2(0.5)) > 0.5) discard;'); };
  const markers = new T.Points(markerGeometry, markerMaterial); markers.frustumCulled = false; markers.renderOrder = 10; markers.visible = false; scene.add(markers);

  const hover = document.createElement('div');
  hover.style.cssText = 'position:absolute;z-index:5;background:rgba(10,15,25,.92);border:1px solid rgba(0,229,160,.3);border-radius:4px;padding:5px 10px;font-family:var(--mono,monospace);font-size:11px;color:#e8ebf0;pointer-events:none;white-space:nowrap;display:none';
  el.style.position = el.style.position || 'relative'; el.appendChild(hover);
  let targets = [];
  const projected = new T.Vector3();
  const findTarget = (x, y, radius) => {
    let best = -1, score = Infinity;
    for (const t of targets) {
      const dx = Math.max(t.left - x, 0, x - t.right), dy = Math.max(t.top - y, 0, y - t.bottom), distance = Math.hypot(dx, dy);
      if (distance > radius) continue;
      const candidate = distance + Math.hypot(t.x - x, t.y - y) * 0.025;
      if (candidate < score) { score = candidate; best = t.index; }
    }
    return best;
  };
  const materialFor = system => {
    const m = new T.MeshStandardMaterial({ color: SYSTEMS.find(s => s.id === system)?.color ?? '#aebbb8', metalness: 0.08, roughness: 0.53, side: T.DoubleSide, transparent: system === 'integumentary', opacity: system === 'integumentary' ? 0.1 : 1, depthWrite: system !== 'integumentary' });
    m.onBeforeCompile = shader => {
      shader.uniforms.partState = { value: partTexture }; shader.uniforms.selectionState = { value: selectionTexture }; shader.uniforms.stateWidth = { value: width };
      shader.vertexShader = 'attribute float partIndex; uniform sampler2D partState; uniform sampler2D selectionState; uniform float stateWidth; varying float partVisible; varying float partSelected;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvec2 stateUv = vec2((partIndex + 0.5) / stateWidth, 0.5); vec4 state = texture2D(partState, stateUv); transformed += state.xyz; partVisible = state.w; partSelected = texture2D(selectionState, stateUv).r;');
      shader.fragmentShader = 'varying float partVisible; varying float partSelected;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (partVisible < 0.5) discard;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.85, 0.78), partSelected * 0.75);');
    };
    materials.push(m); return m;
  };
  const mats = new Map(SYSTEMS.map(s => [s.id, materialFor(s.id)]));
  let loaded = 0;
  const loadChunk = async ci => {
    const chunk = atlas.chunks[ci];
    const compressed = !!chunk.gzip && typeof DecompressionStream !== 'undefined';
    const url = compressed ? chunk.gzip : chunk.url;
    let buffer;
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await fetch(url, { signal: abort.signal, cache: 'force-cache' });
        buffer = await decodeModelResponse(response, chunk.bytes);
        break;
      } catch (e) {
        if (disposed || abort.signal.aborted || attempt >= 2) throw e;
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      }
    }
    if (disposed) return;
    const groups = new Map();
    atlas.parts.forEach((p, i) => {
      if (p.chunk !== ci) return;
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(new Float32Array(buffer, p.positions, p.vertexCount * 3), 3));
      g.setAttribute('normal', new T.BufferAttribute(new Int16Array(buffer, p.normals, p.vertexCount * 3), 3, true));
      g.setIndex(new T.BufferAttribute(new Uint32Array(buffer, p.indices, p.indexCount), 1));
      g.boundingBox = bounds[i].clone(); g.computeBoundingSphere();
      const pick = new T.Mesh(g); pick.matrixAutoUpdate = false; pickers[i] = pick; geometries.push(g);
      g.setAttribute('partIndex', new T.BufferAttribute(new Float32Array(p.vertexCount).fill(i), 1));
      const list = groups.get(p.system) ?? []; list.push(g); groups.set(p.system, list);
    });
    groups.forEach((gs, system) => {
      const geometry = mergeGeometries(gs, false);
      if (!geometry) throw new Error('Could not assemble anatomy geometry.');
      geometries.push(geometry);
      const mesh = new T.Mesh(geometry, mats.get(system)); mesh.frustumCulled = false; scene.add(mesh);
    });
    forceRecompute = true; loaded++; onProgress && onProgress(Math.round(loaded / atlas.chunks.length * 100)); dirty = true;
  };
  (async () => {
    try {
      let cursor = 0;
      await Promise.all(Array.from({ length: 3 }, async () => { while (cursor < atlas.chunks.length) { const i = cursor++; await loadChunk(i); } }));
      if (!disposed) { ready = true; dirty = true; }
    } catch (e) { if (!disposed) onError && onError(e instanceof Error ? e.message : '未能載入解剖模型。'); }
  })();

  const fit = (view, extent = 0) => {
    const mobile = el.clientWidth < 560;
    const normalDistance = mobile ? Math.max(4.5, 1.8 * el.clientHeight / Math.max(160, el.clientHeight - 200) / (2 * Math.tan(T.MathUtils.degToRad(camera.fov / 2)))) : 4;
    const reservedWidth = mobile ? 0 : 260;
    const availableAspect = Math.max(0.35, (el.clientWidth - reservedWidth) / Math.max(160, el.clientHeight));
    const atlasDistance = Math.max(packingHeight, packingWidth / availableAspect) / (2 * Math.tan(T.MathUtils.degToRad(camera.fov / 2))) * 1.08;
    const distance = T.MathUtils.lerp(normalDistance, Math.max(0.2, atlasDistance), extent);
    if (extent > 0.8) view = 'front';
    const direction = view === 'front' ? new T.Vector3(0, 0.02, 1) : view === 'back' ? new T.Vector3(0, 0.02, -1) : view === 'side' ? new T.Vector3(1, 0.02, 0) : new T.Vector3(0.35, 0.06, 1).normalize();
    controls.target.set(extent > 0.1 && !mobile ? -packingWidth * 0.12 : 0, extent > 0.1 || mobile ? 0.85 : 0.68, 0);
    camera.position.copy(controls.target).addScaledVector(direction, distance); controls.update(); dirty = true;
  };
  const resize = () => {
    layoutKey = ''; forceRecompute = true;
    renderer.setPixelRatio(Math.min(devicePixelRatio, el.clientWidth < 560 || el.clientHeight < 600 ? 1.5 : 2));
    camera.aspect = el.clientWidth / Math.max(1, el.clientHeight); camera.updateProjectionMatrix();
    renderer.setSize(el.clientWidth, el.clientHeight); fit(state.view, amount);
  };
  const observer = new ResizeObserver(resize); observer.observe(el);

  const raycaster = new T.Raycaster(), pointer = new T.Vector2(), tap = new PointerTap(), worldBox = new T.Box3(), hitPoint = new T.Vector3();
  const down = e => { hover.style.display = 'none'; tap.down(e.pointerId, e.clientX, e.clientY, e.pointerType === 'touch' ? 12 : 5); };
  const move = e => {
    tap.move(e.pointerId, e.clientX, e.clientY);
    if (e.buttons || amount < 0.5 || e.pointerType === 'touch') { hover.style.display = 'none'; return; }
    const rect = el.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top, index = findTarget(x, y, 12);
    hover.style.display = index < 0 ? 'none' : 'block'; renderer.domElement.style.cursor = index < 0 ? 'grab' : 'pointer';
    if (index >= 0) { hover.textContent = atlas.parts[index].name; hover.style.left = Math.max(8, Math.min(x + 14, el.clientWidth - 220)) + 'px'; hover.style.top = Math.max(8, Math.min(y + 18, el.clientHeight - 40)) + 'px'; }
  };
  const cancel = e => tap.cancel(e.pointerId);
  const up = e => {
    const validTap = tap.up(e.pointerId, e.clientX, e.clientY); if (!validTap || !ready) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    let nearest = Infinity, found = -1;
    const hasSolid = atlas.parts.some((p, i) => p.system !== 'integumentary' && data[i * 4 + 3] > 0.5);
    pickers.forEach((mesh, i) => {
      if (!mesh || data[i * 4 + 3] < 0.5 || (hasSolid && atlas.parts[i].system === 'integumentary')) return;
      worldBox.copy(bounds[i]).translate(mesh.position);
      if (!raycaster.ray.intersectBox(worldBox, hitPoint)) return;
      const hits = raycaster.intersectObject(mesh, false);
      if (hits[0] && hits[0].distance < nearest) { nearest = hits[0].distance; found = i; }
    });
    if (found < 0 && amount > 0.45) found = findTarget(e.clientX - rect.left, e.clientY - rect.top, e.pointerType === 'touch' ? 24 : 16);
    if (found >= 0) { hover.style.display = 'none'; onSelect && onSelect(atlas.parts[found]); }
  };
  renderer.domElement.addEventListener('pointerdown', down); renderer.domElement.addEventListener('pointermove', move);
  renderer.domElement.addEventListener('pointerup', up); renderer.domElement.addEventListener('pointercancel', cancel);

  const clock = new T.Clock(); let lastExtent = -1;
  const animate = () => {
    if (disposed) return; frame = requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05), s = state;
    const visKey = s.visible.join(','), selKey = s.selected.join(','), hidKey = s.hidden.join(',');
    const changed = forceRecompute || visKey !== lastVisKey || selKey !== lastSelKey || s.isolate !== lastIsolateVal || hidKey !== lastHidKey;
    const moving = Math.abs(amount - s.explode) > 0.0001;
    if (moving) { amount = T.MathUtils.damp(amount, s.explode, 8, dt); dirty = true; }
    if (changed || moving || lastExtent < 0) {
      const visible = new Set(s.visible), selection = new Set(s.selected), hiddenSet = new Set(s.hidden);
      const visibleParts = atlas.parts.filter(p => s.isolate ? selection.has(p.id) : visible.has(p.system) || selection.has(p.id));
      const nextLayoutKey = visibleParts.map(p => p.id).join(',') + ':' + camera.aspect.toFixed(3);
      if (nextLayoutKey !== layoutKey) {
        const layout = createExplosionLayout(visibleParts, camera.aspect);
        packingWidth = layout.width; packingHeight = layout.height;
        atlas.parts.forEach((p, i) => { const cell = layout.cells.get(p.id); offsets[i] = cell ? new T.Vector3(cell.x, cell.y + 0.85, 0) : centers[i].clone(); });
        layoutKey = nextLayoutKey;
        if (amount > 0.05 && !s.isolate) fit(s.view, Math.max(0, (amount - 0.3) / 0.7));
      }
      atlas.parts.forEach((p, i) => {
        const c = centers[i], destination = offsets[i]; let dx = 0, dy = 0, dz = 0;
        if (amount <= 0.45) {
          const t = amount / 0.45; const group = SYSTEMS.findIndex(sys => sys.id === p.system); const angle = group / SYSTEMS.length * Math.PI * 2;
          dx = Math.sin(angle) * t * 0.48; dy = (c.y - 0.85) * t * 0.28; dz = Math.cos(angle) * t * 0.48;
        } else {
          const t = (amount - 0.45) / 0.55, group = SYSTEMS.findIndex(sys => sys.id === p.system), angle = group / SYSTEMS.length * Math.PI * 2;
          dx = T.MathUtils.lerp(Math.sin(angle) * 0.48, destination.x - c.x, t); dy = T.MathUtils.lerp((c.y - 0.85) * 0.28, destination.y - c.y, t); dz = T.MathUtils.lerp(Math.cos(angle) * 0.48, -c.z, t);
        }
        const selected = selection.has(p.id);
        const baseVisible = s.isolate ? selected : visible.has(p.system) || selected;
        data.set([dx, dy, dz, (baseVisible && !hiddenSet.has(p.id)) ? 1 : 0], i * 4);
        selectedData[i * 4] = selected ? 255 : 0;
        markerPositions.set(data[i * 4 + 3] > 0.5 ? [c.x + dx, c.y + dy, c.z + dz] : [10000, 10000, 10000], i * 3);
        const mesh = pickers[i]; if (mesh) { mesh.position.set(dx, dy, dz); mesh.updateMatrix(); mesh.updateMatrixWorld(true); }
      });
      partTexture.needsUpdate = true; selectionTexture.needsUpdate = true; markerGeometry.attributes.position.needsUpdate = true;
      lastVisKey = visKey; lastSelKey = selKey; lastIsolateVal = s.isolate; lastHidKey = hidKey; forceRecompute = false; lastExtent = amount; dirty = true;
    }
    if (s.view !== lastView || s.reset !== lastReset) { fit(s.view, amount); lastView = s.view; lastReset = s.reset; }
    if (moving && !s.isolate) fit(amount > 0.5 ? 'front' : s.view, Math.max(0, (amount - 0.3) / 0.7));
    const isolateKey = s.isolate ? s.selected.join(',') + ':' + s.reset + ':' + camera.aspect : '';
    if (isolateKey !== lastIsolate || (s.isolate && moving)) {
      if (s.isolate) {
        const box = new T.Box3();
        atlas.parts.forEach((p, i) => { if (s.selected.includes(p.id)) box.union(bounds[i].clone().translate(new T.Vector3(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]))); });
        if (!box.isEmpty()) {
          const center = box.getCenter(new T.Vector3()), size = box.getSize(new T.Vector3());
          const w = el.clientWidth, h = el.clientHeight, mobile = w < 560;
          const left = mobile ? 16 : 16, right = w - 16, top = mobile ? 16 : 16, bottom = mobile ? h * 0.55 : h - 16;
          const availableWidth = Math.max(150, right - left), availableHeight = Math.max(40, bottom - top);
          camera.setViewOffset(w, h, w / 2 - (left + right) / 2, h / 2 - (top + bottom) / 2, w, h);
          const distance = Math.max(0.07, Math.max(size.y * h / availableHeight, size.x * w / availableWidth / camera.aspect, size.z) / (2 * Math.tan(T.MathUtils.degToRad(camera.fov / 2))) * 1.35);
          controls.maxDistance = Math.max(40, distance * 2); controls.target.copy(center);
          camera.position.copy(center).add(new T.Vector3(0.2, 0.1, 1).normalize().multiplyScalar(distance)); controls.update(); dirty = true;
        }
      } else if (lastIsolate) { camera.clearViewOffset(); fit(s.view, amount); }
      lastIsolate = isolateKey;
    }
    controls.enableRotate = amount < 0.8; controls.mouseButtons.LEFT = amount < 0.8 ? T.MOUSE.ROTATE : T.MOUSE.PAN; controls.touches.ONE = amount < 0.8 ? T.TOUCH.ROTATE : T.TOUCH.PAN;
    ground.visible = platform.visible = ring.visible = innerRing.visible = amount < 0.5 && !s.isolate;
    markers.visible = amount > 0.75; controls.autoRotate = s.rotate && !s.isolate && amount < 0.4; controls.autoRotateSpeed = 0.65; controls.update();
    if (controls.autoRotate) dirty = true;
    if (dirty) {
      renderer.render(scene, camera); targets = [];
      if (amount > 0.45) {
        const hasSolid = atlas.parts.some((p, i) => p.system !== 'integumentary' && data[i * 4 + 3] > 0.5);
        atlas.parts.forEach((p, i) => {
          if (data[i * 4 + 3] < 0.5 || (hasSolid && p.system === 'integumentary')) return;
          let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
          for (let corner = 0; corner < 8; corner++) {
            projected.set(p.bounds[(corner & 1) ? 1 : 0][0] + data[i * 4], p.bounds[(corner & 2) ? 1 : 0][1] + data[i * 4 + 1], p.bounds[(corner & 4) ? 1 : 0][2] + data[i * 4 + 2]).project(camera);
            const x = (projected.x + 1) * el.clientWidth / 2, y = (1 - projected.y) * el.clientHeight / 2;
            left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
          }
          projected.copy(centers[i]).add(new T.Vector3(data[i * 4], data[i * 4 + 1], data[i * 4 + 2])).project(camera);
          if (projected.z < -1 || projected.z > 1) return;
          targets.push({ index: i, x: (projected.x + 1) * el.clientWidth / 2, y: (1 - projected.y) * el.clientHeight / 2, left, right, top, bottom });
        });
      }
      dirty = false;
    }
  };
  animate();
  const contextLost = e => { e.preventDefault(); onError && onError('裝置暫停咗3D運算階段，請重新載入。'); };
  renderer.domElement.addEventListener('webglcontextlost', contextLost);

  return {
    setVisible(systemIds) { state.visible = systemIds.slice(); dirty = true; },
    setHidden(partIds) { state.hidden = (partIds || []).slice(); dirty = true; },
    setSelected(partIds, isolate) { state.selected = partIds.slice(); if (isolate !== undefined) state.isolate = isolate; dirty = true; },
    setSelectedByIds(atlasOrPartConceptIds, isolate) {
      const idxs = resolvePartIndexes(atlas, atlasOrPartConceptIds);
      state.selected = idxs.map(i => atlas.parts[i].id);
      if (isolate !== undefined) state.isolate = isolate;
      dirty = true;
      return idxs.map(i => atlas.parts[i]);
    },
    clearSelection() { state.selected = []; state.isolate = false; dirty = true; },
    setExplode(v) { state.explode = Math.max(0, Math.min(1, v)); },
    setView(v) { state.view = v; },
    setRotate(v) { state.rotate = !!v; },
    resetCamera() { state.reset++; state.isolate = false; state.selected = []; state.explode = 0; },
    getState() { return state; },
    destroy() {
      disposed = true; abort.abort(); cancelAnimationFrame(frame); observer.disconnect(); controls.dispose();
      geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
      scene.traverse(o => { if (o instanceof T.Mesh && !geometries.includes(o.geometry)) { o.geometry.dispose(); const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(m => m.dispose()); } });
      env.dispose(); partTexture.dispose(); selectionTexture.dispose(); markerGeometry.dispose(); markerMaterial.dispose(); hover.remove(); renderer.dispose(); renderer.domElement.remove();
    },
  };
}

export function resolveConceptIdsToParts(atlas, ids) {
  return resolvePartIndexes(atlas, ids).map(i => atlas.parts[i]);
}
