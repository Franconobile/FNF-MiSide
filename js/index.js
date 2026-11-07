(() => {
  'use strict';
  const VERSION = '0.2';
  const A = window.ASSETS;
  const W = 1280, H = 720;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const now = () => performance.now();

  let state = 'loading';
  let S = null;            // the song now
  let autoplay = false;

  // ================================================================== the screen
  // (drawn in FNF's 1280 x 720 at R device pixels each — sharp on a big screen —, then through a shader: Genocide's
  // chromatic aberration and its brightness past 100%)
  let screenEl = document.getElementById('game');
  const frame = document.createElement('canvas');
  const g = frame.getContext('2d');
  const world = document.createElement('canvas');
  const wg = world.getContext('2d');
  let R = 0, cssK = 1;
  let gl = null, glTex = null, flat = null;
  const glU = {};

  function setupGl() {
    try {
      gl = screenEl.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false });
    } catch (e) {
      gl = null;
    }
    if (!gl) return false;
    const vs = 'attribute vec2 p; varying vec2 uv; void main(){ uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }';
    // (Vs. Tabi's ChromaticAberration: red from uv − offset, blue from uv + offset; then its Bright on Hard past 100%)
    const fs = [
      'precision mediump float;',
      'uniform sampler2D t; uniform float ca; uniform float con; uniform float bri;',
      'varying vec2 uv;',
      'void main(){',
      '  vec4 c = texture2D(t, uv);',
      '  float r = texture2D(t, vec2(clamp(uv.x - ca, 0.0, 1.0), uv.y)).r;',
      '  float b = texture2D(t, vec2(clamp(uv.x + ca, 0.0, 1.0), uv.y)).b;',
      '  gl_FragColor = vec4(vec3(r, c.g, b) * (1.0 + con) + bri, 1.0);',
      '}'].join('\n');
    try {
      const sh = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
        return s;
      };
      const pr = gl.createProgram();
      gl.attachShader(pr, sh(gl.VERTEX_SHADER, vs));
      gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr) || 'link');
      gl.useProgram(pr);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(pr, 'p');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      glTex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, glTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      for (const n of ['t', 'ca', 'con', 'bri']) glU[n] = gl.getUniformLocation(pr, n);
      gl.uniform1i(glU.t, 0);
      return true;
    } catch (e) {
      console.warn('post shader:', e);
      gl = null;
      return false;
    }
  }
  function useFlatCanvas() {
    const c2 = document.createElement('canvas');
    c2.id = 'game';
    c2.width = screenEl.width;
    c2.height = screenEl.height;
    c2.style.cssText = screenEl.style.cssText;
    screenEl.replaceWith(c2);
    screenEl = c2;
    gl = null;
    flat = c2.getContext('2d');
  }
  if (!setupGl()) useFlatCanvas();

  function fit() {
    const k = Math.min(window.innerWidth / W, window.innerHeight / H) || 1;
    cssK = k;
    screenEl.style.width = Math.floor(W * k) + 'px';
    screenEl.style.height = Math.floor(H * k) + 'px';
    const want = clamp(Math.round(k * (window.devicePixelRatio || 1) * 4) / 4, 1, 2);
    if (want !== R) {
      R = want;
      const w = Math.round(W * R), h = Math.round(H * R);
      frame.width = world.width = screenEl.width = w;
      frame.height = world.height = screenEl.height = h;
      if (gl) gl.viewport(0, 0, w, h);
    }
  }
  window.addEventListener('resize', fit);
  fit();
  const base = (c) => c.setTransform(R, 0, 0, R, 0, 0);

  function present(ca, con, bri) {
    if (gl) {
      gl.bindTexture(gl.TEXTURE_2D, glTex);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
      } catch (error) {
        // Some browsers forbid uploading local-file images to a WebGL texture.
        if (error.name !== 'SecurityError') throw error;
        useFlatCanvas();
        present(ca, con, bri);
        return;
      }
      gl.uniform1f(glU.ca, ca / W);
      gl.uniform1f(glU.con, con);
      gl.uniform1f(glU.bri, bri);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    } else {
      flat.setTransform(1, 0, 0, 1, 0, 0);
      flat.drawImage(frame, 0, 0);
    }
  }

  // ================================================================== assets
  function b64buf(base64) {
    const s = atob(base64);
    const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u.buffer;
  }
  function img(name) {
    return new Promise((ok, no) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => no(new Error('picture ' + name));
      i.src = A[name];
    });
  }
  function sparrow(xml) {
    const doc = new DOMParser().parseFromString(String(xml).replace(/^\uFEFF/, ''), 'text/xml');
    const out = {};
    for (const s of doc.getElementsByTagName('SubTexture')) {
      const name = s.getAttribute('name').replace(/\d{4}$/, '');
      const num = (k, d) => (s.hasAttribute(k) ? parseFloat(s.getAttribute(k)) : d);
      const f = { x: num('x', 0), y: num('y', 0), w: num('width', 0), h: num('height', 0) };
      f.fx = num('frameX', 0);
      f.fy = num('frameY', 0);
      f.fw = num('frameWidth', f.w);
      f.fh = num('frameHeight', f.h);
      (out[name] = out[name] || []).push(f);
    }
    return out;
  }
  // (a picture's drawn part — where it isn't see-through —: every rating, every number one size by it)
  function inkOf(im) {
    const c = document.createElement('canvas');
    c.width = im.width;
    c.height = im.height;
    const x = c.getContext('2d');
    x.drawImage(im, 0, 0);
    const d = x.getImageData(0, 0, im.width, im.height).data;
    let x0 = im.width, y0 = im.height, x1 = -1, y1 = -1;
    for (let y = 0; y < im.height; y++) {
      for (let xx = 0; xx < im.width; xx++) {
        if (d[(y * im.width + xx) * 4 + 3] > 12) {
          if (xx < x0) x0 = xx;
          if (xx > x1) x1 = xx;
          if (y < y0) y0 = y;
          y1 = y;
        }
      }
    }
    return x1 < 0 ? { x0: 0, y0: 0, x1: im.width, y1: im.height } : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
  }
  function tinted(im, color, amount) {
    const c = document.createElement('canvas');
    c.width = im.width;
    c.height = im.height;
    const x = c.getContext('2d');
    x.drawImage(im, 0, 0);
    x.globalCompositeOperation = 'source-atop';
    x.globalAlpha = amount;
    x.fillStyle = color;
    x.fillRect(0, 0, im.width, im.height);
    return c;
  }

  let actx = null;
  const IMG = {}, SND = {}, MUS = {};
  let NOTES = null, ALPHA = null, FIRE = null;
  let loadErr = null;
  const RATINGS = ['sick', 'good', 'bad', 'shit'];
  const DIGITS = [...Array(10).keys()].map((i) => 'num' + i);
  let ratingK = 1, digitK = 1, digitStep = 30;

  async function load() {
    const names = ['bg', 'boy', 'mita', 'punk', 'icon_boy', 'icon_mita',
      'NOTE_assets', 'fire', 'vignette', 'healthBar', 'ready', 'set', 'go', 'alphabet', 'menuDesat', ...RATINGS, ...DIGITS];
    await Promise.all(names.map(async (n) => { IMG[n] = await img(n); }));
    NOTES = sparrow(A.NOTE_assets_xml);
    ALPHA = sparrow(A.alphabet_xml);
    FIRE = A.fire_json;
    for (const n of [...RATINGS, ...DIGITS]) IMG[n].ink = inkOf(IMG[n]);
    ratingK = POP_RATING_H / Math.max(1, ...RATINGS.map((n) => IMG[n].ink.y1 - IMG[n].ink.y0));
    digitK = POP_DIGIT_H / Math.max(1, ...DIGITS.map((n) => IMG[n].ink.y1 - IMG[n].ink.y0));
    digitStep = Math.max(...DIGITS.map((n) => IMG[n].ink.x1 - IMG[n].ink.x0)) * digitK + 3;
    IMG.boyMiss = tinted(IMG.boy, '#4b36c4', 0.45);
    try {
      const f = new FontFace('vcr', 'url(' + A.vcr_ttf + ')');
      await f.load();
      document.fonts.add(f);
    } catch (e) {
      console.warn('font:', e);
    }
    actx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    await Promise.all(['Inst', 'intro3', 'intro2', 'intro1', 'introGo', 'missnote1', 'fnf_loss_sfx', 'gameOverEnd', 'scrollMenu', 'confirmMenu', 'cancelMenu'].map(async (n) => {
      SND[n] = await actx.decodeAudioData(b64buf(window.PACKED_SOUNDS[n + '_ogg']));
    }));
    delete window.PACKED_SOUNDS;
    songs[1] = { ...songs[1], ...await makePunkTrack() };
    for (const n of ['freakyMenu', 'breakfast', 'gameOver']) {
      const el = new Audio(A[n + '_ogg']);
      el.loop = true;
      el.preload = 'auto';
      MUS[n] = el;
    }
  }

  // ================================================================== settings kept in this browser
  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem('genocide-mita.' + k);
        return v === null ? d : JSON.parse(v);
      } catch (e) {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem('genocide-mita.' + k, JSON.stringify(v));
      } catch (e) {
        // (a private window: not kept)
      }
    },
  };
  let userOffset = clamp(+store.get('offset', 0) || 0, -300, 300);
  autoplay = !!store.get('autoplay', false);

  // ================================================================== sounds and music
  function sfx(name, vol) {
    if (!actx || !SND[name] || actx.state !== 'running') return;
    const s = actx.createBufferSource();
    s.buffer = SND[name];
    const gn = actx.createGain();
    gn.gain.value = vol;
    s.connect(gn).connect(actx.destination);
    s.start();
  }
  const music = { el: null, name: '', target: 0, rate: 0 };
  function playMusic(name, vol0, target, rate, from) {
    stopMusic();
    const el = MUS[name];
    if (!el) return;
    try { el.currentTime = from || 0; } catch (e) { /* (not seekable yet) */ }
    el.volume = clamp(vol0, 0, 1);
    music.el = el;
    music.name = name;
    music.target = target;
    music.rate = rate;
    const p = el.play();
    if (p && p.catch) p.catch(() => { /* (before the first key: started by it) */ });
  }
  function stopMusic() {
    if (music.el) {
      try { music.el.pause(); } catch (e) { /* (gone) */ }
    }
    music.el = null;
    music.name = '';
  }
  function stepMusic(dt) {
    const el = music.el;
    if (el && el.volume < music.target) el.volume = Math.min(music.target, el.volume + music.rate * dt);
  }
  function unlock() {
    if (actx && actx.state === 'suspended') actx.resume();
    if (music.el && music.el.paused) {
      const p = music.el.play();
      if (p && p.catch) p.catch(() => {});
    }
  }

  // ================================================================== the scene (Mita's house: 1920 x 1043, drawn to cover 1280 x 720)
  // A 16:9 window around the TV, in Map001bg source pixels.
  const roomView = { x: 1000, y: 286, width: 640, height: 360 };
  const BG_L = 0;
  const BASE_ZOOM = 1.04, PAN = 22;

  // ================================================================== the song (Vs. Tabi's Genocide, Hard: no voices, as in it)
  const STRUM_Y = 50, STRUM_CY = STRUM_Y + 55, NOTE_SCALE = 0.7, SWAG = 112;
  const strumX = (side, lane) => 42 + 50 + SWAG * lane + 640 * side + 55;   // centre (side 0: the boy — you — on the left)
  const COLS = ['purple', 'blue', 'green', 'red'];
  const DIRS = ['left', 'down', 'up', 'right'];
  const ARROWS = ['arrowLEFT', 'arrowDOWN', 'arrowUP', 'arrowRIGHT'];
  // FNF's judge and health (the MiSide mod's FnfSim)
  const SICK = 45, GOOD = 90, BAD = 135, SAFE = 166;
  const HP = { sick: 0.03, good: 0.015, bad: 0, shit: -0.02 };
  const HOLD_HP = 0.12, GHOST_AFTER_HIT = 375;
  // easier than FNF's (she asked): a miss 2% of the bar (FNF's 4%, Genocide on Hard's 9%), a stray key with notes near
  // 1% (FNF's 4%) — and Mita's notes never take any of it (no Genocide drain)
  const MISS_HP = 0.04, GHOST_HP = 0.02;
  // Genocide on Hard: its crazy mode from 100% up to 150%, +0.04 a hit
  const HIT_EXTRA = 0.04, MOST = 3, START_HEALTH = 2;
  // the ratings and the combo: the MiSide mod's one size, a little right of each dancer at the waist, their fall smaller
  const POP_U = 1 / 0.75, POP_RATING_H = 27, POP_DIGIT_H = 20, POP_GAP = 13, POP_FALL = 0.4;
  const POP_AT = [{ x: 571, y: 318 }, { x: 964, y: 318 }];
  // the bar (Kade's place)
  const BAR_W = 601, BAR_H = 19, BAR_X = 640 - BAR_W / 2, BAR_Y = 720 - 72 - BAR_H / 2;

  function chartNotes(song) {
    const out = [];
    for (const sec of song.notes) {
      for (const n of sec.sectionNotes || []) {
        if (!Array.isArray(n) || n.length < 2 || !(n[1] >= 0 && n[1] <= 7)) continue;
        const raw = n[1] | 0;
        // (FNF's: in a section of the player's its first four are the player's)
        const player = sec.mustHitSection ? raw < 4 : raw >= 4;
        out.push({ t: +n[0], lane: raw % 4, side: player ? 0 : 1, sus: Math.max(0, +n[2] || 0), st: 0, off: 0, heldTo: 0, cutT: 0 });
      }
    }
    out.sort((a, b) => a.t - b.t || a.side - b.side || a.lane - b.lane);
    // (one of a side on one lane at once, not two)
    const res = [];
    for (const n of out) {
      let dup = false;
      for (let k = res.length - 1; k >= 0 && n.t - res[k].t < 2; k--) {
        if (res[k].side === n.side && res[k].lane === n.lane) {
          dup = true;
          break;
        }
      }
      if (!dup) res.push(n);
    }
    return res;
  }

  function commandList(commands) {
    const all = [];
    for (const sec of commands.notes) {
      for (const n of sec.sectionNotes || []) if (Array.isArray(n) && n.length >= 2) all.push([+n[0], (n[1] | 0) % 4, all.length]);
    }
    all.sort((a, b) => a[0] - b[0] || a[2] - b[2]);
    return all;
  }

  // ------------------------------------------------------------------ the dancers
  const chars = {
    boy: { name: 'boy', side: 0, x: 430, feet: 472 },
    mita: { name: 'mita', side: 1, x: 820, feet: 472 },
  };
  function resetChar(c) {
    c.alt = 0;
    c.lastT = -1e9;
    c.hitAt = -1e9;
    c.singUntil = -1e9;
    c.holding = false;
    c.missUntil = 0;
  }
  resetChar(chars.boy);
  resetChar(chars.mita);

  const songs = [
    { title: 'Genocide', difficulty: 'HARD',
      chart: A.hard_json.song, commands: A.commands_json.song },
    { title: 'Ruido CRT', difficulty: 'NORMAL' },
  ];
  const rivals = [{ name: 'Mita', sprite: 'mita' }, { name: 'Punk Mita', sprite: 'punk' }];
  let songIndex = 0;
  let rivalIndex = 0;

  // Render the instrumental once. The melody and chart share the same beat grid.
  async function makePunkTrack() {
    const bpm = 156, beat = 60 / bpm, bars = 24, sampleRate = 22050;
    const audio = new OfflineAudioContext(1, Math.ceil((bars * 4 * beat + 0.5) * sampleRate), sampleRate);
    const notes = [];
    function tone(type, hz, start, duration, volume, endHz = hz) {
      const osc = audio.createOscillator(), env = audio.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(hz, start);
      osc.frequency.exponentialRampToValueAtTime(endHz, start + duration);
      env.gain.setValueAtTime(0.0001, start);
      env.gain.exponentialRampToValueAtTime(volume, start + 0.006);
      env.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.connect(env).connect(audio.destination);
      osc.start(start);
      osc.stop(start + duration);
    }
    const patterns = [[0, 2, 1, 3], [2, 1, 3, 0], [3, 2, 0, 1], [1, 0, 3, 2]];
    for (let bar = 0; bar < bars; bar++) {
      const root = [110, 87.31, 130.81, 98][Math.floor(bar / 2) % 4];
      const sectionNotes = [];
      for (let pulse = 0; pulse < 8; pulse++) {
        const start = (bar * 4 + pulse / 2) * beat;
        tone('square', root / 2, start, beat * 0.45, 0.12);
        tone('triangle', 6000, start, 0.045, 0.07, 2300);
        if (pulse % 4 === 0) tone('sine', 140, start, 0.17, 0.5, 45);
        if (pulse % 4 === 2) tone('triangle', 830, start, 0.11, 0.26, 95);
        if (pulse % 2 === 0 || (bar % 4 === 3 && pulse === 5)) {
          const lane = patterns[bar % 4][Math.floor(pulse / 2)] ^ (pulse % 2);
          const hold = pulse === 6 && bar % 4 === 3 ? beat * 0.7 : 0;
          tone('sawtooth', root * [2, 2.38, 3, 3.56][lane], start, hold || beat * 0.42, 0.16);
          sectionNotes.push([start * 1000, lane, hold * 1000]);
        }
      }
      notes.push({ mustHitSection: bar % 4 >= 2, sectionNotes });
    }
    return { chart: { bpm, speed: 2.6, notes }, track: await audio.startRendering() };
  }

  function newSong() {
    const entry = songs[songIndex];
    const song = entry.chart;
    const bpm = +song.bpm || 213;
    const crochet = 60000 / bpm;
    S = {
      bpm, crochet, step: crochet / 4, speed: +song.speed || 3.4,
      notes: chartNotes(song), cmds: entry.commands ? commandList(entry.commands) : [], cmdFrom: 0,
      mustHit: song.notes.map((s) => !!s.mustHitSection),
      pos: -1e9, paused: false, menuIx: 0,
      startCtx: 0, srcs: [], track: entry.track || SND.Inst, lenMs: (entry.track || SND.Inst).duration * 1000,
      health: START_HEALTH, shown: START_HEALTH,
      score: 0, misses: 0, combo: 0, maxCombo: 0, oppCombo: 0, counts: { sick: 0, good: 0, bad: 0, shit: 0 },
      hitSum: 0, passSum: 0, lastHit: -1e9,
      from: 0, drawFrom: 0, lastBeat: null, camZooming: false,
      held: [false, false, false, false], holding: [null, null, null, null], oppHold: [null, null, null, null], autoUp: [0, 0, 0, 0],
      strum: [0, 1].map(() => [0, 1, 2, 3].map(() => ({ a: 'static', t: -1e9 }))),
      pops: [[], []],
      chroma: 0, chromaOn: false, chromaUntil: 0, danced: false, danceX: 0, noteShakeUntil: 0, noteJx: 0,
      shakeUntil: 0, shakeAmt: 0, barOff: false, colourOn: false, colour: 'rgba(0,0,0,0)',
      camBump: 0, hudBump: 0, iconBump: 0, camX: 0,
      startPerf: now(), intro: true, autoUsed: autoplay, looks: [0, 0],
    };
    let end = 0;
    for (const n of S.notes) end = Math.max(end, n.t + n.sus);
    // (FNF's: the song is over when its Inst is)
    S.endMs = Math.max(S.lenMs, end + 500);
    resetChar(chars.boy);
    resetChar(chars.mita);
  }

  // ================================================================== the clock: the song's own sound, as it is heard
  // (the context's time heard at a moment of performance.now(): the output's own timestamp when the browser has one)
  function heardCtx(perfT) {
    if (actx.getOutputTimestamp) {
      const ts = actx.getOutputTimestamp();
      if (ts && ts.contextTime > 0 && ts.performanceTime > 0) return ts.contextTime + (perfT - ts.performanceTime) / 1000;
    }
    return actx.currentTime - (actx.outputLatency || 0) - (actx.baseLatency || 0) + (perfT - now()) / 1000;
  }
  // the song's ms heard at that moment, your sync offset taken off (+: the notes later)
  const songAt = (perfT) => (heardCtx(perfT) - S.startCtx) * 1000 - userOffset;

  function playBuf(buf, when, gain, offset) {
    const s = actx.createBufferSource();
    s.buffer = buf;
    const gn = actx.createGain();
    gn.gain.value = gain;
    s.connect(gn).connect(actx.destination);
    s.start(when, offset || 0);
    S.srcs.push(s);
    return s;
  }
  function stopSound() {
    if (!S) return;
    for (const s of S.srcs) {
      try { s.stop(); } catch (e) { /* (already over) */ }
    }
    S.srcs = [];
  }

  // the song's sound from `ms` of it on (before 0: the countdown's sounds still to come, then its Inst), heard from a
  // moment just ahead — its start, a pause's end
  function soundFrom(ms) {
    stopSound();
    const t0 = actx.currentTime + 0.12;
    S.startCtx = t0 - ms / 1000;
    if (ms >= 0) {
      playBuf(S.track, t0, 1, ms / 1000);
      return;
    }
    playBuf(S.track, S.startCtx, 1, 0);
    // (FNF's countdown: 3, 2 (ready), 1 (set), go — a beat each, the song at the next)
    ['intro3', 'intro2', 'intro1', 'introGo'].forEach((n, k) => {
      const at = -(4 - k) * S.crochet;
      if (at >= ms - 5) playBuf(SND[n], S.startCtx + at / 1000, 0.6, 0);
    });
  }

  // `fromMs`: straight in there, no countdown (a test's)
  function startSong(fromMs) {
    stopSound();
    stopMusic();
    newSong();
    if (fromMs > 0) {
      soundFrom(fromMs);
      for (const n of S.notes) if (n.t < fromMs) n.st = 6;
      while (S.cmdFrom < S.cmds.length && S.cmds[S.cmdFrom][0] < fromMs) command(S.cmds[S.cmdFrom++][1]);
      S.intro = false;
    } else {
      // (FNF's: its first sample five beats after the start, the countdown on the second to the fifth)
      soundFrom(-(180 + 5 * S.crochet));
    }
    S.pos = songAt(now() + frameMs);
    S.startPerf = now();
    lastFrame = now();
    state = 'play';
  }

  // ================================================================== judging (FNF's, as the MiSide mod's FnfSim)
  const scoreOf = (r) => (r === 'sick' ? 350 : r === 'good' ? 200 : r === 'bad' ? 100 : 50);
  const rateOf = (ms) => (ms <= SICK ? 'sick' : ms <= GOOD ? 'good' : ms <= BAD ? 'bad' : 'shit');

  function addHealth(d) {
    S.health = clamp(S.health + d, 0, MOST);
    if (S.health <= 0 && state === 'play' && !autoplay) gameOver();
  }
  function missSound() {
    sfx('missnote1', rnd(0.1, 0.2));
  }

  function press(lane, t) {
    S.held[lane] = true;
    let best = null;
    for (let i = S.from; i < S.notes.length; i++) {
      const n = S.notes[i];
      if (n.t - t > SAFE) break;
      if (n.st !== 0 || n.side !== 0 || n.lane !== lane || t - n.t > SAFE) continue;
      best = n;
      break;
    }
    if (!best) {
      const st = S.strum[0][lane];
      st.a = 'pressed';
      st.t = now();
      kick(0);
      // (FNF's ghost tapping: a free key with nothing near; with one of your notes near, a hold on or a hit just now,
      // its anti-mash: a little health and score, no miss)
      if (ghostNear(t)) {
        S.score -= 10;
        S.passSum += 1;
        missSound();
        addHealth(-GHOST_HP);
      }
      return;
    }
    hit(best, t);
  }
  function ghostNear(t) {
    if (t - S.lastHit < GHOST_AFTER_HIT) return true;
    if (S.holding.some((h) => h)) return true;
    for (let i = S.from; i < S.notes.length; i++) {
      const n = S.notes[i];
      if (n.t - t > SAFE) break;
      if (n.st === 0 && n.side === 0 && t - n.t <= SAFE) return true;
    }
    return false;
  }

  function hit(n, t) {
    const off = t - n.t;
    const r = rateOf(Math.abs(off));
    n.off = off;
    n.st = n.sus > 0 ? 2 : 1;
    S.score += scoreOf(r);
    S.combo++;
    S.maxCombo = Math.max(S.maxCombo, S.combo);
    S.counts[r]++;
    // (Vs. Tabi's accuracy: sick 1, good 0.95, bad and shit 0.25, against 0.75 a hit and 1 a miss)
    S.hitSum += r === 'sick' ? 1 : r === 'good' ? 0.95 : 0.25;
    S.passSum += 0.75;
    if (S.hitSum > S.passSum) S.hitSum = S.passSum;
    S.lastHit = t;
    const st = S.strum[0][n.lane];
    st.a = 'confirm';
    st.t = now();
    const old = S.holding[n.lane];
    if (old && old !== n) {
      // (a hold of this arrow still on, its end not seen yet — the autoplay's, on a slow frame —: over, held to here)
      holdFor(old, t);
      old.st = 5;
      S.holding[n.lane] = null;
    }
    if (n.sus > 0) {
      n.heldTo = n.t;
      S.holding[n.lane] = n;
    }
    S.autoUp[n.lane] = now() + 140;
    S.camZooming = true;
    popRating(0, r, S.combo);
    tabiHit(0);
    kick(0);
    addHealth(HP[r] + HIT_EXTRA);
  }
  function holdFor(h, upTo) {
    const a = Math.max(h.heldTo, h.t), b = Math.min(upTo, h.t + h.sus);
    h.heldTo = Math.max(h.heldTo, b);
    if (b > a) addHealth((HOLD_HP * (b - a)) / 1000);
  }

  function release(lane, t) {
    S.held[lane] = false;
    S.strum[0][lane].a = 'static';
    const h = S.holding[lane];
    if (!h) return;
    S.holding[lane] = null;
    holdFor(h, t);
    if (t < h.t + h.sus - Math.min(S.step, 90)) {
      // (let go of too early: its combo, no health — what it gave while held is kept)
      h.st = 4;
      h.cutT = t;
      S.misses++;
      S.combo = 0;
      S.score -= 10;
      S.passSum += 1;
      chars.boy.missUntil = now() + 300;
      missSound();
    } else {
      h.st = 5;
    }
  }

  function miss(n) {
    n.st = 3;
    S.misses++;
    S.combo = 0;
    S.score -= 10;
    S.passSum += 1;
    chars.boy.missUntil = now() + 300;
    missSound();
    addHealth(-MISS_HP);
  }

  // ================================================================== Vs. Tabi's Genocide (its PlayState, as the MiSide mod plays it)
  function tabiHit(side) {
    // (its chromaticDance on every note of either side: red and blue apart, then together on the next — (most − health
    // / most) / 1000 of the screen, the opponent's notes twice that; gone two seconds after the last)
    const off = ((MOST - S.health / MOST) / 1000) * (side === 1 ? 2 : 1);
    S.chroma = S.chromaOn ? 0 : Math.max(0, off * W);
    S.chromaOn = !S.chromaOn;
    S.chromaUntil = now() + 2000;
    if (side === 1) {
      // (its screenDance: the window a hundredth of its width aside, then back, on every one of the opponent's notes)
      S.danced = !S.danced;
      S.danceX = S.danced ? 12.8 : 0;
      shake(0.03, 20);
    } else {
      shake(0.008, 20);
    }
  }
  function shake(intensity, ms) {
    const t = now();
    if (t > S.shakeUntil) S.shakeAmt = 0;
    S.shakeAmt = Math.max(S.shakeAmt, intensity * W);
    S.shakeUntil = Math.max(S.shakeUntil, t + ms);
  }
  function command(c) {
    // (its commands.json: 0 its faint colour on or off, 1 the bar back, 2 the bar hidden)
    if (c === 0) S.colourOn = !S.colourOn;
    else if (c === 1) S.barOff = false;
    else if (c === 2) S.barOff = true;
  }

  // ------------------------------------------------------------------ the dancers' poses
  function sing(c, n) {
    // (each note — each key — the other of the two dances, a chord one pose; held on four steps after it, then the idle
    // at the next beat)
    if (Math.abs(n.t - c.lastT) > 30) c.alt ^= 1;
    c.lastT = n.t;
    c.hitAt = now();
    c.singUntil = Math.max(c.singUntil, n.t + n.sus + 4 * S.step);
  }
  const dancers = {
    boy: { scale: 2.18, baseline: 140 },
    mita: { scale: 2.10, baseline: 139 },
    punk: { scale: 1.86, baseline: 124 },
  };
  function drawChar(c, beat, pos, live, ctx, defeated = false) {
    const key = c.side === 0 ? 'boy' : rivals[rivalIndex].sprite;
    const dancer = dancers[key];
    let frame = 0, bob = 0;
    if (key === 'boy') {
      if (live && !S.paused && S.held.some(Boolean)) frame = 1;
    } else if (key === 'punk') {
      bob = -9 * Math.abs(Math.sin(beat * Math.PI));
    } else {
      const singing = live && (pos < c.singUntil || c.holding);
      frame = (Math.floor(beat * (singing ? 2 : 1)) + (singing ? c.alt : 0)) & 1;
      bob = 2 * Math.cos(beat * Math.PI * 2);
    }
    const sheet = key === 'boy' && (defeated || now() < c.missUntil) ? IMG.boyMiss : IMG[key];
    const scale = dancer.scale;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sheet, frame * 144, 0, 144, 144,
      c.x - 72 * scale, c.feet - dancer.baseline * scale + bob, 144 * scale, 144 * scale);
    ctx.imageSmoothingEnabled = true;
  }

  // ------------------------------------------------------------------ the dust in the room's light (as Mita's house in the MiSide mod)
  const motes = [];
  let moteSprite = null;
  function makeMoteSprite() {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const x = c.getContext('2d');
    const gr = x.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(255,246,236,1)');
    gr.addColorStop(0.35, 'rgba(255,236,224,0.55)');
    gr.addColorStop(1, 'rgba(255,230,220,0)');
    x.fillStyle = gr;
    x.fillRect(0, 0, 32, 32);
    moteSprite = c;
  }
  function newMote(anywhere) {
    return {
      x: rnd(-20, W + 20), y: anywhere ? rnd(0, H) : rnd(H * 0.35, H + 20), vx: rnd(-7, 7), vy: rnd(-16, -5),
      size: rnd(1.6, 4.2), life: rnd(6, 13), age: anywhere ? rnd(0, 6) : 0, ph: Math.random(), lum: rnd(0.35, 0.9), wob: rnd(0.3, 1.1),
    };
  }
  for (let i = 0; i < 70; i++) motes.push(newMote(true));
  // each half's push from its dancer's hits (the boy's on the left, Mita's on the right): eased in, gone over a second
  const kicks = [0, 0], kicksS = [0, 0];
  function kick(side) { kicks[side] = 1; }
  const SWAY_BASE = 3, SWAY_HIT = 15, SWAY_LIFT = 6, KICK_FADE = 3.2, KICK_RISE = 30;
  const swayX = (beat, ph, k) => Math.sin((beat + ph) * Math.PI * 2) * (SWAY_BASE + SWAY_HIT * k);
  const swayY = (beat, ph, k) => -(0.6 + 0.4 * Math.cos((beat + ph) * Math.PI * 2)) * SWAY_LIFT * k;
  function stepMotes(dt) {
    const fade = Math.exp(-dt * KICK_FADE), rise = 1 - Math.exp(-KICK_RISE * dt);
    for (let i = 0; i < 2; i++) {
      kicks[i] *= fade;
      kicksS[i] += (kicks[i] - kicksS[i]) * rise;
    }
    for (let i = 0; i < motes.length; i++) {
      const m = motes[i];
      m.age += dt;
      m.x += (m.vx + Math.sin(m.age * m.wob + m.ph * 6.28) * 4) * dt;
      m.y += m.vy * dt;
      if (m.age > m.life || m.y < -30 || m.x < -40 || m.x > W + 40) motes[i] = newMote(false);
    }
  }
  function drawMotes(beat, ctx) {
    ctx.globalCompositeOperation = 'lighter';
    for (const m of motes) {
      const k = clamp(kicksS[m.x < W / 2 ? 0 : 1], 0, 1);
      const a = clamp(m.age / 0.8, 0, 1) * clamp((m.life - m.age) / (m.life * 0.35), 0, 1) * m.lum * (1 + 0.7 * k);
      if (a <= 0.01) continue;
      const r = m.size * (1 + 0.4 * k) * 2.4;
      ctx.globalAlpha = clamp(a * 0.55, 0, 1);
      ctx.drawImage(moteSprite, m.x + swayX(beat, m.ph, k) - r, m.y + swayY(beat, m.ph, k) - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // ------------------------------------------------------------------ Genocide's burning light and its fire along the bottom
  let fireClock = 0, flick = 1;
  function drawBurning(ctx) {
    // (its burning room: the view multiplied by fire's colour, its glow added, flickering as its fire)
    const f = flick;
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `rgb(255,${Math.round(255 * 0.62 * (0.94 + 0.06 * f))},${Math.round(255 * 0.42 * (0.92 + 0.08 * f))})`;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgb(${Math.round(255 * 0.09 * f)},${Math.round(255 * 0.032 * f)},0)`;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
  }
  function drawFire(ctx) {
    // (three of its flames along each half, through its frames at 30 a second, every other one mirrored)
    const n = FIRE.length;
    const fr = Math.floor(fireClock * 30);
    const half = W / 2;
    ctx.globalAlpha = 0.92;
    for (let side = 0; side < 2; side++) {
      for (let i = 0; i < 3; i++) {
        const f = FIRE[(fr + i * 37 + side * 71) % n];   // x, y, w, h, frameX, frameY, frameW, frameH
        const fw = half * (i === 1 ? 0.6 : 0.48);
        const k = fw / Math.max(1, f[6]);
        const x0 = side * half + half * (0.17 + 0.33 * i) - fw / 2;
        const y0 = H - f[7] * k * 0.78;
        const qw = f[2] * k, qh = f[3] * k, qy = y0 - f[5] * k;
        if (((i + side) & 1) === 1) {
          const left = f[6] + f[4] - f[2];
          ctx.save();
          ctx.translate(x0 + (left + f[2]) * k, qy);
          ctx.scale(-1, 1);
          ctx.drawImage(IMG.fire, f[0], f[1], f[2], f[3], 0, 0, qw, qh);
          ctx.restore();
        } else {
          ctx.drawImage(IMG.fire, f[0], f[1], f[2], f[3], x0 - f[4] * k, qy, qw, qh);
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------------ the world: the house, its TV, the dancers, its dust, its fire
  function drawWorld(beat, pos, live) {
    base(wg);
    wg.imageSmoothingQuality = 'high';
    wg.fillStyle = '#000';
    wg.fillRect(0, 0, W, H);
    const t = now();
    const z = BASE_ZOOM + (live ? S.camBump : 0);
    let tx = live ? S.camX : 0, ty = 0;
    if (live && t < S.shakeUntil) {
      tx += rnd(-S.shakeAmt, S.shakeAmt);
      ty += rnd(-S.shakeAmt, S.shakeAmt) * 0.5625;
    }
    // (never past the picture's edges)
    const mx = Math.max(0, (W / 2 - BG_L) * z - W / 2), my = Math.max(0, (H / 2) * z - H / 2);
    tx = clamp(tx, -mx, mx);
    ty = clamp(ty, -my, my);
    wg.setTransform(R * z, 0, 0, R * z, R * (W / 2 - (W / 2) * z + tx), R * (H / 2 - (H / 2) * z + ty));
    wg.imageSmoothingEnabled = false;
    wg.drawImage(IMG.bg, roomView.x, roomView.y, roomView.width, roomView.height, 0, 0, W, H);
    drawChar(chars.boy, beat, pos, live, wg);
    drawChar(chars.mita, beat, pos, live, wg);
    drawMotes(beat, wg);
    base(wg);
    if (songIndex === 0) {
      drawBurning(wg);
      drawFire(wg);
    }
    if (live) {
      if (S.colourOn) {
        wg.fillStyle = S.colour;
        wg.fillRect(0, 0, W, H);
      }
      // (its vignette: darker as the player loses)
      const va = clamp(1 - S.health / MOST, 0, 1);
      if (va > 0.01) {
        wg.globalAlpha = va;
        wg.drawImage(IMG.vignette, 0, 0, W, H);
        wg.globalAlpha = 1;
      }
    }
  }

  // ================================================================== the HUD
  // (a frame of a sheet centred on (cx, cy) by its whole frame, as FNF's sprites are)
  function sheetFrame(im, f, cx, cy, s, alpha) {
    const x = cx - (f.fw * s) / 2 - f.fx * s, y = cy - (f.fh * s) / 2 - f.fy * s;
    g.globalAlpha = alpha;
    g.drawImage(im, f.x, f.y, f.w, f.h, x, y, f.w * s, f.h * s);
    g.globalAlpha = 1;
  }
  function drawFrame(name, ix, cx, cy, s, alpha) {
    const fs = NOTES[name];
    if (!fs || alpha <= 0) return;
    sheetFrame(IMG.NOTE_assets, fs[clamp(ix, 0, fs.length - 1)], cx, cy, s, alpha);
  }
  // FNF's Alphabet: its bold letters (the menus' words), wobbling through their four frames as FNF's do
  const GLYPHS = { '?': 'question mark', '!': 'exclamation point', '.': 'period', ',': 'comma', "'": 'apostraphie', '(': 'start parentheses', ')': 'end parentheses', '&': 'amp', '/': 'forward slash' };
  function glyph(c, t) {
    const at = (name) => (ALPHA[name] ? ALPHA[name][t % ALPHA[name].length] : null);
    if (/[a-z]/i.test(c)) return at(c.toUpperCase() + ' bold') || at(c.toUpperCase() + ' capital');
    const n = GLYPHS[c] || c;
    return at(n.toUpperCase() + ' bold') || at('bold ' + n) || at(n);
  }
  function alphaWidth(str, scale) {
    let w = 0;
    for (const c of str) {
      const f = c === ' ' ? null : glyph(c, 0);
      w += f ? f.fw * scale : 40 * scale;
    }
    return w;
  }
  function alphaText(str, x, y, scale, alpha) {
    const t = Math.floor((now() / 1000) * 24);
    const bottom = y + 70 * scale;
    for (const c of str) {
      if (c === ' ') {
        x += 40 * scale;
        continue;
      }
      const f = glyph(c, t);
      if (!f) {
        text(c, x + 20 * scale, y + 35 * scale, 54 * scale, 'center', 'rgba(255,255,255,' + alpha + ')', 3);
        x += 40 * scale;
        continue;
      }
      const w = f.fw * scale, h = f.fh * scale;
      sheetFrame(IMG.alphabet, f, x + w / 2, bottom - h / 2, scale, alpha);
      x += w;
    }
  }
  function strumFrame(side, lane) {
    const st = S.strum[side][lane];
    const t = now();
    if (st.a === 'confirm') {
      const holding = side === 0 ? S.holding[lane] : S.oppHold[lane];
      // (a hold: its glow again every step, as FNF's sustain pieces do)
      const el = holding ? ((t - st.t) % S.step) / 1000 : (t - st.t) / 1000;
      return [DIRS[lane] + ' confirm', Math.floor(el * 24)];
    }
    if (st.a === 'pressed') return [DIRS[lane] + ' press', Math.floor(((t - st.t) / 1000) * 24)];
    return [ARROWS[lane], 0];
  }
  function drawTrail(lane, x, top, bottom, alpha) {
    const piece = NOTES[COLS[lane] + ' hold piece'] && NOTES[COLS[lane] + ' hold piece'][0];
    const endFs = lane === 0 ? NOTES['pruple end hold'] : NOTES[COLS[lane] + ' hold end'];
    const end = endFs && endFs[0];
    if (!piece || !end || bottom <= top) return;
    const s = NOTE_SCALE;
    const w = piece.w * s, eh = end.h * s;
    g.globalAlpha = alpha;
    const et = Math.max(top, bottom - eh);
    if (et > top) g.drawImage(IMG.NOTE_assets, piece.x, piece.y, piece.w, piece.h, x - w / 2, top, w, et - top);
    const keep = (bottom - et) / eh;
    if (keep > 0.01) g.drawImage(IMG.NOTE_assets, end.x, end.y + end.h * (1 - keep), end.w, end.h * keep, x - (end.w * s) / 2, et, end.w * s, bottom - et);
    g.globalAlpha = 1;
  }
  function drawNotes(pos, jx, alphaOf) {
    const k = 0.45 * S.speed;
    const ahead = (H + 120 - STRUM_CY) / k;
    while (S.drawFrom < S.notes.length && S.notes[S.drawFrom].t + S.notes[S.drawFrom].sus < pos - 1500) S.drawFrom++;
    for (let i = S.drawFrom; i < S.notes.length; i++) {
      const n = S.notes[i];
      if (n.t - pos > ahead) break;
      if (n.st === 6) continue;
      const x = strumX(n.side, n.lane) + jx;
      const y = STRUM_CY + (n.t - pos) * k;
      const a = alphaOf(n.side, n.lane);
      if (n.sus > 0 && n.st !== 5) {
        const yEnd = STRUM_CY + (n.t + n.sus - pos) * k;
        let top = y, alpha = 0.6;
        if (n.st === 1 || n.st === 2) top = Math.max(y, STRUM_CY);   // (being held: clipped at its arrow)
        else if (n.st === 4) {
          top = STRUM_CY + (n.cutT - pos) * k;   // (let go of: the rest of it, faded)
          alpha = 0.3;
        } else if (n.st === 3) alpha = 0.3;
        if (yEnd > top && yEnd > -60 && top < H + 60) drawTrail(n.lane, x, top, yEnd, alpha * a);
      }
      if (n.st !== 0 && n.st !== 3) continue;
      if (y < -110 || y > H + 110) continue;
      drawFrame(COLS[n.lane], 0, x, y, NOTE_SCALE, (n.st === 3 ? 0.3 : 1) * a);
    }
  }

  function text(str, x, y, size, align, color, outline) {
    g.font = `${size}px vcr, "Courier New", monospace`;
    g.textAlign = align || 'left';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    if (outline > 0) {
      g.lineWidth = outline;
      g.strokeStyle = '#000';
      g.strokeText(str, x, y);
    }
    g.fillStyle = color || '#fff';
    g.fillText(str, x, y);
  }

  function popRating(side, r, combo) {
    const t = now(), c = S.crochet;
    const list = S.pops[side];
    if (list.length > 40) list.splice(0, list.length - 40);
    const im = IMG[r];
    list.push({ im, ink: im.ink, lx: 0, ly: 0, vx: -rnd(0, 10), vy: -rnd(140, 175), ay: 550, fadeAt: t + c, s: ratingK, born: t });
    if (combo >= 10) {
      // (its numbers in a row under the rating, each as far apart as the widest, their bottoms on one line)
      const digits = String(Math.min(combo, 999)).padStart(3, '0');
      const bottom = POP_RATING_H * 0.5 + POP_GAP + POP_DIGIT_H;
      for (let i = 0; i < 3; i++) {
        const di = IMG['num' + digits[i]];
        const ink = di.ink;
        list.push({ im: di, ink, lx: (i - 1) * digitStep, ly: bottom - (ink.y1 - ink.y0) * digitK * 0.5, vx: rnd(-5, 5), vy: -rnd(140, 160), ay: rnd(200, 300), fadeAt: t + c * 2, s: digitK, born: t });
      }
    }
  }
  function drawPops() {
    const t = now();
    for (let side = 0; side < 2; side++) {
      const list = S.pops[side];
      for (let i = list.length - 1; i >= 0; i--) if (t > list[i].fadeAt + 200) list.splice(i, 1);
      const at = POP_AT[side];
      for (const p of list) {
        const e = (t - p.born) / 1000;
        const fx = p.vx * e, fy = p.vy * e + 0.5 * p.ay * e * e;
        const cx = at.x + p.lx * POP_U + fx * POP_FALL, cy = at.y + p.ly * POP_U + fy * POP_FALL;
        const s = p.s * POP_U;
        const icx = (p.ink.x0 + p.ink.x1) / 2, icy = (p.ink.y0 + p.ink.y1) / 2;
        g.globalAlpha = t < p.fadeAt ? 1 : clamp(1 - (t - p.fadeAt) / 200, 0, 1);
        g.drawImage(p.im, cx - icx * s, cy - icy * s, p.im.width * s, p.im.height * s);
      }
    }
    g.globalAlpha = 1;
  }

  // (an icon's look by the bar — losing past its line —, held a little past it so it never flickers between two)
  function iconLook(was, v, lose) {
    const hy = 0.04;
    if (was === 1 && v < lose + hy) return 1;
    return v < lose - hy ? 1 : 0;
  }
  function drawBar(dt) {
    S.shown += (S.health - S.shown) * (1 - Math.exp(-9.75 * dt));
    const h = S.shown;
    const iw = BAR_W - 8, ih = BAR_H - 8;
    // (Genocide on Hard past 100%: the bar slides away from the player — here to the right —, its icons with it)
    const slide = h > 2 ? (iw * (h - 2)) / 2 : 0;
    const bx = BAR_X + slide, by = BAR_Y;
    const share = clamp(h / 2, 0, 1);
    if (!S.barOff) {
      g.drawImage(IMG.healthBar, bx, by, BAR_W, BAR_H);
      // (yours from the left — you are the boy —: FNF's green; Mita's the rest: mad Tabi's dark grey, 0xFF333333)
      g.fillStyle = '#333333';
      g.fillRect(bx + 4, by + 4, iw, ih);
      g.fillStyle = '#66ff33';
      g.fillRect(bx + 4, by + 4, iw * share, ih);
    }
    const div = bx + 4 + iw * share;
    const sc = 1 + 0.2 * S.iconBump;
    const s = 150 * sc, cy = by + BAR_H / 2;
    // his look: losing under 20%; hers: losing only past 100% (Genocide on Hard's own rule)
    S.looks[0] = iconLook(S.looks[0], h, 0.4);
    S.looks[1] = iconLook(S.looks[1], 2 - h, 0);
    g.drawImage(IMG.icon_boy, S.looks[0] ? 150 : 0, 0, 150, 150, div - 124 + 75 - s / 2, cy - s / 2, s, s);
    if (rivals[rivalIndex].sprite === 'punk') {
      const size = 76 * sc;
      g.imageSmoothingEnabled = false;
      g.drawImage(IMG.punk, S.looks[1] * 144 + 54, 0, 36, 36,
        div + 49 - size / 2, cy - size / 2, size, size);
      g.imageSmoothingEnabled = true;
    } else {
      g.drawImage(IMG.icon_mita, S.looks[1] ? 150 : 0, 0, 150, 150, div - 26 + 75 - s / 2, cy - s / 2, s, s);
    }
    // Vs. Tabi's score line
    const acc = S.passSum > 0 ? Math.floor((S.hitSum / S.passSum) * 100 + 0.5) : 100;
    const hp = Math.floor(S.health * 50 + 0.5);
    text(`Score:${S.score} | Misses:${S.misses} | Health:${hp}% | Accuracy:${acc}%` + (autoplay ? ' | Autoplay' : ''), W / 2, by + 50, 20, 'center', '#fff', 3);
  }
  function drawTime(pos) {
    const left = Math.max(0, (S.endMs - Math.max(0, pos)) / 1000);
    const mm = Math.floor(left / 60), ss = Math.floor(left % 60);
    text(mm + ':' + String(ss).padStart(2, '0'), W / 2, 29, 32, 'center', '#fff', 4);
  }
  function drawCountdown(pos) {
    const c = S.crochet;
    // (ready on the countdown's second beat, set on its third, go on its fourth: FNF's, faded over a beat)
    const ix = Math.floor((pos + 4 * c) / c);
    if (ix < 1 || ix > 3) return;
    const im = IMG[['ready', 'set', 'go'][ix - 1]];
    const k = clamp((pos + 4 * c - ix * c) / c, 0, 1);
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    g.globalAlpha = clamp(1 - e, 0, 1);
    g.drawImage(im, W / 2 - im.width / 2, H / 2 - im.height / 2);
    g.globalAlpha = 1;
  }
  function drawHud(pos, dt) {
    g.save();
    const z = 1 + S.hudBump;
    g.translate(W / 2, H / 2);
    g.scale(z, z);
    g.translate(-W / 2, -H / 2);
    drawPops();
    // the arrows: in from above at the song's start, staggered (FNF's), shaken across every beat (Genocide's)
    const el = (now() - S.startPerf) / 1000;
    const alphaOf = (side, lane) => {
      if (!S.intro) return 1;
      const p = clamp(el - (0.5 + 0.2 * lane), 0, 1);
      return Math.sqrt(1 - (p - 1) * (p - 1));
    };
    const jx = S.noteJx;
    for (let side = 0; side < 2; side++) {
      for (let l = 0; l < 4; l++) {
        const a = alphaOf(side, l);
        const [name, ix] = strumFrame(side, l);
        drawFrame(name, ix, strumX(side, l) + jx, STRUM_CY - 10 + 10 * a, NOTE_SCALE, a);
      }
    }
    drawNotes(pos, jx, alphaOf);
    drawBar(dt);
    drawTime(pos);
    drawCountdown(pos);
    g.restore();
  }

  // ================================================================== a frame of the song
  let frameMs = 16.7;
  function step(dt) {
    const t = now();
    // (the song's place: its sound's own clock as heard, a frame ahead for the picture's way to the screen; smoothed)
    const raw = songAt(t + frameMs);
    const pred = S.pos + dt * 1000;
    S.pos = Math.abs(raw - pred) > 40 ? raw : pred + (raw - pred) * 0.15;
    const pos = S.pos;
    // (the judge's: as heard now)
    const jpos = pos - frameMs;
    for (let i = S.from; i < S.notes.length; i++) {
      const n = S.notes[i];
      if (n.t > jpos + SAFE && n.t > pos) break;
      if (n.st !== 0) continue;
      if (n.side === 1) {
        // the opponent, Mita: every note of hers on the dot
        if (n.t > pos) continue;
        n.st = 1;
        const st = S.strum[1][n.lane];
        st.a = 'confirm';
        st.t = t;
        if (n.sus > 0) S.oppHold[n.lane] = n;
        S.camZooming = true;
        sing(chars.mita, n);
        chars.mita.holding = S.oppHold.some((x) => x);
        S.oppCombo++;
        popRating(1, 'sick', S.oppCombo);
        tabiHit(1);
        kick(1);
      } else if (autoplay) {
        if (n.t <= pos) hit(n, n.t);
      } else if (jpos - n.t > SAFE) {
        miss(n);
        if (state !== 'play') return;
      }
    }
    for (let l = 0; l < 4; l++) {
      const h = S.oppHold[l];
      if (h && pos >= h.t + h.sus) {
        S.oppHold[l] = null;
        chars.mita.holding = S.oppHold.some((x) => x);
      }
      const st = S.strum[1][l];
      if (st.a === 'confirm' && !S.oppHold[l] && t - st.t > 150) st.a = 'static';
      // your holds: their health by the second, done at their end
      const y = S.holding[l];
      if (y) {
        holdFor(y, Math.min(jpos, y.t + y.sus));
        if (jpos >= y.t + y.sus) {
          y.st = 5;
          S.holding[l] = null;
          S.autoUp[l] = t + 40;
        }
      }
      if (autoplay && S.strum[0][l].a !== 'static' && !S.holding[l] && t > S.autoUp[l]) S.strum[0][l].a = 'static';
    }
    while (S.from < S.notes.length) {
      const n = S.notes[S.from];
      if (n.st === 0 || n.st === 2 || n.t >= jpos - SAFE) break;
      S.from++;
    }
    // Genocide's own: its commands, its beat (its drain not: she asked — Mita's notes never take your health)
    while (S.cmdFrom < S.cmds.length && pos > S.cmds[S.cmdFrom][0]) command(S.cmds[S.cmdFrom++][1]);
    if (S.chroma > 0 && t > S.chromaUntil) {
      S.chroma = 0;
      S.chromaOn = false;
    }
    const beat = Math.floor(pos / S.crochet);
    if (S.lastBeat === null) S.lastBeat = beat;
    if (beat !== S.lastBeat) {
      S.lastBeat = beat;
      S.iconBump = 1;
      if (pos >= 0) {
        if (S.camZooming && beat % 4 === 0) {
          S.camBump = Math.min(0.35, S.camBump + 0.015);
          S.hudBump = Math.min(0.25, S.hudBump + 0.03);
        }
        S.noteShakeUntil = t + S.crochet;
        S.colour = `rgba(${(Math.random() * 256) | 0},${(Math.random() * 256) | 0},${(Math.random() * 256) | 0},0.05)`;
      }
    }
    // (its noteCam's shake across: a new offset every frame for a beat)
    S.noteJx = t < S.noteShakeUntil ? rnd(-6.4, 6.4) : 0;
    S.camBump *= Math.pow(0.95, dt * 60);
    S.hudBump *= Math.pow(0.95, dt * 60);
    S.iconBump *= Math.exp(-9 * dt);
    // the camera to whoever's section it is (FNF's), a little
    const sec = clamp(Math.floor(Math.max(0, pos) / (16 * S.step)), 0, S.mustHit.length - 1);
    const target = S.mustHit[sec] ? PAN : -PAN;
    S.camX += (target - S.camX) * (1 - Math.exp(-2.4 * dt));
    // its end: the Inst's
    if (pos > S.endMs + 200) {
      stopSound();
      state = 'results';
      endAt = t;
      S.danceX = 0;
      playMusic('freakyMenu', 0, 0.7, 0.7 / 4);
    }
  }

  // ================================================================== the screens
  let endAt = 0, overMusicAt = 0, overConfirm = 0;
  const PAUSE_ITEMS = ['Resume', 'Restart Song', 'Exit to menu'];

  function gameOver() {
    stopSound();
    for (let l = 0; l < 4; l++) S.held[l] = false;
    S.danceX = 0;
    state = 'over';
    endAt = now();
    overMusicAt = endAt + 2500;
    overConfirm = 0;
    sfx('fnf_loss_sfx', 1);
  }
  function toTitle() {
    stopSound();
    if (S) {
      S.paused = false;
      S.danceX = 0;
    }
    if (actx && actx.state === 'suspended') actx.resume();
    state = 'title';
    playMusic('freakyMenu', 0, 0.7, 0.7 / 4);
  }
  function pauseSet(on) {
    if (!S || state !== 'play' || S.paused === on) return;
    if (on) {
      for (let l = 0; l < 4; l++) if (S.held[l]) release(l, S.pos);
      // (its sound stopped at the very place heard now — the sync offset left out —, back from there exactly)
      S.pauseAt = songAt(now()) + userOffset;
      stopSound();
      S.paused = true;
      S.menuIx = 0;
      // (FNF's pause music: from somewhere in its first half, coming in slowly)
      const el = MUS.breakfast;
      playMusic('breakfast', 0, 0.5, 0.01, el && el.duration ? (Math.random() * el.duration) / 2 : 0);
    } else {
      stopMusic();
      soundFrom(S.pauseAt);
      S.paused = false;
      lastFrame = now();
      S.pos = songAt(now() + frameMs);
    }
  }

  function panel(alpha) {
    g.fillStyle = `rgba(0,0,0,${alpha})`;
    g.fillRect(0, 0, W, H);
  }
  function drawTitle() {
    panel(0.58);
    const t = now() / 1000;
    text('ELEGIR CANCIÓN', W / 2, 150, 30, 'center', '#ffd2c8', 5);
    text(songs[songIndex].title.toUpperCase(), W / 2, 220, 92, 'center', '#ff4d4d', 10);
    text(songs[songIndex].difficulty, W / 2, 296, 34, 'center', '#ffffff', 6);
    text('RIVAL  < ' + rivals[rivalIndex].name + ' >', W / 2, 349, 32, 'center', '#ffd2c8', 4);
    if (Math.sin(t * 5) > -0.3) text('ENTER PARA JUGAR', W / 2, 420, 40, 'center', '#ffe066', 6);
    const tab = 'PRESS TAB FOR YOUR KEYS';
    alphaText(tab, W / 2 - alphaWidth(tab, 0.5) / 2, 462, 0.5, 1);
    text('Your keys: ' + keysShort() + '  |  ' + laneKeys.map((ks) => (ks[1] ? keyLabel(ks[1]) : '-')).join(' ') + '   |   autoplay: ' + keyLabel(autoKey) + '   |   ENTER: pause',
      W / 2, 548, 18, 'center', '#ffffff', 3);
    text('[  ]: sync ' + (userOffset > 0 ? '+' : '') + userOffset + ' ms (+: the notes later)   |   F11: full screen', W / 2, 578, 18, 'center', '#ffffff', 3);
    text(autoplay ? 'Autoplay: ON' : 'Autoplay: off', W / 2, 614, 20, 'center', autoplay ? '#9cff9c' : '#cccccc', 3);
    text('IZQUIERDA / DERECHA: canción     ARRIBA / ABAJO: rival', W / 2, 652, 16, 'center', '#ffb0a0', 3);
    text('Mini FNF ' + VERSION, W - 14, H - 16, 14, 'right', '#bbbbbb', 3);
  }
  function drawKeys() {
    // (FNF's menuDesat, tinted as the MiSide mod's keys screen)
    g.drawImage(IMG.menuDesat, 0, 0, W, H);
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = 'rgb(115,107,153)';
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'source-over';
    panel(0.35);
    alphaText('YOUR KEYS', 90, 50, 0.9, 1);
    for (let i = 0; i < KEY_ROWS; i++) {
      const y = 150 + i * 72;
      const sel = i === keysSel;
      const a = sel ? 1 : 0.55;
      alphaText(i < 4 ? LANE_NAMES[i] : i === AUTO_ROW ? 'AUTOPLAY' : 'RESET', 140 + (sel ? 20 : 0), y, 0.62, a);
      const capturing = sel && keysSlot >= 0;
      const col = capturing ? '#ffd94d' : 'rgba(255,255,255,' + a + ')';
      let str, size = 24;
      if (i < 4) {
        size = 30;
        str = capturing ? (keysSlot === 0 ? 'press its key...' : keyLabel(keysTemp[0]) + '  |  press another (BACKSPACE: only this one)') : keysText(i);
      } else if (i === AUTO_ROW) {
        str = capturing ? 'press its key... (BACKSPACE: none)' : keyLabel(autoKey) + '   (in the song: your side hits every note; again: off)';
      } else {
        str = now() - keysSaidAt < 2500 ? 'done: W A S D and the arrows again' : 'W A S D and the arrows, autoplay ' + keyLabel(AUTO_DEFAULT);
      }
      text(str, 600, y + 28, size, 'left', col, 4);
    }
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillRect(0, H - 30, W, 30);
    text(keysSlot >= 0 ? 'any key of the keyboard  |  ESC: keep it as it was' : 'UP / DOWN: choose  |  ENTER: set its keys  |  BACKSPACE: back to the start screen',
      W / 2, H - 15, 16, 'center', '#ffffff', 2);
  }
  function drawPause() {
    panel(0.6);
    text(songs[songIndex].title, W - 24, 40, 32, 'right', '#ffffff', 5);
    text('HARD', W - 24, 78, 32, 'right', '#ffffff', 5);
    PAUSE_ITEMS.forEach((s, i) => {
      const on = i === S.menuIx;
      text(s, 120 + (on ? 20 : 0), 300 + i * 90, 56, 'left', on ? '#ffffff' : 'rgba(255,255,255,0.55)', 8);
    });
    text('UP / DOWN, ENTER   |   ESC: resume   |   [  ]: sync ' + (userOffset > 0 ? '+' : '') + userOffset + ' ms   |   ' + keyLabel(autoKey) + ': autoplay ' + (autoplay ? 'ON' : 'off'),
      W / 2, 590, 18, 'center', '#dddddd', 3);
  }
  function drawResults() {
    const a = clamp((now() - endAt) / 400, 0, 1);
    g.globalAlpha = a;
    panel(0.66);
    const acc = S.passSum > 0 ? Math.floor((S.hitSum / S.passSum) * 100 + 0.5) : 100;
    const c = S.counts;
    text(songs[songIndex].title + '  -  ' + songs[songIndex].difficulty, W / 2, 170, 56, 'center', '#ff4d4d', 8);
    text('Score: ' + S.score, W / 2, 260, 36, 'center', '#ffffff', 5);
    text(`Misses: ${S.misses}   Accuracy: ${acc}%   Best combo: ${S.maxCombo}`, W / 2, 320, 24, 'center', '#ffffff', 4);
    text(`Sick ${c.sick}   Good ${c.good}   Bad ${c.bad}   Shit ${c.shit}`, W / 2, 365, 22, 'center', '#dddddd', 4);
    if (S.autoUsed) text('(autoplay)', W / 2, 405, 20, 'center', '#9cff9c', 3);
    text('ENTER: again   |   ESC: start screen', W / 2, 500, 24, 'center', '#ffe066', 4);
    g.globalAlpha = 1;
  }
  function drawOver() {
    // (FNF's game over: him alone on black, the camera to him)
    base(wg);
    wg.fillStyle = '#000';
    wg.fillRect(0, 0, W, H);
    const t = now();
    const e = clamp((t - endAt) / 1500, 0, 1);
    const ease = 1 - Math.pow(1 - e, 3);
    const cx = chars.boy.x, cy = chars.boy.feet - 120;
    const z = 1 + 0.1 * ease;
    const tx = (W / 2 - cx) * ease, ty = (H / 2 - cy) * ease;
    wg.setTransform(R * z, 0, 0, R * z, R * (cx + tx - cx * z), R * (cy + ty - cy * z));
    let a = 1;
    if (overConfirm) a = 1 - clamp((t - overConfirm - 700) / 2000, 0, 1);
    wg.globalAlpha = a;
    drawChar(chars.boy, 0, 0, false, wg, true);
    wg.globalAlpha = 1;
    base(wg);
    g.drawImage(world, 0, 0, W, H);
    if (!overConfirm) text('ENTER: retry   |   ESC: start screen', W / 2, H - 40, 22, 'center', 'rgba(255,255,255,' + (0.5 + 0.5 * clamp((t - endAt - 800) / 600, 0, 1)) + ')', 4);
  }

  let lastFrame = now();
  const snapQ = [], snaps = [];
  function loop() {
    const t = now();
    const dt = Math.min(0.1, Math.max(0, (t - lastFrame) / 1000));
    lastFrame = t;
    if (dt > 0) frameMs = clamp(frameMs + (dt * 1000 - frameMs) * 0.05, 4, 50);
    base(g);
    g.imageSmoothingQuality = 'high';
    g.clearRect(0, 0, W, H);
    if (state === 'loading') {
      g.fillStyle = '#000';
      g.fillRect(0, 0, W, H);
      text(loadErr ? 'Could not load: ' + loadErr : 'Loading...', W / 2, H / 2, 28, 'center', '#fff', 0);
      present(0, 0, 0);
      requestAnimationFrame(loop);
      return;
    }
    fireClock += dt;
    flick = 1 + 0.07 * Math.sin(fireClock * 9.1) + 0.05 * Math.sin(fireClock * 23.3 + 1.7) + rnd(-0.025, 0.025);
    stepMotes(dt);
    stepMusic(dt);
    let ca = 0, con = 0, bri = 0, dance = 0;
    if (state === 'play' && !S.paused) step(dt);
    if (state === 'play') {
      const pos = S.pos;
      drawWorld(pos / S.crochet, pos, true);
      g.drawImage(world, 0, 0, W, H);
      drawHud(pos, S.paused ? 0 : dt);
      if (S.paused) drawPause();
      else {
        ca = S.chroma;
        dance = S.danceX;
        // (its Bright past 100%: the colours times 1 + (h/2 − 1)/8, then (h/2 − 1)·2/32 added)
        const over = S.health / 2 - 1;
        if (over > 0) {
          con = over / 8;
          bri = (over * 2) / 32;
        }
      }
    } else if (state === 'over') {
      if (!overConfirm && t >= overMusicAt && music.name !== 'gameOver') playMusic('gameOver', 1, 1, 0);
      if (overConfirm && t - overConfirm > 2700) {
        overConfirm = 0;
        startSong(0);
      } else {
        drawOver();
      }
    } else if (state === 'keys') {
      drawKeys();
    } else if (state === 'title' || state === 'results') {
      const el = music.name === 'freakyMenu' && music.el && !music.el.paused ? music.el : null;
      // (the menu's music is FNF's freakyMenu, 102 a minute: the room dances to it)
      const beat = el ? (el.currentTime * 102) / 60 : ((t / 1000) * 102) / 60;
      drawWorld(beat, 0, false);
      g.drawImage(world, 0, 0, W, H);
      if (state === 'title') drawTitle();
      else drawResults();
    }
    if (snapQ.length && state === 'play' && S && !S.paused && S.pos >= snapQ[0]) {
      snapQ.shift();
      try {
        snaps.push({ pos: Math.round(S.pos), url: frame.toDataURL('image/jpeg', 0.85) });
      } catch (error) {
        if (error.name !== 'SecurityError') throw error;
        console.warn('Serve the game over HTTP to export canvas snapshots.');
        snapQ.length = 0;
      }
    }
    screenEl.style.transform = dance ? `translateX(${(dance * cssK).toFixed(2)}px)` : '';
    present(ca, con, bri);
    requestAnimationFrame(loop);
  }

  // ================================================================== your keys (TAB on the start screen: the MiSide mod's own menu)
  // (two keys an arrow — W A S D and the arrows by default, as FNF's —, one for the autoplay; any key of the keyboard;
  // kept in this browser)
  const LANE_NAMES = ['LEFT', 'DOWN', 'UP', 'RIGHT'];
  const DEFAULT_KEYS = [['KeyA', 'ArrowLeft'], ['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp'], ['KeyD', 'ArrowRight']];
  const AUTO_DEFAULT = 'F6';
  const KEY_ROWS = 6, AUTO_ROW = 4, RESET_ROW = 5;
  // (not a key of yours: the menus' and the browser's own)
  const NOT_A_KEY = new Set(['Escape', 'Backspace', 'Enter', 'NumpadEnter', 'Tab', 'F11', 'F5', 'F12', 'BracketLeft', 'BracketRight', 'MetaLeft', 'MetaRight', 'ContextMenu']);
  let laneKeys = DEFAULT_KEYS.map((k) => k.slice());
  let autoKey = AUTO_DEFAULT;
  let keyNames = {};
  let keysSel = 0, keysSlot = -1, keysSaidAt = -1e9;
  const keysTemp = [null, null];
  const defaultsOf = (lane) => DEFAULT_KEYS[lane].slice();
  const laneHas = (k) => laneKeys.some((ks) => ks.indexOf(k) >= 0);
  const laneOf = (k) => {
    for (let l = 0; l < 4; l++) if (laneKeys[l].indexOf(k) >= 0) return l;
    return -1;
  };
  function loadKeys() {
    const v = store.get('keys', null);
    for (let l = 0; l < 4; l++) {
      const ks = Array.isArray(v) && Array.isArray(v[l]) ? v[l].filter((k) => typeof k === 'string' && !NOT_A_KEY.has(k)).slice(0, 2) : [];
      laneKeys[l] = ks.length ? ks : defaultsOf(l);
    }
    const a = store.get('autoKey', AUTO_DEFAULT);
    autoKey = a === null || typeof a === 'string' ? a : AUTO_DEFAULT;
    // (an arrow's key is the arrow's)
    if (autoKey && laneHas(autoKey)) autoKey = null;
    const n = store.get('keyNames', {});
    keyNames = n && typeof n === 'object' ? n : {};
  }
  function saveKeys() {
    store.set('keys', laneKeys);
    store.set('autoKey', autoKey);
    store.set('keyNames', keyNames);
  }
  // (the keys with no letter of their own: their names)
  const SPECIAL_NAMES = {
    ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Space: 'SPACE', ShiftLeft: 'L SHIFT', ShiftRight: 'R SHIFT',
    ControlLeft: 'L CTRL', ControlRight: 'R CTRL', AltLeft: 'L ALT', AltRight: 'R ALT', CapsLock: 'CAPS LOCK', Insert: 'INSERT',
    Delete: 'DELETE', Home: 'HOME', End: 'END', PageUp: 'PAGE UP', PageDown: 'PAGE DOWN', NumpadAdd: 'NUM +', NumpadSubtract: 'NUM -',
    NumpadMultiply: 'NUM *', NumpadDivide: 'NUM /', NumpadDecimal: 'NUM .',
  };
  // (the rest by the letter your keyboard writes there — Ç on a Brazilian one —, else by a US keyboard's)
  const CODE_NAMES = {
    Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', IntlBackslash: '\\', IntlRo: '/', Minus: '-',
    Equal: '=', Backquote: '`',
  };
  let layoutMap = null;
  try {
    if (navigator.keyboard && navigator.keyboard.getLayoutMap) navigator.keyboard.getLayoutMap().then((m) => { layoutMap = m; }).catch(() => {});
  } catch (e) {
    layoutMap = null;
  }
  function keyLabel(code) {
    if (!code) return '-';
    if (SPECIAL_NAMES[code]) return SPECIAL_NAMES[code];
    if (/^F\d+$/.test(code)) return code;
    if (keyNames[code]) return keyNames[code];
    try {
      const ch = layoutMap && layoutMap.get(code);
      if (ch && ch.length === 1 && ch.trim()) return ch.toUpperCase();
    } catch (e) {
      // (no layout to ask)
    }
    if (CODE_NAMES[code]) return CODE_NAMES[code];
    let m = /^Key([A-Z])$/.exec(code);
    if (m) return m[1];
    m = /^Digit(\d)$/.exec(code);
    if (m) return m[1];
    m = /^Numpad(\d)$/.exec(code);
    if (m) return 'NUM ' + m[1];
    return code.toUpperCase();
  }
  const keysText = (l) => (laneKeys[l].length === 1 ? keyLabel(laneKeys[l][0]) : keyLabel(laneKeys[l][0]) + '  |  ' + keyLabel(laneKeys[l][1]));
  const keysShort = () => laneKeys.map((ks) => keyLabel(ks[0])).join(' ');
  // (a letter of your keyboard's own — Ç, ~ — by the key that wrote it)
  function rememberName(e) {
    if (e.key && e.key.length === 1 && e.key.trim() && !SPECIAL_NAMES[e.code] && !/^Numpad/.test(e.code)) keyNames[e.code] = e.key.toUpperCase();
  }
  // (a key is one arrow's: taken off the others — an arrow left with none, its own back but that one)
  function takeOff(keys, but) {
    for (let l = 0; l < 4; l++) {
      if (l === but) continue;
      let keep = laneKeys[l].filter((k) => keys.indexOf(k) < 0);
      if (!keep.length) keep = defaultsOf(l).filter((k) => keys.indexOf(k) < 0 && !laneKeys.some((ks, j) => j !== l && ks.indexOf(k) >= 0));
      laneKeys[l] = keep.length ? keep : defaultsOf(l).filter((k) => keys.indexOf(k) < 0);
    }
  }
  function setLaneKeys(ks) {
    laneKeys[keysSel] = ks;
    takeOff(ks, keysSel);
    // (the autoplay's key went to an arrow: the autoplay back on its own key, if that one is free)
    if (autoKey && laneHas(autoKey)) autoKey = laneHas(AUTO_DEFAULT) ? null : AUTO_DEFAULT;
    keysSlot = -1;
    sfx('confirmMenu', 0.5);
    saveKeys();
  }
  function setAutoKey(k) {
    autoKey = k;
    if (k) takeOff([k], -1);
    keysSlot = -1;
    sfx('confirmMenu', 0.5);
    saveKeys();
  }
  function openKeys() {
    keysSel = 0;
    keysSlot = -1;
    state = 'keys';
    sfx('scrollMenu', 0.4);
  }
  function keysKey(e) {
    const enter = e.code === 'Enter' || e.code === 'NumpadEnter';
    if (keysSlot >= 0) {
      // (the next key pressed is the arrow's: its first, then its second — BACKSPACE: only one; ESC: as it was)
      if (e.code === 'Escape') {
        keysSlot = -1;
        return;
      }
      if (keysSel === AUTO_ROW && e.code === 'Backspace') {
        setAutoKey(null);
        return;
      }
      if (keysSlot === 1 && e.code === 'Backspace') {
        setLaneKeys([keysTemp[0]]);
        return;
      }
      if (NOT_A_KEY.has(e.code)) return;
      rememberName(e);
      if (keysSel === AUTO_ROW) {
        setAutoKey(e.code);
        return;
      }
      keysTemp[keysSlot] = e.code;
      if (keysSlot === 0) {
        keysSlot = 1;
        sfx('scrollMenu', 0.4);
      } else {
        setLaneKeys(e.code === keysTemp[0] ? [keysTemp[0]] : [keysTemp[0], e.code]);
      }
      return;
    }
    if (e.code === 'ArrowUp') {
      keysSel = (keysSel + KEY_ROWS - 1) % KEY_ROWS;
      sfx('scrollMenu', 0.4);
    } else if (e.code === 'ArrowDown') {
      keysSel = (keysSel + 1) % KEY_ROWS;
      sfx('scrollMenu', 0.4);
    } else if (enter) {
      sfx('confirmMenu', 0.5);
      if (keysSel === RESET_ROW) {
        laneKeys = DEFAULT_KEYS.map((k) => k.slice());
        autoKey = AUTO_DEFAULT;
        saveKeys();
        keysSaidAt = now();
      } else {
        keysSlot = 0;
        keysTemp[0] = keysTemp[1] = null;
      }
    } else if (e.code === 'Backspace' || e.code === 'Tab' || e.code === 'Escape') {
      sfx('cancelMenu', 0.5);
      state = 'title';
    }
  }

  // ================================================================== keys
  const downKeys = new Set();
  function startFromMenu() {
    actx.resume().then(() => startSong(0));
  }
  window.addEventListener('keydown', (e) => {
    // (none of your keys, nor the menus', does the browser's own thing here: no scrolling, no quick find)
    if (laneOf(e.code) >= 0 || e.code === autoKey || ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Tab', 'Backspace', 'F6', 'Quote', 'Slash'].indexOf(e.code) >= 0) e.preventDefault();
    if (state === 'loading') return;
    const first = !e.repeat && !downKeys.has(e.code);
    downKeys.add(e.code);
    unlock();
    if (!first) return;
    if (state === 'keys') {
      keysKey(e);
      return;
    }
    if (autoKey && e.code === autoKey) {
      autoplay = !autoplay;
      store.set('autoplay', autoplay);
      if (S && state === 'play' && autoplay) {
        // (your keys let go of: the autoplay's from here — a hold already on goes on as its)
        S.autoUsed = true;
        for (let l = 0; l < 4; l++) S.held[l] = false;
      }
      return;
    }
    if ((e.code === 'BracketLeft' || e.code === 'BracketRight') && (state === 'title' || (state === 'play' && S && S.paused))) {
      userOffset = clamp(userOffset + (e.code === 'BracketLeft' ? -5 : 5), -300, 300);
      store.set('offset', userOffset);
      return;
    }
    const enter = e.code === 'Enter' || e.code === 'NumpadEnter';
    const lane = laneOf(e.code);
    if (state === 'title') {
      if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
        rivalIndex = (rivalIndex + (e.code === 'ArrowUp' ? -1 : 1) + rivals.length) % rivals.length;
        sfx('scrollMenu', 0.4);
        return;
      }
      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        songIndex = (songIndex + (e.code === 'ArrowLeft' ? -1 : 1) + songs.length) % songs.length;
        sfx('scrollMenu', 0.4);
        return;
      }
      if (enter) startFromMenu();
      else if (e.code === 'Tab') openKeys();
      return;
    }
    if (state === 'results') {
      if (now() - endAt < 400) return;
      if (enter) startFromMenu();
      else if (e.code === 'Escape' || e.code === 'Backspace') toTitle();
      return;
    }
    if (state === 'over') {
      if (overConfirm || now() - endAt < 600) return;
      if (enter) {
        overConfirm = now();
        stopMusic();
        sfx('gameOverEnd', 1);
      } else if (e.code === 'Escape' || e.code === 'Backspace') {
        toTitle();
      }
      return;
    }
    if (state !== 'play' || !S) return;
    if (S.paused) {
      if (e.code === 'ArrowUp' || lane === 2) {
        S.menuIx = (S.menuIx + PAUSE_ITEMS.length - 1) % PAUSE_ITEMS.length;
        sfx('scrollMenu', 0.4);
      } else if (e.code === 'ArrowDown' || lane === 1) {
        S.menuIx = (S.menuIx + 1) % PAUSE_ITEMS.length;
        sfx('scrollMenu', 0.4);
      } else if (e.code === 'Escape') {
        pauseSet(false);
      } else if (enter) {
        if (S.menuIx === 0) pauseSet(false);
        else if (S.menuIx === 1) startFromMenu();
        else toTitle();
      }
      return;
    }
    if (enter || e.code === 'Escape') {
      pauseSet(true);
      return;
    }
    if (lane < 0 || autoplay || S.held[lane]) return;
    // (judged by when the key went down, not by the frame: the song's own clock at that moment)
    press(lane, songAt(e.timeStamp));
  });
  window.addEventListener('keyup', (e) => {
    downKeys.delete(e.code);
    if (state !== 'play' || !S || S.paused || autoplay) return;
    const lane = laneOf(e.code);
    if (lane < 0 || !S.held[lane]) return;
    // (the arrow's other key still down: not let go yet)
    for (const k of laneKeys[lane]) if (downKeys.has(k)) return;
    release(lane, songAt(e.timeStamp));
  });
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('blur', () => {
    downKeys.clear();
    if (S && state === 'play' && !S.paused) pauseSet(true);
  });

  // ================================================================== go
  loadKeys();
  makeMoteSprite();
  requestAnimationFrame(loop);
  load().then(() => {
    toTitle();
  }).catch((e) => {
    loadErr = (e && e.message) || String(e);
    console.error(e);
  });
  // (for a test: where it is, and a start anywhere in the song)
  window.__genocide = {
    get S() { return S; },
    get state() { return state; },
    get boy() { return chars.boy; },
    get keys() { return { laneKeys, autoKey, keyNames }; },
    start: (fromMs) => actx.resume().then(() => startSong(fromMs || 0)),
    songAt: (p) => songAt(p === undefined ? now() : p),
    snapAt: (list) => { snapQ.length = 0; snapQ.push(...list); snaps.length = 0; },
    get snaps() { return snaps; },
  };
})();
