/**
 * Articulated 2D humanoid exercise animator (#65 / visual guides).
 *
 * Pure Canvas 2D renderer driven by keyframe JSON in js/data/animations.json.
 * Uses Catmull-Rom spline smoothing and 2-bone IK floor locking when
 * `anchor === 'feet'`. Zero external dependencies; pauses automatically when
 * its enclosing <details> is collapsed.
 */

const PI = Math.PI;
const RAD = PI / 180;
const DEG = 180 / PI;
const LEN = { torso: 52, head: 14, thigh: 41, shin: 41, foot: 13, uArm: 26, fArm: 24 };
const ANGLE_KEYS = new Set([
  'torso', 'head', 'thighF', 'shinF', 'footF',
  'thighB', 'shinB', 'footB', 'uArmF', 'fArmF', 'uArmB', 'fArmB'
]);

function lerp(a, b, t) { return a + (b - a) * t; }
function lerpAngle(a, b, t) {
  const diff = ((((b - a) % 360) + 540) % 360) - 180;
  return a + diff * t;
}
function unwrapAngle(ref, ang) {
  return ref + (((((ang - ref) % 360) + 540) % 360) - 180);
}
function catmull(p0, p1, p2, p3, u) {
  const u2 = u * u;
  const u3 = u2 * u;
  return 0.5 * (
    (2 * p1) +
    (-p0 + p2) * u +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * u3
  );
}
function stepFrom(x, y, deg, len) {
  return [x + Math.cos(deg * RAD) * len, y + Math.sin(deg * RAD) * len];
}

function solveTwoBoneIK(rootX, rootY, targetX, targetY, L1, L2, bendSign) {
  let dx = targetX - rootX;
  let dy = targetY - rootY;
  const maxReach = L1 + L2 - 0.5;
  const minReach = Math.abs(L1 - L2) + 0.5;
  let d = Math.hypot(dx, dy);
  if (d < minReach) d = minReach;
  if (d > maxReach) {
    dx = (dx / d) * maxReach;
    dy = (dy / d) * maxReach;
    d = maxReach;
  }
  const base = Math.atan2(dy, dx);
  const cosA = Math.max(-1, Math.min(1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d)));
  const a1 = base - bendSign * Math.acos(cosA);
  const midX = rootX + Math.cos(a1) * L1;
  const midY = rootY + Math.sin(a1) * L1;
  const a2 = Math.atan2((rootY + dy) - midY, (rootX + dx) - midX);
  return { a1: a1 * DEG, a2: a2 * DEG };
}

function palette() {
  const isLight = typeof document !== 'undefined' &&
    document.documentElement.classList.contains('light');
  return isLight ? {
    skin: '#d29b72', skinBack: '#b07b54',
    top: '#2563eb', topBack: '#1e40af',
    bottom: '#1e293b', bottomBack: '#0f172a',
    shoe: '#334155', shoeBack: '#1e293b',
    hair: '#2d2016',
    muscle: '#ef4444',
    gear: '#64748b', gearDark: '#334155',
    bench: '#7c2d12', benchPad: '#1e293b',
    mat: '#0d9488',
    floor: 'rgba(0,0,0,0.14)'
  } : {
    skin: '#d29b72', skinBack: '#a5714c',
    top: '#3b82f6', topBack: '#1d4ed8',
    bottom: '#334155', bottomBack: '#1e293b',
    shoe: '#475569', shoeBack: '#1e293b',
    hair: '#2d2016',
    muscle: '#f97316',
    gear: '#94a3b8', gearDark: '#475569',
    bench: '#9a3412', benchPad: '#334155',
    mat: '#14b8a6',
    floor: 'rgba(255,255,255,0.14)'
  };
}

function capsule(ctx, x1, y1, r1, x2, y2, r2, color) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const nx = Math.cos(a + PI / 2);
  const ny = Math.sin(a + PI / 2);
  ctx.beginPath();
  ctx.moveTo(x1 + nx * r1, y1 + ny * r1);
  ctx.lineTo(x2 + nx * r2, y2 + ny * r2);
  ctx.arc(x2, y2, r2, a + PI / 2, a - PI / 2);
  ctx.lineTo(x1 - nx * r1, y1 - ny * r1);
  ctx.arc(x1, y1, r1, a - PI / 2, a + PI / 2);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function circle(ctx, x, y, r, color) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function jointsOf(s) {
  const hip = [s.hipX, s.hipY];
  const sh = stepFrom(hip[0], hip[1], s.torso, LEN.torso);
  const head = stepFrom(sh[0], sh[1], s.head, LEN.head);
  const kneeB = stepFrom(hip[0], hip[1], s.thighB, LEN.thigh);
  const ankleB = stepFrom(kneeB[0], kneeB[1], s.shinB, LEN.shin);
  const footB = stepFrom(ankleB[0], ankleB[1], s.footB, LEN.foot);
  const kneeF = stepFrom(hip[0], hip[1], s.thighF, LEN.thigh);
  const ankleF = stepFrom(kneeF[0], kneeF[1], s.shinF, LEN.shin);
  const footF = stepFrom(ankleF[0], ankleF[1], s.footF, LEN.foot);
  const elbowB = stepFrom(sh[0], sh[1], s.uArmB, LEN.uArm);
  const handB = stepFrom(elbowB[0], elbowB[1], s.fArmB, LEN.fArm);
  const elbowF = stepFrom(sh[0], sh[1], s.uArmF, LEN.uArm);
  const handF = stepFrom(elbowF[0], elbowF[1], s.fArmF, LEN.fArm);
  return { hip, sh, head, kneeB, ankleB, footB, kneeF, ankleF, footF, elbowB, handB, elbowF, handF };
}

