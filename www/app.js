// ═══════════════════════════════════════════════════════════════
//  SmashPad — app.js
//  Protocolo JSON sobre WebSocket.
//  En Safari: conecta usando la IP del servidor directamente.
//  En IPA (Capacitor): muestra pantalla para introducir la IP.
// ═══════════════════════════════════════════════════════════════

const PLAYER_COLORS = {
  1: '#e74c3c',
  2: '#3498db',
  3: '#f1c40f',
  4: '#2ecc71'
};

const state = {
  socket:               null,
  selectedPlayer:       1,
  connectedPlayer:      null,
  wsUrl:                null,   // se asigna tras detectar el entorno
  activeButtons:        new Set(),
  activeDirections:     new Set(),
  joystickPointerId:    null,
  gyroEnabled:          false,
  gyroPermissionGranted: false,
  gyroNeutral:          null,
  gyroLast:             null
};

// ─── Entry ───────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  bindSetup();
  bindController();
  applyPlayerTheme(1);

  if (isCapacitor()) {
    // En IPA: el hostname es localhost → no sirve para conectar al servidor.
    // Mostramos la pantalla de entrada de IP.
    injectIpScreen();
  } else {
    // En Safari abierto desde http://192.168.1.X:3000 → hostname correcto.
    state.wsUrl = buildWsUrl();
    updateServerAddress();
    const p = getInitialPlayer();
    if (p) {
      connectAs(p);
    } else {
      setSetupMessage('Toca tu jugador para conectarte automaticamente.');
    }
  }
});

// ─── Detección de entorno ─────────────────────────────────────────────────────

function isCapacitor() {
  return (
    window.Capacitor !== undefined ||
    window.location.protocol === 'capacitor:' ||
    window.location.protocol === 'http:' && window.location.hostname === 'localhost'
  );
}

// ─── URL del WebSocket ────────────────────────────────────────────────────────

function buildWsUrl(hostOverride) {
  const params = new URLSearchParams(window.location.search);
  const host   = hostOverride || params.get('wsHost');
  const port   = params.get('wsPort') || '8000';

  if (host) return `ws://${host}:${port}`;

  // Flujo Safari: usa la IP del servidor HTTP directamente
  const h = window.location.hostname || '127.0.0.1';
  return `ws://${h}:${port}`;
}

// ─── Pantalla de IP (solo IPA) ────────────────────────────────────────────────

function injectIpScreen() {
  const saved = lsGet('smashpad_ip') || '';

  const scr = document.createElement('div');
  scr.id = 'ipScreen';
  scr.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:9999',
    'display:flex', 'align-items:center', 'justify-content:center',
    'background:rgba(6,6,14,.97)',
    "font-family:'Share Tech Mono',monospace"
  ].join(';');

  scr.innerHTML = `
    <div style="width:min(90%,380px);padding:28px 24px;
                border:1px solid rgba(255,255,255,.1);border-radius:22px;
                background:rgba(10,12,22,.9);display:grid;gap:16px;text-align:center;">
      <div style="font-family:'Orbitron',sans-serif;font-size:22px;color:#fff;letter-spacing:.06em;">
        SMASH<span style="color:#e74c3c;">PAD</span>
      </div>
      <div style="font-size:11px;color:#7c8ba1;letter-spacing:.1em;">INTRODUCE LA IP DE TU PC</div>
      <input id="ipInput" type="text" inputmode="decimal" placeholder="192.168.1.X"
        value="${saved}"
        style="padding:14px 16px;border-radius:12px;border:1px solid rgba(6,182,212,.35);
               background:rgba(6,182,212,.07);color:#d7fbff;font-size:18px;
               font-family:'Share Tech Mono',monospace;text-align:center;
               outline:none;width:100%;-webkit-appearance:none;" />
      <p style="font-size:11px;color:#7c8ba1;line-height:1.6;margin:0;">
        Ejecuta <code style="color:#06b6d4;">python server.py</code> en el PC.<br>
        La IP aparece en la terminal al arrancar.<br>
        <span style="color:#4a5568;">ej: 192.168.1.34</span>
      </p>
      <button id="ipConnectBtn" type="button"
        style="padding:15px;border-radius:999px;border:none;cursor:pointer;
               background:linear-gradient(180deg,#e74c3c,#c0392b);color:#fff;
               font-family:'Orbitron',sans-serif;font-size:14px;letter-spacing:.08em;
               -webkit-appearance:none;">
        CONECTAR
      </button>
      <div id="ipError" style="font-size:12px;color:#e74c3c;min-height:18px;line-height:1.4;"></div>
    </div>
  `;

  document.body.appendChild(scr);

  const inp = document.getElementById('ipInput');
  const btn = document.getElementById('ipConnectBtn');
  const err = document.getElementById('ipError');

  const attempt = () => {
    const raw = inp.value.trim();
    if (!raw) { err.textContent = 'Escribe la IP del PC.'; return; }

    // Limpiar posibles prefijos ws:// o http://
    const ip = raw.replace(/^wss?:\/\//, '').replace(/^https?:\/\//, '').split(':')[0].split('/')[0];
    if (!ip) { err.textContent = 'IP no valida.'; return; }

    lsSet('smashpad_ip', ip);
    const wsUrl = `ws://${ip}:8000`;

    err.textContent = 'Probando conexion…';
    btn.disabled = true;
    btn.style.opacity = '0.6';

    // Probe: verificar que el servidor responde antes de continuar
    let probe;
    try {
      probe = new WebSocket(wsUrl);
    } catch {
      err.textContent = 'URL no valida. Revisa la IP.';
      btn.disabled = false;
      btn.style.opacity = '1';
      return;
    }

    const timer = setTimeout(() => {
      try { probe.close(); } catch {}
      err.textContent = 'Sin respuesta. ¿Esta corriendo server.py en el PC?';
      btn.disabled = false;
      btn.style.opacity = '1';
    }, 5000);

    probe.addEventListener('open', () => {
      clearTimeout(timer);
      try { probe.close(); } catch {}
      // Conexion OK → guardar URL y arrancar la app
      state.wsUrl = wsUrl;
      scr.remove();
      updateServerAddress();
      const p = getInitialPlayer();
      if (p) connectAs(p); else setSetupMessage('Toca tu jugador para conectarte.');
    });

    probe.addEventListener('error', () => {
      clearTimeout(timer);
      err.textContent = 'No se pudo conectar. Revisa la IP y que esten en la misma Wi-Fi.';
      btn.disabled = false;
      btn.style.opacity = '1';
    });
  };

  btn.addEventListener('click', attempt);
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') attempt(); });

  // Si hay IP guardada, intentar automáticamente
  if (saved) {
    setTimeout(attempt, 300);
  }
}

