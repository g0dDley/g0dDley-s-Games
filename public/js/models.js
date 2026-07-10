// Low-poly procedural characters, traps and build pieces.
import * as THREE from 'three';

const M = (color, opts = {}) => new THREE.MeshLambertMaterial({ color, ...opts });

const HERO_COLORS = {
  tommy:  { shirt: 0x4a5d3a, pants: 0x3a3a30, skin: 0xd9a878, hat: 0x2e3a26 },
  tina:   { shirt: 0x7a2f4f, pants: 0x222831, skin: 0xe8bd94, hat: 0xdddddd },
  joe:    { shirt: 0xd88a1e, pants: 0x39434e, skin: 0xc98f66, hat: 0xf2c230 },
  nathan: { shirt: 0x1c1c22, pants: 0x14141a, skin: 0xd9b48f, hat: 0xffffff },
};
const Z_COLORS = {
  runner:  { shirt: 0x51604e, pants: 0x3c3a33, skin: 0x7fa06a },
  stalker: { shirt: 0x8a2f22, pants: 0x2f2c26, skin: 0x86a06e },
  belcher: { shirt: 0x5e5641, pants: 0x413a2d, skin: 0x94ab6f },
  brute:   { shirt: 0x35414e, pants: 0x2b323c, skin: 0x6e8f5c },
  // AI kinds
  walker:  { shirt: 0x46503f, pants: 0x37342c, skin: 0x7d9c69 },
  airunner:{ shirt: 0x59463c, pants: 0x34302a, skin: 0x8aa370 },
  aibrute: { shirt: 0x3d3d46, pants: 0x2c2c33, skin: 0x668653 },
  exploder:{ shirt: 0x7d4423, pants: 0x39302a, skin: 0xa8b45f },
};

export function makeHumanoid({ shirt, pants, skin, hat }, { scale = 1, zombie = false, brute = false } = {}) {
  const g = new THREE.Group();
  const s = scale;
  const skinM = M(skin), shirtM = M(shirt), pantsM = M(pants);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62 * s * (brute ? 1.5 : 1), 0.72 * s, 0.34 * s * (brute ? 1.4 : 1)), shirtM);
  torso.position.y = 1.08 * s;
  g.add(torso);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34 * s, 0.34 * s, 0.34 * s), skinM);
  head.position.y = 1.62 * s;
  g.add(head);
  if (zombie) {
    const eyeM = new THREE.MeshBasicMaterial({ color: 0xff3322 });
    for (const ex of [-0.08, 0.08]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.06 * s, 0.05 * s, 0.02), eyeM);
      eye.position.set(ex * s, 1.65 * s, 0.18 * s);
      g.add(eye);
    }
  }
  if (hat !== undefined) {
    const hatM = new THREE.Mesh(new THREE.BoxGeometry(0.38 * s, 0.12 * s, 0.38 * s), M(hat));
    hatM.position.y = 1.84 * s;
    g.add(hatM);
  }

  const mkLimb = (w, len, mat) => new THREE.Mesh(new THREE.BoxGeometry(w * s, len * s, w * s), mat);
  const armL = mkLimb(0.16, 0.66, zombie ? skinM : shirtM);
  const armR = mkLimb(0.16, 0.66, zombie ? skinM : shirtM);
  armL.position.set(-0.46 * s * (brute ? 1.3 : 1), 1.1 * s, 0);
  armR.position.set(0.46 * s * (brute ? 1.3 : 1), 1.1 * s, 0);
  armL.geometry.translate(0, -0.22 * s, 0); armL.position.y += 0.22 * s;
  armR.geometry.translate(0, -0.22 * s, 0); armR.position.y += 0.22 * s;
  if (zombie) { armL.rotation.x = -1.35; armR.rotation.x = -1.35; }
  g.add(armL, armR);

  const legL = mkLimb(0.2, 0.72, pantsM);
  const legR = mkLimb(0.2, 0.72, pantsM);
  legL.geometry.translate(0, -0.3 * s, 0);
  legR.geometry.translate(0, -0.3 * s, 0);
  legL.position.set(-0.17 * s, 0.72 * s, 0);
  legR.position.set(0.17 * s, 0.72 * s, 0);
  g.add(legL, legR);

  g.userData.limbs = { armL, armR, legL, legR, head, torso };
  return g;
}