function drawHumanoid(ctx, s, prop, muscles = []) {
  const p = palette();
  const facing = s.facing ?? 1;
  const j = jointsOf(s);

  ctx.strokeStyle = p.floor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(20, 260);
  ctx.lineTo(280, 260);
  ctx.stroke();

  if (prop === 'mat') {
    ctx.fillStyle = p.mat + '44';
    ctx.fillRect(36, 254, 228, 6);
    ctx.fillStyle = p.mat;
    ctx.fillRect(36, 258, 228, 3);
  } else if (prop === 'bench') {
    ctx.fillStyle = p.bench;
    ctx.fillRect(84, 226, 6, 34);
    ctx.fillRect(184, 226, 6, 34);
    ctx.fillStyle = p.benchPad;
    ctx.beginPath();
    ctx.roundRect(72, 214, 130, 13, 4);
    ctx.fill();
  } else if (prop === 'pullup_bar') {
    ctx.fillStyle = p.gearDark;
    ctx.fillRect(40, 38, 220, 5);
  }

  // Far limbs
  capsule(ctx, j.sh[0], j.sh[1], 5.6, j.elbowB[0], j.elbowB[1], 4.4, p.topBack);
  capsule(ctx, j.elbowB[0], j.elbowB[1], 4.2, j.handB[0], j.handB[1], 3.3, p.skinBack);
  circle(ctx, j.handB[0], j.handB[1], 3.5, p.skinBack);
  capsule(ctx, j.hip[0], j.hip[1], 8.2, j.kneeB[0], j.kneeB[1], 5.8, p.bottomBack);
  capsule(ctx, j.kneeB[0], j.kneeB[1], 5.5, j.ankleB[0], j.ankleB[1], 3.8, p.skinBack);
  capsule(ctx, j.ankleB[0], j.ankleB[1], 4.0, j.footB[0], j.footB[1], 3.4, p.shoeBack);

  // Torso & pelvis
  capsule(ctx, j.hip[0], j.hip[1], 9.2, j.sh[0], j.sh[1], 11.0, p.top);
  circle(ctx, j.hip[0], j.hip[1], 8.8, p.bottom);

  if (muscles.includes('lats') || muscles.includes('upper_back')) {
    const [lx1, ly1] = stepFrom(j.sh[0], j.sh[1], s.torso + 180, 10);
    const [lx2, ly2] = stepFrom(j.hip[0], j.hip[1], s.torso, 18);
    capsule(ctx, lx1 - facing * 3.5, ly1, 5.8, lx2 - facing * 2.5, ly2, 4.5, p.muscle);
  }
  if (muscles.includes('chest')) {
    const [cx1, cy1] = stepFrom(j.sh[0], j.sh[1], s.torso + 180, 14);
    circle(ctx, cx1 + facing * 4, cy1, 6.2, p.muscle);
  }
  if (muscles.includes('abs') || muscles.includes('core')) {
    const [ax1, ay1] = stepFrom(j.hip[0], j.hip[1], s.torso, 16);
    const [ax2, ay2] = stepFrom(j.hip[0], j.hip[1], s.torso, 32);
    capsule(ctx, ax1 + facing * 3, ay1, 4.2, ax2 + facing * 3, ay2, 4.2, p.muscle);
  }
  if (muscles.includes('erectors') || muscles.includes('lower_back')) {
    const [sx1, sy1] = stepFrom(j.sh[0], j.sh[1], s.torso + 180, 10);
    const [sx2, sy2] = stepFrom(j.hip[0], j.hip[1], s.torso, 10);
    capsule(ctx, sx1 - facing * 5, sy1, 3.8, sx2 - facing * 4, sy2, 3.8, p.muscle);
  }

  // Head
  capsule(ctx, j.sh[0], j.sh[1], 4.5, j.head[0], j.head[1], 4.5, p.skin);
  circle(ctx, j.head[0], j.head[1], 10.5, p.skin);
  const [nx, ny] = stepFrom(j.head[0], j.head[1], s.head + facing * 82, 10.8);
  circle(ctx, nx, ny, 2.2, p.skin);
  ctx.beginPath();
  ctx.arc(j.head[0], j.head[1], 10.8, (s.head - 165 * facing) * RAD, (s.head - 15 * facing) * RAD, facing < 0);
  ctx.fillStyle = p.hair;
  ctx.fill();

  // Near leg
  capsule(ctx, j.hip[0], j.hip[1], 8.6, j.kneeF[0], j.kneeF[1], 6.0, p.bottom);
  if (muscles.includes('glutes')) {
    circle(ctx, j.hip[0] - facing * 4, j.hip[1] + 1, 6.2, p.muscle);
  }
  if (muscles.includes('quads')) {
    const midQ = [lerp(j.hip[0], j.kneeF[0], 0.5), lerp(j.hip[1], j.kneeF[1], 0.5)];
    capsule(ctx, j.hip[0] + facing * 1.5, j.hip[1] + 1.5, 4.8, midQ[0] + facing * 2.5, midQ[1], 4.0, p.muscle);
  }
  if (muscles.includes('hamstrings')) {
    const midH = [lerp(j.hip[0], j.kneeF[0], 0.5), lerp(j.hip[1], j.kneeF[1], 0.5)];
    capsule(ctx, j.hip[0] - facing * 2.5, j.hip[1] + 1.5, 4.5, midH[0] - facing * 2.5, midH[1], 3.8, p.muscle);
  }
  capsule(ctx, j.kneeF[0], j.kneeF[1], 5.8, j.ankleF[0], j.ankleF[1], 4.0, p.skin);
  if (muscles.includes('calves')) {
    const midC = [lerp(j.kneeF[0], j.ankleF[0], 0.35), lerp(j.kneeF[1], j.ankleF[1], 0.35)];
    circle(ctx, midC[0] - facing * 2, midC[1], 4.2, p.muscle);
  }
  capsule(ctx, j.ankleF[0], j.ankleF[1], 4.2, j.footF[0], j.footF[1], 3.6, p.shoe);

  if (prop === 'barbell') {
    const bx = j.sh[0] - 2 * facing;
    const by = j.sh[1] - 4;
    circle(ctx, bx, by, 17, p.gearDark);
    circle(ctx, bx, by, 14, p.gear);
    circle(ctx, bx, by, 3.5, p.gearDark);
  } else if (prop === 'barbell_hand') {
    const [hx, hy] = j.handF;
    circle(ctx, hx, hy, 16, p.gearDark);
    circle(ctx, hx, hy, 13, p.gear);
    circle(ctx, hx, hy, 3.2, p.gearDark);
  }

  // Near arm
  capsule(ctx, j.sh[0], j.sh[1], 6.0, j.elbowF[0], j.elbowF[1], 4.6, p.top);
  if (muscles.includes('front_delts') || muscles.includes('side_delts') || muscles.includes('rear_delts')) {
    circle(ctx, j.sh[0], j.sh[1], 5.2, p.muscle);
  }
  if (muscles.includes('biceps') || muscles.includes('triceps')) {
    const midA = [lerp(j.sh[0], j.elbowF[0], 0.5), lerp(j.sh[1], j.elbowF[1], 0.5)];
    circle(ctx, midA[0], midA[1], 4.0, p.muscle);
  }
  capsule(ctx, j.elbowF[0], j.elbowF[1], 4.4, j.handF[0], j.handF[1], 3.4, p.skin);
  circle(ctx, j.handF[0], j.handF[1], 3.6, p.skin);

  if (prop === 'dumbbell' || prop === 'bench') {
    const [hx, hy] = j.handF;
    ctx.fillStyle = p.gear;
    ctx.fillRect(hx - 11, hy - 2.5, 22, 5);
    ctx.fillStyle = p.gearDark;
    ctx.beginPath();
    ctx.roundRect(hx - 14, hy - 8, 6, 16, 2);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(hx + 8, hy - 8, 6, 16, 2);
    ctx.fill();
  } else if (prop === 'kettlebell') {
    const [hx, hy] = j.handF;
    ctx.strokeStyle = p.gear;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(hx, hy + 4, 5, PI, 0);
    ctx.stroke();
    circle(ctx, hx, hy + 11, 7.5, p.gearDark);
  }
}