// ─── localStorage helpers ─────────────────────────────────────────────────────

function lsGet(k)    { try { return localStorage.getItem(k); }    catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); }        catch {} }

// ─── Setup ────────────────────────────────────────────────────────────────────

function getInitialPlayer() {
  const p = Number.parseInt(new URLSearchParams(location.search).get('player') || '', 10);
  return Number.isInteger(p) && p >= 1 && p <= 4 ? p : null;
}

function bindSetup() {
  document.querySelectorAll('.player-card').forEach((card) => {
    card.addEventListener('click', () => {
      const p = Number.parseInt(card.dataset.player || '', 10);
      if (p) connectAs(p);
    });
  });
}

// ─── Controller bindings ──────────────────────────────────────────────────────

function bindController() {
  document.getElementById('gyroBtn').addEventListener('click', toggleGyroMode);
  document.getElementById('gyroCenterBtn').addEventListener('click', calibrateGyro);
  document.getElementById('fullscreenBtn').addEventListener('click', toggleFullscreen);
  document.getElementById('resetBtn').addEventListener('click', () => {
    disconnect('manual');
    disableGyro();
    showSetup();
    setStatus('Jugador liberado. Puedes elegir otro.');
  });

  bindButtonPad();
  bindJoystick();

  window.addEventListener('beforeunload', () => disconnect('pagehide'));
  window.addEventListener('pagehide',     () => disconnect('pagehide'));
  window.addEventListener('blur', releaseAllInputs);
  window.addEventListener('deviceorientation', handleDeviceOrientation);

  updateGyroUi();
}

// ─── WebSocket ────────────────────────────────────────────────────────────────

function connectAs(player) {
  state.selectedPlayer = player;
  applyPlayerTheme(player);
  setStatus(`Conectando jugador ${player}...`);
  setSetupMessage(`Conectando P${player}…`);

  if (state.socket) disconnect('switch');

  let socket;
  try {
    socket = new WebSocket(state.wsUrl);
  } catch {
    showSetup();
    setSetupMessage('No se pudo abrir el WebSocket. Revisa la IP.');
    return;
  }

  state.socket = socket;

  // Timeout de conexion: si en 6s no abre, avisamos
  const connectTimer = setTimeout(() => {
    if (state.socket !== socket) return;
    if (socket.readyState === WebSocket.CONNECTING) {
      socket.close();
      state.socket = null;
      showSetup();
      setSetupMessage('Sin respuesta del servidor. Comprueba que server.py esta corriendo.');
    }
  }, 6000);

  socket.addEventListener('open', () => {
    clearTimeout(connectTimer);
    // Enviamos handshake: identificamos qué jugador somos
    safeSend({ player });
  });

  socket.addEventListener('message', (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }

    if (msg.status === 'connected') {
      state.connectedPlayer = msg.player;
      applyPlayerTheme(msg.player);
      showController();
      setStatus(`Jugador ${msg.player} conectado`);
    }
  });

  socket.addEventListener('error', () => {
    clearTimeout(connectTimer);
    if (state.socket !== socket) return;
    showSetup();
    setSetupMessage('No se pudo conectar. Revisa la IP y la Wi-Fi.');
  });

  socket.addEventListener('close', () => {
    clearTimeout(connectTimer);
    if (state.socket !== socket) return;
    state.socket = null;
    releaseAllInputs();
    if (state.connectedPlayer !== null) {
      showSetup();
      setSetupMessage('Conexion perdida. Toca tu jugador para volver.');
    }
    state.connectedPlayer = null;
  });
}