export function makeCharacter(team, cls) {
  if (team === 'resistance') {
    const c = HERO_COLORS[cls] || HERO_COLORS.tommy;
    const scale = cls === 'joe' ? 1.25 : (cls === 'tina' ? 0.94 : 1);
    const m = makeHumanoid(c, { scale });
    if (cls === 'nathan') {
      const collar = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.05), M(0xffffff));
      collar.position.set(0, 1.42, 0.17);
      m.add(collar);
    }
    return m;
  }
  const c = Z_COLORS[cls] || Z_COLORS.runner;
  return makeHumanoid(c, { scale: cls === 'brute' ? 1.3 : (cls === 'belcher' ? 1.12 : (cls === 'stalker' ? 0.92 : 1)), zombie: true, brute: cls === 'brute' || cls === 'belcher' });
}

export function makeAIZombie(kind) {
  const map = { walker: 'walker', runner: 'airunner', brute: 'aibrute', exploder: 'exploder', stalker: 'stalker', belcher: 'belcher' };
  const c = Z_COLORS[map[kind]] || Z_COLORS.walker;
  const scale = kind === 'brute' ? 1.35 : (kind === 'belcher' ? 1.12 : (kind === 'runner' || kind === 'stalker' ? 0.95 : 1));
  const m = makeHumanoid(c, { scale, zombie: true, brute: kind === 'brute' || kind === 'belcher' });
  if (kind === 'exploder') {
    const tank = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 8), new THREE.MeshLambertMaterial({ color: 0xcc4411, emissive: 0x551100 }));
    tank.position.set(0, 1.1, -0.28);
    m.add(tank);
  }
  if (kind === 'belcher') {
    const sac = new THREE.Mesh(new THREE.SphereGeometry(0.36, 8, 8), new THREE.MeshLambertMaterial({ color: 0x6cae3a, emissive: 0x223a0f }));
    sac.position.set(0, 1.05, 0.24);
    m.add(sac);
  }
  return m;
}

// ---- traps -----------------------------------------------------------------
export function makeTrap(kind) {
  const g = new THREE.Group();
  switch (kind) {
    case 'mine': {
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.16, 12), M(0x4b543e));
      base.position.y = 0.08;
      const nub = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.1, 8), new THREE.MeshBasicMaterial({ color: 0xff3333 }));
      nub.position.y = 0.2;
      g.add(base, nub);
      g.userData.blinker = nub;
      break;
    }
    case 'beartrap': {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.07, 6, 14), M(0x6a6f75));
      ring.rotation.x = Math.PI / 2; ring.position.y = 0.07;
      g.add(ring);
      for (let i = 0; i < 8; i++) {
        const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.28, 4), M(0x9aa0a6));
        const a = (i / 8) * Math.PI * 2;
        tooth.position.set(Math.cos(a) * 0.55, 0.2, Math.sin(a) * 0.55);
        g.add(tooth);
      }
      break;
    }
    case 'spikes': {
      const mat = M(0x8a8f95);
      for (let i = 0; i < 14; i++) {
        const sp = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.5, 4), mat);
        sp.position.set((Math.random() - 0.5) * 2.6, 0.25, (Math.random() - 0.5) * 2.6);
        g.add(sp);
      }
      const plate = new THREE.Mesh(new THREE.BoxGeometry(3, 0.06, 3), M(0x3b3f44));
      plate.position.y = 0.03;
      g.add(plate);
      break;
    }
    case 'flame': {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.66, 0.5, 8), M(0x7a3520));
      body.position.y = 0.25;
      g.add(body);
      const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, 0.24, 8), M(0x333333));
      nozzle.position.y = 0.58;
      g.add(nozzle);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.7, 2.6, 8), new THREE.MeshBasicMaterial({ color: 0xff7722, transparent: true, opacity: 0.75 }));
      flame.position.y = 1.9;
      flame.visible = false;
      g.add(flame);
      g.userData.flame = flame;
      break;
    }
    case 'turret': {
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 0.5, 8), M(0x39434e));
      base.position.y = 0.25;
      const headT = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.42, 0.9), M(0x50607a));
      headT.position.y = 0.75;
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.9, 8), M(0x1d232b));
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.78, 0.7);
      const head = new THREE.Group();
      head.add(headT, barrel);
      g.add(base, head);
      g.userData.head = head;
      break;
    }
    case 'boombox': {
      const box = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.62, 0.5), M(0x23262e));
      box.position.y = 0.31;
      g.add(box);
      for (const sx of [-0.32, 0.32]) {
        const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 10), M(0x565d6a));
        sp.rotation.x = Math.PI / 2;
        sp.position.set(sx, 0.31, 0.26);
        g.add(sp);
      }
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.03), new THREE.MeshBasicMaterial({ color: 0x22ff66 }));
      led.position.set(0, 0.5, 0.26);
      g.add(led);
      g.userData.led = led;
      break;
    }
  }
  return g;
}