function samplePose(spec, t) {
  const kfs = spec.keyframes;
  const n = kfs.length;
  if (n === 1) return kfs[0];
  const segFloat = t * n;
  const i = Math.floor(segFloat) % n;
  const prev = (i - 1 + n) % n;
  const next = (i + 1) % n;
  const next2 = (i + 2) % n;
  const u = segFloat - Math.floor(segFloat);
  const a0 = kfs[prev];
  const a = kfs[i];
  const b = kfs[next];
  const b2 = kfs[next2];

  const pose = {};
  for (const k of Object.keys(a)) {
    if (ANGLE_KEYS.has(k)) {
      const p1 = a[k];
      const p0 = unwrapAngle(p1, a0[k]);
      const p2 = unwrapAngle(p1, b[k]);
      const p3 = unwrapAngle(p2, b2[k]);
      pose[k] = catmull(p0, p1, p2, p3, u);
    } else if (typeof a[k] === 'number') {
      pose[k] = catmull(a0[k], a[k], b[k], b2[k], u);
    } else {
      pose[k] = a[k];
    }
  }

  if (spec.anchor === 'feet') {
    const baseAnkle = jointsOf(kfs[0]).ankleF;
    const maxReach = LEN.thigh + LEN.shin - 0.5;
    const dx = pose.hipX - baseAnkle[0];
    const dy = pose.hipY - baseAnkle[1];
    const d = Math.hypot(dx, dy);
    if (d > maxReach) {
      pose.hipX = baseAnkle[0] + (dx / d) * maxReach;
      pose.hipY = baseAnkle[1] + (dy / d) * maxReach;
    }
    const ik = solveTwoBoneIK(pose.hipX, pose.hipY, baseAnkle[0], baseAnkle[1], LEN.thigh, LEN.shin, pose.facing ?? 1);
    pose.thighF = ik.a1;
    pose.shinF = ik.a2;
    pose.thighB = ik.a1;
    pose.shinB = ik.a2;
  }
  return pose;
}