function disconnect(reason) {
  releaseAllInputs();
  if (!state.socket) { state.connectedPlayer = null; return; }
  const s = state.socket;
  state.socket = null;
  state.connectedPlayer = null;
  try { s.close(1000, reason); } catch {}
}

function safeSend(payload) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
  state.socket.send(JSON.stringify(payload));
}

// ─── Button pad ───────────────────────────────────────────────────────────────

function bindButtonPad() {
  document.querySelectorAll('[data-btn]').forEach((btn) => {
    if (btn.id === 'joystick') return;
    const name = btn.dataset.btn;
    if (!name) return;

    const press = (e) => {
      e.preventDefault();
      if (e.pointerId !== undefined) { try { btn.setPointerCapture(e.pointerId); } catch {} }
      if (btn.dataset.pressed === '1') return;
      btn.dataset.pressed = '1';
      btn.classList.add('pressed');
      state.activeButtons.add(name);
      safeSend({ button: name, action: 'press' });
    };
    const release = (e) => {
      if (e) e.preventDefault();
      if (btn.dataset.pressed !== '1') return;
      if (e?.pointerId !== undefined) { try { btn.releasePointerCapture(e.pointerId); } catch {} }
      btn.dataset.pressed = '0';
      btn.classList.remove('pressed');
      state.activeButtons.delete(name);
      safeSend({ button: name, action: 'release' });
    };

    btn.addEventListener('pointerdown',       press);
    btn.addEventListener('pointerup',         release);
    btn.addEventListener('pointercancel',     release);
    btn.addEventListener('pointerleave',      release);
    btn.addEventListener('lostpointercapture', release);
  });
}

// ─── Joystick ─────────────────────────────────────────────────────────────────

function bindJoystick() {
  const area   = document.getElementById('joystick');
  const handle = document.getElementById('stickHandle');
  if (!area || !handle) return;

  const reset = () => {
    state.joystickPointerId = null;
    updateStickHandle(0, 0);
    syncDirections(new Set());
  };

  const move = (cx, cy) => {
    if (state.gyroEnabled) return;
    const r    = area.getBoundingClientRect();
    const dx   = cx - (r.left + r.width  / 2);
    const dy   = cy - (r.top  + r.height / 2);
    const maxR = r.width * 0.34;
    const dist = Math.hypot(dx, dy);
    const lim  = dist > maxR ? maxR / dist : 1;
    updateStickHandle(dx * lim, dy * lim);

    const nx = dx * lim / maxR, ny = dy * lim / maxR;
    const T  = 0.35, next = new Set();
    if (nx >  T) next.add('RIGHT');
    if (nx < -T) next.add('LEFT');
    if (ny >  T) next.add('DOWN');
    if (ny < -T) next.add('UP');
    syncDirections(next);
  };

  area.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    state.joystickPointerId = e.pointerId;
    area.setPointerCapture(e.pointerId);
    move(e.clientX, e.clientY);
  });
  area.addEventListener('pointermove', (e) => {
    if (state.joystickPointerId !== e.pointerId) return;
    e.preventDefault();
    move(e.clientX, e.clientY);
  });
  const up = (e) => { if (state.joystickPointerId !== e.pointerId) return; e.preventDefault(); reset(); };
  area.addEventListener('pointerup',           up);
  area.addEventListener('pointercancel',       up);
  area.addEventListener('lostpointercapture', reset);
}

function syncDirections(next) {
  state.activeDirections.forEach(d => { if (!next.has(d)) safeSend({ button: d, action: 'release' }); });
  next.forEach(d => { if (!state.activeDirections.has(d)) safeSend({ button: d, action: 'press' }); });
  state.activeDirections = next;
}

// ─── Gyro ─────────────────────────────────────────────────────────────────────

