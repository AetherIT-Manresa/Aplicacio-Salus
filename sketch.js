// MoviSalus · p5.js + ml5.js (bodyPose / MoveNet)
const DURADA = 30000;           // 30 segons
let video, bodyPose, poses = [];
let videoOk = false, modelOk = false;
let estat = 'menu';             // menu | carregant | posicio | joc | final
let okFrames = 0, puntuacio = 0, inici = 0;
let objectiu = null, cua = [], ultim = null, tHold = 0, pausaFins = 0;
const HOLD = 600;               // ms que cal mantenir cada moviment (suau per a gent gran)

// Configuració dels braços (com els veu l'usuari al "mirall": L = costat esquerre, R = costat dret)
const BRAC = {
  down:     { el: [0.40, 0.40],  wr: [0.40, 0.85] },
  up:       { el: [0.45, -0.45], wr: [0.45, -0.90] },
  obert:    { el: [0.70, 0.00],  wr: [1.10, 0.00] },
  espatlla: { el: [0.60, 0.35],  wr: [0.30, -0.05] }
};
const MOVS = {
  amunt:     { L: 'up',       R: 'up',       txt: 'Aixeca els dos braços' },
  dreta:     { L: 'down',     R: 'up',       txt: 'Aixeca només el braç dret' },
  esquerra:  { L: 'up',       R: 'down',     txt: 'Aixeca només el braç esquerre' },
  obert:     { L: 'obert',    R: 'obert',    txt: 'Obre els braços cap als costats' },
  espatlles: { L: 'espatlla', R: 'espatlla', txt: 'Posa les mans a les espatlles' }
};
let audioCtx;

const $ = id => document.getElementById(id);

function setup() {
  const c = createCanvas(windowWidth, windowHeight);
  c.parent('canvasHolder');
  noLoop();
  $('btnExercici').onclick = iniciar;
  $('btnInstruccions').onclick = () => mostra('instruccions');
  $('btnTornar').onclick = () => mostra('menu');
  $('btnComencar').onclick = comencar;
  $('btnFinalitzar').onclick = tornarAlMenu;
}
function windowResized() { resizeCanvas(windowWidth, windowHeight); }

// ---------- Pantalles ----------
function mostra(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(id).classList.add('active');
  $('canvasHolder').classList.toggle('visible', id === 'joc' || id === 'final');
}
function ensurAudio() {
  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}
function so(freq, durada, inici = 0, tipus = 'sine', vol = 0.3) {
  const t = audioCtx.currentTime + inici, o = audioCtx.createOscillator(), g = audioCtx.createGain();
  o.type = tipus; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + durada);
  o.connect(g).connect(audioCtx.destination); o.start(t); o.stop(t + durada);
}

// ---------- Flux ----------
function iniciar() {
  ensurAudio();
  estat = 'carregant'; videoOk = false; poses = [];
  mostra('joc');
  $('btnComencar').classList.add('amagat');
  $('btnComencar').disabled = true;
  $('missatge').textContent = 'Carregant la càmera... accepta el permís si te\'l demana.';
  video = createCapture(VIDEO, { flipped: true }, () => { videoOk = true; provaEngegar(); });
  video.hide();
  if (!bodyPose) bodyPose = ml5.bodyPose('MoveNet', { flipped: true }, () => { modelOk = true; provaEngegar(); });
  else modelOk = true;
  loop();
}
function provaEngegar() {
  if (!(videoOk && modelOk)) return;
  bodyPose.detectStart(video, r => poses = r);
  estat = 'posicio'; okFrames = 0;
  $('btnComencar').classList.remove('amagat');
}
function comencar() {
  estat = 'joc'; puntuacio = 0; inici = millis(); cua = []; ultim = null; pausaFins = 0; seguent();
  $('btnComencar').classList.add('amagat');
  $('missatge').textContent = '';
  so(660, 0.15); so(880, 0.25, 0.18);
}
function acabar() {
  estat = 'final';
  bodyPose.detectStop();
  // botzina final
  so(220, 0.9, 0, 'sawtooth', 0.4); so(220, 0.9, 1.0, 'sawtooth', 0.4);
  $('puntFinal').textContent = puntuacio;
  $('missatge').textContent = '';
  mostra('final');
}
function tornarAlMenu() {
  noLoop(); estat = 'menu';
  if (video) { video.remove(); video = null; }
  mostra('menu');
}

// ---------- Utilitats de pose ----------
function escala() {
  const vw = video.elt.videoWidth || 640, vh = video.elt.videoHeight || 480;
  const s = max(width / vw, height / vh);
  return { s, ox: (width - vw * s) / 2, oy: (height - vh * s) / 2 };
}
function punts() {
  if (!poses.length) return null;
  const { s, ox, oy } = escala(), p = {};
  for (const k of poses[0].keypoints) p[k.name] = { x: k.x * s + ox, y: k.y * s + oy, c: k.confidence };
  return p;
}
const OK = (p, ...n) => n.every(k => p[k] && p[k].c > 0.3);