/**
 * Mount an animated humanoid canvas into `container` for `exercise` + `spec`.
 */
export function mountExerciseAnimation(container, exercise, spec) {
  if (!container || !spec?.keyframes?.length || typeof document === 'undefined') return;
  container.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'howto-anim-wrap';
  wrap.style.cssText = 'display:flex;align-items:center;gap:12px;margin:8px 0;flex-wrap:wrap;';

  const canvas = document.createElement('canvas');
  canvas.width = 300;
  canvas.height = 300;
  canvas.style.cssText = 'width:160px;height:160px;border-radius:8px;border:1px solid rgba(148,163,184,0.25);background:rgba(15,23,42,0.4);flex-shrink:0;';

  const ctx = canvas.getContext?.('2d');
  if (!ctx) return;

  let playing = true;
  let showMuscles = true;
  let startTime = null;
  let raf = null;
  const muscles = exercise?.primaryMuscles || [];

  const controls = document.createElement('div');
  controls.style.cssText = 'display:flex;flex-direction:column;gap:6px;font-size:12px;';

  const playBtn = document.createElement('button');
  playBtn.type = 'button';
  playBtn.className = 'ghost';
  playBtn.textContent = '⏸ Pause';
  playBtn.style.cssText = 'padding:4px 10px;font-size:12px;text-align:left;';

  const muscleLabel = document.createElement('label');
  muscleLabel.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:pointer;opacity:0.85;';
  const muscleCb = document.createElement('input');
  muscleCb.type = 'checkbox';
  muscleCb.checked = true;
  muscleLabel.append(muscleCb, document.createTextNode('Target muscles'));

  controls.append(playBtn, muscleLabel);
  wrap.append(canvas, controls);
  container.append(wrap);

  const duration = spec.duration || 3000;
  const details = container.closest('details');

  function renderAt(t) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const pose = samplePose(spec, t);
    drawHumanoid(ctx, pose, spec.prop || 'none', showMuscles ? muscles : []);
  }

  function tick(ts) {
    if (!playing || (details && !details.open)) {
      raf = null;
      return;
    }
    if (!startTime) startTime = ts;
    const t = ((ts - startTime) % duration) / duration;
    renderAt(t);
    raf = requestAnimationFrame(tick);
  }

  playBtn.addEventListener('click', () => {
    playing = !playing;
    playBtn.textContent = playing ? '⏸ Pause' : '▶ Play';
    if (playing) {
      startTime = null;
      raf = requestAnimationFrame(tick);
    } else if (raf) {
      cancelAnimationFrame(raf);
      raf = null;
    }
  });

  muscleCb.addEventListener('change', () => {
    showMuscles = muscleCb.checked;
    if (!playing) renderAt(0);
  });

  if (details) {
    details.addEventListener('toggle', () => {
      if (details.open && playing && !raf) {
        startTime = null;
        raf = requestAnimationFrame(tick);
      }
    });
  }

  renderAt(0);
  raf = requestAnimationFrame(tick);
}