async function toggleGyroMode() {
  if (state.gyroEnabled) {
    disableGyro();
    setStatus(`Jugador ${state.connectedPlayer ?? state.selectedPlayer} conectado`);
    return;
  }
  const ok = await requestGyroPermission();
  if (!ok) { setGyroCopy('iPhone necesita permiso. Pulsa Gyro OFF otra vez y acepta.'); return; }
  state.gyroEnabled = true;
  calibrateGyro();
  releaseAllInputs();
  setStatus('Gyro activo');
  setGyroCopy('Inclina el movil para mover. Usa "Centrar gyro" si se desvia.');
  updateGyroUi();
}

function disableGyro() {
  state.gyroEnabled = false;
  state.gyroNeutral = state.gyroLast = null;
  syncDirections(new Set());
  updateStickHandle(0, 0);
  updateGyroUi();
  setGyroCopy('Puedes usar el stick o activar el gyro.');
}

async function requestGyroPermission() {
  if (state.gyroPermissionGranted) return true;
  if (typeof DeviceOrientationEvent === 'undefined') return false;
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const r = await DeviceOrientationEvent.requestPermission();
      state.gyroPermissionGranted = r === 'granted';
      return state.gyroPermissionGranted;
    } catch { return false; }
  }
  state.gyroPermissionGranted = true;
  return true;
}

function calibrateGyro() {
  if (!state.gyroLast) { setGyroCopy('Mueve un poco el movil y vuelve a pulsar "Centrar gyro".'); return; }
  state.gyroNeutral = { ...state.gyroLast };
  if (state.gyroEnabled) setGyroCopy('Centro guardado. Inclina para mover.');
}

function handleDeviceOrientation(ev) {
  if (typeof ev.beta !== 'number' || typeof ev.gamma !== 'number') return;
  state.gyroLast = { beta: ev.beta, gamma: ev.gamma };
  if (!state.gyroEnabled) return;
  if (!state.gyroNeutral) state.gyroNeutral = { ...state.gyroLast };
  const rawX = clamp((ev.gamma - state.gyroNeutral.gamma) / 18, -1, 1);
  const rawY = clamp((ev.beta  - state.gyroNeutral.beta)  / 18, -1, 1);
  const T = 0.24, next = new Set();
  if (rawX >  T) next.add('RIGHT');
  if (rawX < -T) next.add('LEFT');
  if (rawY >  T) next.add('DOWN');
  if (rawY < -T) next.add('UP');
  syncDirections(next);
  const area = document.getElementById('joystick');
  const maxR = area ? area.getBoundingClientRect().width * 0.34 : 0;
  updateStickHandle(rawX * maxR, rawY * maxR);
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function releaseAllInputs() {
  state.activeButtons.forEach(b => safeSend({ button: b, action: 'release' }));
  state.activeButtons.clear();
  syncDirections(new Set());
  document.querySelectorAll('[data-btn]').forEach(b => { b.classList.remove('pressed'); b.dataset.pressed = '0'; });
  updateStickHandle(0, 0);
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function updateStickHandle(x, y) {
  const h = document.getElementById('stickHandle');
  if (h) h.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
}

function updateGyroUi() {
  const g = document.getElementById('gyroBtn');
  const c = document.getElementById('gyroCenterBtn');
  if (!g || !c) return;
  g.textContent = state.gyroEnabled ? 'Gyro ON' : 'Gyro OFF';
  g.classList.toggle('mini-btn-active', state.gyroEnabled);
  c.disabled = !state.gyroEnabled;
  c.classList.toggle('mini-btn-disabled', !state.gyroEnabled);
}

function setGyroCopy(t) { const el = document.getElementById('gyroCopy'); if (el) el.textContent = t; }

function applyPlayerTheme(player) {
  const color = PLAYER_COLORS[player] || PLAYER_COLORS[1];
  document.documentElement.style.setProperty('--player-color', color);
  document.documentElement.style.setProperty('--player-glow', `${color}66`);
  document.querySelectorAll('.player-card').forEach(c => {
    const sel = Number.parseInt(c.dataset.player || '', 10) === player;
    c.classList.toggle('selected', sel);
    c.setAttribute('aria-checked', String(sel));
  });
}

function updateServerAddress() {
  const el = document.getElementById('serverAddress');
  if (el) el.textContent = state.wsUrl || '--';
}

function showController() {
  document.getElementById('setup').style.display      = 'none';
  document.getElementById('controller').style.display = 'block';
}

function showSetup() {
  document.getElementById('controller').style.display = 'none';
  document.getElementById('setup').style.display      = 'flex';
}

function setStatus(t) { const el = document.getElementById('statusText'); if (el) el.textContent = t; }
function setSetupMessage(t) { const el = document.getElementById('setupCopy'); if (el) el.textContent = t; }

async function toggleFullscreen() {
  const root = document.documentElement;
  if (!document.fullscreenElement && root.requestFullscreen) {
    try { await root.requestFullscreen(); } catch {}
  } else if (document.fullscreenElement && document.exitFullscreen) {
    try { await document.exitFullscreen(); } catch {}
  }
}