// Comprova si l'usuari està ben col·locat. Retorna {ok, msg}
function revisaPosicio(p) {
  if (!p || !OK(p, 'nose', 'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow', 'left_wrist', 'right_wrist'))
    return { ok: false, msg: 'Col·loca\'t davant la càmera: han de veure\'s el cap, els braços i les mans' };
  const cx = (p.left_shoulder.x + p.right_shoulder.x) / 2, cy = (p.left_shoulder.y + p.right_shoulder.y) / 2;
  const ample = abs(p.left_shoulder.x - p.right_shoulder.x);
  if (ample < width * 0.12) return { ok: false, msg: 'Apropa\'t una mica a la càmera' };
  if (ample > width * 0.40) return { ok: false, msg: 'Allunya\'t una mica de la càmera' };
  if (cx < width * 0.38) return { ok: false, msg: 'Mou-te una mica cap a la dreta ➡' };
  if (cx > width * 0.62) return { ok: false, msg: '⬅ Mou-te una mica cap a l\'esquerra' };
  if (cy < height * 0.28 || cy > height * 0.62) return { ok: false, msg: 'Ajusta l\'alçada: el cap ha d\'entrar al contorn' };
  return { ok: true, msg: 'Perfecte! Mantén la posició i prem COMENÇAR!' };
}

// ---------- Dibuix ----------
function draw() {
  background(0);
  if (!video || estat === 'carregant') return;
  const r = dimVideo();
  image(video, r.x, r.y, r.w, r.h);
  const p = punts();
  if (estat === 'posicio') fasePosicio(p);
  else if (estat === 'joc') faseJoc(p);
  if (p && (estat === 'joc' || estat === 'posicio')) dibuixaEsquelet(p);
}
function dimVideo() {
  const { s, ox, oy } = escala();
  const vw = video.elt.videoWidth || 640, vh = video.elt.videoHeight || 480;
  return { x: ox, y: oy, w: vw * s, h: vh * s };
}
// image(video, x, y, w, h) amb l'ordre correcte
function fasePosicio(p) {
  const r = revisaPosicio(p);
  okFrames = r.ok ? okFrames + 1 : 0;
  const llest = okFrames > 20;
  $('btnComencar').disabled = !llest;
  $('missatge').textContent = r.msg;
  $('missatge').style.background = llest ? 'rgba(25,135,84,.85)' : 'rgba(0,0,0,.65)';
  dibuixaSilueta(llest ? color(45, 198, 83) : color(255));
}

function dibuixaSilueta(col) {
  // imatge de referència: contorn on cal col·locar-se
  const cx = width / 2, h = height;
  push();
  noFill(); stroke(col); strokeWeight(6); drawingContext.setLineDash([18, 14]);
  ellipse(cx, h * 0.27, h * 0.16, h * 0.2);                       // cap
  line(cx, h * 0.37, cx, h * 0.75);                               // tors
  line(cx - h * 0.2, h * 0.42, cx + h * 0.2, h * 0.42);           // espatlles
  line(cx - h * 0.2, h * 0.42, cx - h * 0.26, h * 0.66);          // braç esq.
  line(cx + h * 0.2, h * 0.42, cx + h * 0.26, h * 0.66);          // braç dret
  drawingContext.setLineDash([]);
  pop();
}

// ---------- Moviments ----------
function seguent() {
  if (!cua.length) {
    cua = shuffle(Object.keys(MOVS));
    if (cua[0] === ultim) cua.push(cua.shift());
  }
  objectiu = cua.shift(); ultim = objectiu; tHold = 0;
}
// Assigna esquerra/dreta segons la posició a la pantalla (més robust que els noms del model)
function costats(p) {
  if (!OK(p, 'left_shoulder', 'right_shoulder', 'left_wrist', 'right_wrist')) return null;
  const lEsq = p.left_shoulder.x < p.right_shoulder.x;
  const a = lEsq ? 'left_' : 'right_', b = lEsq ? 'right_' : 'left_';
  const c = { L: { sh: p[a + 'shoulder'], wr: p[a + 'wrist'] }, R: { sh: p[b + 'shoulder'], wr: p[b + 'wrist'] } };
  c.ample = abs(c.L.sh.x - c.R.sh.x);
  c.sy = (c.L.sh.y + c.R.sh.y) / 2;
  return c;
}
function compleix(id, c) {
  const a = c.ample, sy = c.sy;
  const amunt = w => w.y < sy - a * 0.15;
  const avall = w => w.y > sy + a * 0.25;
  const L = c.L, R = c.R;
  switch (id) {
    case 'amunt':    return amunt(L.wr) && amunt(R.wr);
    case 'dreta':    return amunt(R.wr) && avall(L.wr);
    case 'esquerra': return amunt(L.wr) && avall(R.wr);
    case 'obert':    return L.wr.x < L.sh.x - a * 0.5 && R.wr.x > R.sh.x + a * 0.5 &&
                            abs(L.wr.y - sy) < a * 0.6 && abs(R.wr.y - sy) < a * 0.6;
    case 'espatlles':return dist(L.wr.x, L.wr.y, L.sh.x, L.sh.y) < a * 0.6 &&
                            dist(R.wr.x, R.wr.y, R.sh.x, R.sh.y) < a * 0.6;
  }
  return false;
}

