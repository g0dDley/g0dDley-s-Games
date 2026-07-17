// Zombieville — procedural nighttime downtown road. All textures generated in code.
import * as THREE from 'three';
import { MAP, BARRICADE_MAX_HP, BALCONY, BALCONIES, HERO_SPAWNS, LADDERS, FIRE_ESCAPE_TOP } from './shared.js';

function canvasTex(w, h, draw, repeatX = 1, repeatY = 1) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function rand(a, b) { return a + Math.random() * (b - a); }
function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

// ---------------------------------------------------------------------------
export function makeAsphalt() {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#191b1e'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      const v = 18 + Math.random() * 30;
      g.fillStyle = `rgb(${v},${v},${v + 3})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    // cracks
    g.strokeStyle = '#0c0d0f'; g.lineWidth = 1.5;
    for (let i = 0; i < 7; i++) {
      g.beginPath();
      let x = Math.random() * w, y = Math.random() * h;
      g.moveTo(x, y);
      for (let s = 0; s < 8; s++) { x += rand(-22, 22); y += rand(-22, 22); g.lineTo(x, y); }
      g.stroke();
    }
  }, 4, 40);
}

export function makeSidewalk() {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#2c2e31'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1600; i++) {
      const v = 36 + Math.random() * 26;
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    g.strokeStyle = '#1a1b1d'; g.lineWidth = 3;
    for (let x = 0; x <= w; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y <= h; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  }, 2, 60);
}

function makeBuildingTex(hue) {
  return canvasTex(256, 512, (g, w, h) => {
    const base = 18 + Math.random() * 14;
    g.fillStyle = `hsl(${hue}, ${8 + Math.random() * 10}%, ${base * 0.35}%)`;
    g.fillRect(0, 0, w, h);
    // noise
    for (let i = 0; i < 1200; i++) {
      g.fillStyle = `rgba(0,0,0,${Math.random() * 0.25})`;
      g.fillRect(Math.random() * w, Math.random() * h, 3, 3);
    }
    // windows
    const cols = 5, rows = 10, mw = 22, mh = 26;
    const cw = w / cols, ch = h / rows;
    for (let cx = 0; cx < cols; cx++) {
      for (let cy = 0; cy < rows; cy++) {
        const lit = Math.random() < 0.08;
        const broken = Math.random() < 0.22;
        g.fillStyle = lit ? `rgba(255, ${180 + Math.random() * 50 | 0}, 90, 0.85)` : (broken ? '#050608' : '#0a0e14');
        g.fillRect(cx * cw + (cw - mw) / 2, cy * ch + (ch - mh) / 2, mw, mh);
        if (broken && !lit) {
          g.strokeStyle = '#1c2733'; g.lineWidth = 1;
          g.beginPath();
          g.moveTo(cx * cw + cw / 2 - 8, cy * ch + ch / 2 - 8);
          g.lineTo(cx * cw + cw / 2 + 6, cy * ch + ch / 2 + 9);
          g.stroke();
        }
      }
    }
  }, 1, 1);
}

function makeBoardsTex() {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#241a10'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 32) {
      g.fillStyle = `hsl(28, ${28 + Math.random() * 14}%, ${14 + Math.random() * 10}%)`;
      g.fillRect(0, y + 2, w, 28);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      for (let i = 0; i < 26; i++) g.fillRect(Math.random() * w, y + 2 + Math.random() * 26, 6, 1.4);
    }
  }, 2, 2);
}

export function makeSkybox(scene) {
  // generated night sky: gradient + stars + sickly green-red martian glow on horizon
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 512;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#01030a');
  grad.addColorStop(0.55, '#04101e');
  grad.addColorStop(0.8, '#0c2a24');
  grad.addColorStop(1, '#3a1712');
  g.fillStyle = grad; g.fillRect(0, 0, 1024, 512);
  for (let i = 0; i < 700; i++) {
    const y = Math.random() * 360;
    g.fillStyle = `rgba(255,255,255,${Math.random() * 0.8})`;
    g.fillRect(Math.random() * 1024, y, Math.random() < 0.05 ? 2 : 1, 1);
  }
  // Mars, ominous and red
  const mx = 700, my = 120;
  const mg = g.createRadialGradient(mx, my, 2, mx, my, 46);
  mg.addColorStop(0, '#ff8a66'); mg.addColorStop(0.4, '#c53b22'); mg.addColorStop(1, 'rgba(120,20,10,0)');
  g.fillStyle = mg; g.beginPath(); g.arc(mx, my, 46, 0, 7); g.fill();
  g.fillStyle = '#e2593a'; g.beginPath(); g.arc(mx, my, 22, 0, 7); g.fill();
  g.fillStyle = '#b8462c'; g.beginPath(); g.arc(mx - 6, my + 4, 7, 0, 7); g.fill();
  g.beginPath(); g.arc(mx + 8, my - 6, 5, 0, 7); g.fill();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = tex;
}

// ---------------------------------------------------------------------------
export function buildWorld(scene) {
  const solids = [];   // AABBs for player collision: {min:[x,y,z], max:[x,y,z]}

  makeSkybox(scene);
  scene.fog = new THREE.FogExp2(0x0a1116, 0.017);

  const amb = new THREE.AmbientLight(0x4a5a6e, 1.5);
  scene.add(amb);
  const moon = new THREE.DirectionalLight(0x8899cc, 0.55);
  moon.position.set(30, 60, -40);
  scene.add(moon);
  const fill = new THREE.HemisphereLight(0x30435a, 0x1c140f, 0.5);
  scene.add(fill);

  const L = MAP.maxZ - MAP.minZ + 60;
  const zc = (MAP.maxZ + MAP.minZ) / 2;

  // road
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(MAP.roadHalfW * 2, L),
    new THREE.MeshLambertMaterial({ map: makeAsphalt() })
  );
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0, zc);
  scene.add(road);

  // centre line
  const lineTex = canvasTex(32, 128, (g) => {
    g.fillStyle = '#0000'; g.fillRect(0, 0, 32, 128);
    g.fillStyle = '#8a7b28'; g.fillRect(12, 8, 8, 56);
  }, 1, 60);
  lineTex.transparent = true;
  const line = new THREE.Mesh(new THREE.PlaneGeometry(1.2, L), new THREE.MeshBasicMaterial({ map: lineTex, transparent: true, opacity: 0.6 }));
  line.rotation.x = -Math.PI / 2; line.position.set(0, 0.01, zc);
  scene.add(line);

  // sidewalks
  const swTex = makeSidewalk();
  for (const side of [-1, 1]) {
    const sw = new THREE.Mesh(
      new THREE.BoxGeometry(MAP.walkHalfW - MAP.roadHalfW, 0.25, L),
      new THREE.MeshLambertMaterial({ map: swTex })
    );
    sw.position.set(side * (MAP.roadHalfW + (MAP.walkHalfW - MAP.roadHalfW) / 2), 0.125, zc);
    scene.add(sw);
  }

  // buildings along both sides
  const boardsTex = makeBoardsTex();
  for (const side of [-1, 1]) {
    let z = MAP.minZ - 10;
    while (z < MAP.maxZ + 20) {
      const depth = rand(14, 26);
      const width = rand(10, 18);
      const height = rand(12, 34);
      const hue = pick([210, 200, 30, 350, 190]);
      const bx = side * (MAP.walkHalfW + width / 2 + 0.2);
      const geo = new THREE.BoxGeometry(width, height, depth);
      const mat = new THREE.MeshLambertMaterial({ map: makeBuildingTex(hue) });
      const b = new THREE.Mesh(geo, mat);
      b.position.set(bx, height / 2, z + depth / 2);
      scene.add(b);
      solids.push({ min: [bx - width / 2, 0, z], max: [bx + width / 2, height, z + depth] });
      // some ground-floor boards
      if (Math.random() < 0.5) {
        const bd = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.7, 3), new THREE.MeshLambertMaterial({ map: boardsTex }));
        bd.position.set(bx - side * (width / 2 + 0.05), 1.6, z + depth / 2);
        bd.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
        scene.add(bd);
      }
      z += depth + rand(1, 6);
    }
  }

  // blocked intersections: rubble walls across occasional side gaps
  const rubbleMat = new THREE.MeshLambertMaterial({ color: 0x2e2b28 });
  for (let z = MAP.minZ + 40; z < MAP.maxZ - 30; z += rand(60, 90)) {
    for (const side of [-1, 1]) {
      if (Math.random() < 0.5) continue;
      for (let i = 0; i < 8; i++) {
        const r = new THREE.Mesh(new THREE.BoxGeometry(rand(1.5, 3.5), rand(0.8, 2.4), rand(1.5, 3)), rubbleMat);
        r.position.set(side * (MAP.walkHalfW - rand(0, 2)), r.geometry.parameters.height / 2, z + rand(-4, 4));
        r.rotation.y = rand(0, 3);
        scene.add(r);
      }
    }
  }

  // wrecked cars on the road
  const carBodyMats = [0x4a3b33, 0x33424a, 0x45332e, 0x3a4133].map(cx => new THREE.MeshLambertMaterial({ color: cx }));
  for (let i = 0; i < 14; i++) {
    const car = new THREE.Group();
    const bodyMat = pick(carBodyMats);
    const body = new THREE.Mesh(new THREE.BoxGeometry(2, 0.9, 4.4), bodyMat);
    body.position.y = 0.75;
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 2.2), bodyMat);
    cab.position.set(0, 1.5, -0.2);
    car.add(body, cab);
    for (const [wx, wz] of [[-1, 1.5], [1, 1.5], [-1, -1.5], [1, -1.5]]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.25, 10), new THREE.MeshLambertMaterial({ color: 0x111111 }));
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(wx, 0.36, wz);
      car.add(wheel);
    }
    const cx = rand(-MAP.roadHalfW + 2, MAP.roadHalfW - 2);
    const cz = rand(MAP.minZ + 40, MAP.doorZ - 30);
    car.position.set(cx, 0, cz);
    car.rotation.y = rand(0, Math.PI * 2);
    scene.add(car);
    solids.push({ min: [cx - 2.3, 0, cz - 2.3], max: [cx + 2.3, 1.9, cz + 2.3] });
  }

  // street lights (dim, flickering handled in game loop via userData)
  const flickers = [];
  for (let z = MAP.minZ + 20; z < MAP.maxZ; z += 34) {
    const side = (z / 34 | 0) % 2 === 0 ? -1 : 1;
    const px = side * (MAP.roadHalfW + 1.2);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 7, 6), new THREE.MeshLambertMaterial({ color: 0x22262b }));
    pole.position.set(px, 3.5, z);
    scene.add(pole);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 0.12), pole.material);
    arm.position.set(px - side * 1.1, 6.9, z);
    scene.add(arm);
    if (Math.random() < 0.72) {
      const lamp = new THREE.PointLight(0xffb066, 12, 22, 1.8);
      lamp.position.set(px - side * 2.1, 6.6, z);
      scene.add(lamp);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffcc88 }));
      bulb.position.copy(lamp.position);
      scene.add(bulb);
      if (Math.random() < 0.4) flickers.push({ light: lamp, bulb, base: lamp.intensity, seed: Math.random() * 10 });
    }
  }

  // ---- SAFEHOUSE at the end ------------------------------------------------
  const shW = 26, shH = 10, shD = 16;
  const shTex = makeBuildingTex(30);
  const sh = new THREE.Mesh(new THREE.BoxGeometry(shW, shH, shD), new THREE.MeshLambertMaterial({ map: shTex }));
  sh.position.set(0, shH / 2, MAP.doorZ + shD / 2 + 0.5);
  scene.add(sh);
  // wall is solid except the door hole (handled by two side boxes)
  solids.push({ min: [-shW / 2, 0, MAP.doorZ], max: [-4, shH, MAP.doorZ + shD] });
  solids.push({ min: [4, 0, MAP.doorZ], max: [shW / 2, shH, MAP.doorZ + shD] });
  solids.push({ min: [-shW / 2, 4.4, MAP.doorZ], max: [shW / 2, shH, MAP.doorZ + shD] }); // lintel

  // boarded windows either side of door
  for (const side of [-1, 1]) {
    const bw = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 2.6), new THREE.MeshLambertMaterial({ map: boardsTex }));
    bw.position.set(side * 8, 2.2, MAP.doorZ - 0.05);
    bw.rotation.y = Math.PI;
    scene.add(bw);
  }

  // BARRICADE DOOR (the objective) — boards over a warm doorway
  const doorGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(7.6, 4.2),
    new THREE.MeshBasicMaterial({ color: 0xffcf8a })
  );
  doorGlow.position.set(0, 2.1, MAP.doorZ + 0.35);
  doorGlow.rotation.y = Math.PI;
  scene.add(doorGlow);
  // survivor silhouettes
  const silMat = new THREE.MeshBasicMaterial({ color: 0x1a120a });
  for (const sx of [-2.2, -0.6, 1.4]) {
    const s = new THREE.Group();
    const bodyS = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.9, 3, 8), silMat);
    bodyS.position.y = 1.0;
    const headS = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), silMat);
    headS.position.y = 1.85;
    s.add(bodyS, headS);
    s.position.set(sx, 0, MAP.doorZ + 0.34);
    s.scale.setScalar(0.9);
    scene.add(s);
  }
  const doorLight = new THREE.PointLight(0xffbb66, 20, 26, 1.6);
  doorLight.position.set(0, 3, MAP.doorZ - 3);
  scene.add(doorLight);

  const barricade = new THREE.Group();
  const boardMat = new THREE.MeshLambertMaterial({ map: boardsTex });
  const boards = [];
  for (let i = 0; i < 7; i++) {
    const bmesh = new THREE.Mesh(new THREE.BoxGeometry(8.2, 0.55, 0.22), boardMat);
    bmesh.position.set(rand(-0.3, 0.3), 0.5 + i * 0.58, 0);
    bmesh.rotation.z = rand(-0.08, 0.08);
    barricade.add(bmesh);
    boards.push(bmesh);
  }
  const steel = new THREE.Mesh(new THREE.BoxGeometry(8.4, 4.4, 0.12), new THREE.MeshLambertMaterial({ color: 0x3c4450 }));
  steel.position.set(0, 2.2, 0.18);
  barricade.add(steel);
  barricade.position.set(0, 0, MAP.doorZ + 0.1);
  scene.add(barricade);

  // ---- hard map boundaries (invisible collision) ---------------------------
  // Nobody can pass behind the final barricade or leave the playable strip.
  solids.push({ min: [-99, 0, MAP.doorZ - 0.1], max: [99, 30, MAP.maxZ + 8] });   // behind barricade
  solids.push({ min: [MAP.walkHalfW, 0, MAP.minZ - 8], max: [MAP.walkHalfW + 40, 30, MAP.maxZ + 8] });   // right edge
  solids.push({ min: [-MAP.walkHalfW - 40, 0, MAP.minZ - 8], max: [-MAP.walkHalfW, 30, MAP.maxZ + 8] }); // left edge

  // ---- two side fire-escape balconies bolted to the buildings --------------
  // They run ALONG the road (never across the street). Heroes respawn on them
  // and press F at the ladder to climb. Geometry comes from shared.js so the
  // server spawns line up exactly. Zombies cannot use the ladders.
  const ladders = [];
  const platforms = [];               // walk-on top surfaces {minX,maxX,minZ,maxZ,y}
  const ladderMat = new THREE.MeshLambertMaterial({ color: 0x2b2f36 });
  const grateMat = new THREE.MeshLambertMaterial({ color: 0x3a4048 });
  const balcTop = BALCONY.y, balcD = BALCONY.depthX, balcL = BALCONY.lenZ;
  BALCONIES.forEach((bal, bi) => {
    const cx = bal.x, cz = bal.z, top = balcTop, D = balcD, Lz = balcL;
    const inner = cx > 0 ? -1 : 1;    // toward the road
    // grated deck running along Z, flush to the building wall
    const deck = new THREE.Mesh(new THREE.BoxGeometry(D, 0.2, Lz), grateMat);
    deck.position.set(cx, top, cz);
    scene.add(deck);
    platforms.push({ minX: cx - D / 2, maxX: cx + D / 2, minZ: cz - Lz / 2, maxZ: cz + Lz / 2, y: top });
    // road-facing railing + end railings + support posts
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, Lz), ladderMat);
    rail.position.set(cx + inner * D / 2, top + 0.5, cz); scene.add(rail);
    for (const sz of [cz - Lz / 2, cz + Lz / 2]) {
      const endRail = new THREE.Mesh(new THREE.BoxGeometry(D, 0.9, 0.1), ladderMat);
      endRail.position.set(cx, top + 0.5, sz); scene.add(endRail);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, top, 0.22), ladderMat);
      post.position.set(cx + inner * D / 2, top / 2, sz); scene.add(post);
    }
    // glowing respawn pads for this balcony's two seats
    HERO_SPAWNS.filter((s) => Math.abs(s.x - cx) < 0.01).forEach((s) => {
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.06, 16),
        new THREE.MeshBasicMaterial({ color: 0x2effa0, transparent: true, opacity: 0.5 }));
      pad.position.set(s.x, top + 0.12, s.z); scene.add(pad);
    });
    // ladder on the inner edge down to the street
    const lad = LADDERS[bi];
    for (const rz of [-0.35, 0.35]) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(0.1, top, 0.1), ladderMat);
      r.position.set(lad.x, top / 2, lad.z + rz); scene.add(r);
    }
    for (let ry = 0.4; ry < top; ry += 0.5) {
      const rung = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.85), ladderMat);
      rung.position.set(lad.x, ry, lad.z); scene.add(rung);
    }
    ladders.push({ x: lad.x, z: lad.z, top });
    const lamp = new THREE.PointLight(0xffcc88, 6, 14, 2);
    lamp.position.set(cx, top + 1.6, cz); scene.add(lamp);
  });

  // zombie spawn end: sickly green glow + crashed saucer hint
  const spawnLight = new THREE.PointLight(0x66ff88, 30, 60, 1.4);
  spawnLight.position.set(0, 8, MAP.spawnZ - 6);
  scene.add(spawnLight);
  const saucer = new THREE.Mesh(new THREE.CylinderGeometry(9, 12, 2.4, 18), new THREE.MeshLambertMaterial({ color: 0x3d4a44 }));
  saucer.position.set(-16, 3, MAP.spawnZ - 16);
  saucer.rotation.z = 0.5;
  scene.add(saucer);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(4.4, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x6fae8e, transparent: true, opacity: 0.7 }));
  dome.position.set(-16, 4.2, MAP.spawnZ - 16);
  dome.rotation.z = 0.5;
  scene.add(dome);

  // end wall behind spawn
  const endWall = new THREE.Mesh(new THREE.BoxGeometry(MAP.walkHalfW * 2 + 40, 20, 2), new THREE.MeshLambertMaterial({ color: 0x121417 }));
  endWall.position.set(0, 10, MAP.minZ - 4);
  scene.add(endWall);
  solids.push({ min: [-99, 0, MAP.minZ - 6], max: [99, 30, MAP.minZ - 2] });

  // ground plane beyond road (dirt)
  const dirt = new THREE.Mesh(new THREE.PlaneGeometry(400, L + 200), new THREE.MeshLambertMaterial({ color: 0x15130f }));
  dirt.rotation.x = -Math.PI / 2;
  dirt.position.set(0, -0.05, zc);
  scene.add(dirt);

  function setBarricadeHp(hp) {
    const f = hp / BARRICADE_MAX_HP;
    boards.forEach((bm, i) => { bm.visible = (i / boards.length) < f + 0.01; });
    steel.visible = f > 0;
    const shake = f < 0.35 && hp > 0;
    barricade.userData.shake = shake;
  }

  return { solids, flickers, barricade, setBarricadeHp, ladders, platforms };
}