// ---- builds ------------------------------------------------------------------
const woodTexCache = {};
function woodMat() {
  if (!woodTexCache.m) {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#5a4326'; g.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 128; y += 16) {
      g.fillStyle = `hsl(30, ${30 + Math.random() * 14}%, ${22 + Math.random() * 10}%)`;
      g.fillRect(0, y + 1, 128, 14);
    }
    g.fillStyle = 'rgba(0,0,0,0.3)';
    for (let i = 0; i < 40; i++) g.fillRect(Math.random() * 128, Math.random() * 128, 8, 1);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    woodTexCache.m = new THREE.MeshLambertMaterial({ map: t });
  }
  return woodTexCache.m;
}

export function makeBuild(kind) {
  const mat = woodMat();
  let mesh;
  if (kind === 'wall') {
    mesh = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 0.3), mat);
    mesh.position.y = 1.5;
  } else if (kind === 'floor') {
    mesh = new THREE.Mesh(new THREE.BoxGeometry(4, 0.3, 4), mat);
    mesh.position.y = 0.15;
  } else {
    mesh = new THREE.Mesh(new THREE.BoxGeometry(4, 0.3, 5), mat);
    mesh.rotation.x = -Math.atan2(3, 4);
    mesh.position.y = 1.5;
  }
  const g = new THREE.Group();
  g.add(mesh);
  return g;
}

// build piece collision AABB relative to its origin (y = its base level)
export function buildAABB(b) {
  if (b.kind === 'wall') {
    const c = Math.abs(Math.cos(b.rotY)) > 0.5;
    return c
      ? { min: [b.x - 2, b.y, b.z - 0.3], max: [b.x + 2, b.y + 3, b.z + 0.3] }
      : { min: [b.x - 0.3, b.y, b.z - 2], max: [b.x + 0.3, b.y + 3, b.z + 2] };
  }
  if (b.kind === 'floor') return { min: [b.x - 2, b.y - 0.15 + (b.y > 0 ? 2.85 : 0), b.z - 2], max: [b.x + 2, b.y + 0.3 + (b.y > 0 ? 2.85 : 0), b.z + 2] };
  return null; // ramps handled separately
}

// ---- simple weapon viewmodel meshes -------------------------------------------
export function makeGunMesh(kind) {
  const g = new THREE.Group();
  const dark = M(0x22262c), wood = M(0x6a4a26);
  if (kind === 'ar' || kind === 'smg' || kind === 'sniper') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, kind === 'sniper' ? 1.1 : 0.8), dark);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.25), wood);
    stock.position.z = kind === 'sniper' ? 0.6 : 0.45;
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.2, 0.1), dark);
    mag.position.set(0, -0.15, 0.05);
    g.add(body, stock, mag);
    if (kind === 'sniper') {
      const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.3, 8), dark);
      scope.rotation.x = Math.PI / 2;
      scope.position.set(0, 0.12, -0.1);
      g.add(scope);
    }
  } else if (kind === 'icebreaker' || kind === 'pump' || kind === 'doublebarrel') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.9), wood);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.7, 8), dark);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(kind === 'doublebarrel' ? -0.035 : 0, 0.06, -0.25);
    g.add(body, barrel);
    if (kind === 'doublebarrel') {
      const b2 = barrel.clone(); b2.position.x = 0.035; g.add(b2);
    }
  } else if (kind === 'crossbow') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.8), wood);
    const bow = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.06), dark);
    bow.position.z = -0.35;
    g.add(body, bow);
  } else if (kind === 'pistol') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.32), dark);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 0.1), wood);
    grip.position.set(0, -0.12, 0.1);
    g.add(body, grip);
  } else { // melee
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 6), wood);
    handle.rotation.x = 0.4;
    const headM = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.2, 0.3), M(0x8a8f95));
    headM.position.set(0, 0.3, -0.1);
    g.add(handle, headM);
  }
  return g;
}