function faseJoc(p) {
  const ara = millis(), restant = max(0, DURADA - (ara - inici));
  const enPausa = ara < pausaFins;
  const c = p && costats(p);
  if (!enPausa) {
    if (c && compleix(objectiu, c)) {
      if (!tHold) tHold = ara;
      if (ara - tHold >= HOLD) {
        puntuacio++; so(880, 0.15, 0, 'triangle'); so(1175, 0.2, 0.12, 'triangle');
        pausaFins = ara + 1000; seguent();
      }
    } else tHold = 0;
  }
  // HUD: puntuació i temps
  push();
  noStroke(); fill(0, 160); rect(20, 20, 260, 120, 20); rect(width - 280, 20, 260, 120, 20);
  fill(255); textAlign(CENTER, CENTER); textSize(24);
  text('PUNTS', 150, 45); text('TEMPS', width - 150, 45);
  textSize(72); textStyle(BOLD);
  fill(255, 183, 3); text(puntuacio, 150, 100);
  fill(restant < 6000 ? color(255, 80, 80) : 255); text(ceil(restant / 1000), width - 150, 100);
  pop();
  // Targeta del moviment actual
  const w = min(width - 40, 680), h = 160, x = (width - w) / 2, y = height - h - 20;
  push();
  noStroke(); fill(enPausa ? color(25, 135, 84, 235) : color(255, 255, 255, 235)); rect(x, y, w, h, 26);
  pictograma(MOVS[objectiu], x + 85, y + 62, 110);
  textAlign(LEFT, CENTER); textStyle(BOLD);
  fill(enPausa ? 255 : color(11, 61, 145)); textSize(min(38, w / 15));
  text(enPausa ? 'Molt bé! ✔' : MOVS[objectiu].txt, x + 165, y + 55, w - 185, 90);
  if (!enPausa) {                        // barra de progrés del moviment
    fill(210); rect(x + 165, y + h - 38, w - 195, 16, 8);
    fill(45, 198, 83); rect(x + 165, y + h - 38, (w - 195) * (tHold ? min(1, (ara - tHold) / HOLD) : 0), 16, 8);
  }
  pop();
  if (restant <= 0) acabar();
}

// Dibuixa el ninot que mostra el moviment que cal fer
function pictograma(m, cx, cy, mida) {
  const k = mida / 2.4;
  push(); translate(cx, cy);
  strokeCap(ROUND); strokeJoin(ROUND); noFill();
  stroke(11, 61, 145); strokeWeight(k * 0.2);
  line(0, 0, 0, k * 0.95);                                   // tors
  line(0, k * 0.95, -k * 0.25, k * 1.4); line(0, k * 0.95, k * 0.25, k * 1.4);
  for (const [costat, signe] of [['L', -1], ['R', 1]]) {
    const cfg = BRAC[m[costat]];
    stroke(m[costat] === 'down' ? color(11, 61, 145) : color(251, 86, 7));
    beginShape();
    vertex(signe * 0.3 * k, 0); vertex(signe * cfg.el[0] * k, cfg.el[1] * k); vertex(signe * cfg.wr[0] * k, cfg.wr[1] * k);
    endShape();
  }
  noStroke(); fill(255, 183, 3); circle(0, -k * 0.5, k * 0.5);  // cap
  pop();
}

function dibuixaEsquelet(p) {
  const parells = [['left_shoulder', 'right_shoulder'], ['left_shoulder', 'left_elbow'], ['left_elbow', 'left_wrist'],
                   ['right_shoulder', 'right_elbow'], ['right_elbow', 'right_wrist']];
  push();
  stroke(255, 183, 3); strokeWeight(10); strokeCap(ROUND);
  for (const [a, b] of parells) if (OK(p, a, b)) line(p[a].x, p[a].y, p[b].x, p[b].y);
  noStroke();
  for (const k of ['left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow']) if (OK(p, k)) { fill(11, 61, 145); circle(p[k].x, p[k].y, 26); }
  for (const k of ['left_wrist', 'right_wrist']) if (OK(p, k)) { fill(251, 86, 7); stroke(255); strokeWeight(4); circle(p[k].x, p[k].y, 46); }
  if (OK(p, 'nose')) { noStroke(); fill(45, 198, 83); circle(p.nose.x, p.nose.y, 22); }
  pop();
}
