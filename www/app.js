// ═══════════════════════════════════════════════════════════════════════
//  SmashPad — app.js  v2.1
//  Módulos: State | Theme | WebSocket | ButtonPad | Joystick | Gyro |
//           Haptics | QR Scanner | Settings | Layout (drag + scale)
// ═══════════════════════════════════════════════════════════════════════

/* ─── Constantes ─────────────────────────────────────────────────────── */

const PLAYER_COLORS = { 1: '#e74c3c', 2: '#3498db', 3: '#f1c40f', 4: '#2ecc71' };

const GYRO_SENSE_MAP = {
  1: { deadzone: 0.08, scale: 25 },
  2: { deadzone: 0.06, scale: 22 },
  3: { deadzone: 0.04, scale: 18 },
  4: { deadzone: 0.025, scale: 15 },
  5: { deadzone: 0.01, scale: 12 },
};
const GYRO_SMOOTHING = 0.22;

// Human-readable labels for each drag unit
const UNIT_LABELS = {
  'shoulder-row':  'Botones hombro (L·Z·R)',
  'stick-cluster': 'Stick / Joystick',
  'start-unit':    'Botón START',
  'face-cluster':  'Botones de ataque (A·B·X·Y)',
};

// Scale steps available (10% increments)
const SCALE_MIN  = 0.5;
const SCALE_MAX  = 2.0;
const SCALE_STEP = 0.1;

/* ─── Default layout ─────────────────────────────────────────────────── */
// cx/cy = centre position as % of controller container
// scale = size multiplier

function getDefaultLayout() {
  return {
    'shoulder-row':  { cx: 50, cy: 10,  scale: 1.0 },
    'stick-cluster': { cx: 18, cy: 63,  scale: 1.0 },
    'start-unit':    { cx: 50, cy: 72,  scale: 1.0 },
    'face-cluster':  { cx: 78, cy: 58,  scale: 1.0 },
  };
}

/* ─── State ──────────────────────────────────────────────────────────── */

const state = {
  // WebSocket
  socket:            null,
  selectedPlayer:    1,
  connectedPlayer:   null,
  wsUrl:             null,

  // Inputs
  activeButtons:     new Set(),
  activeDirections:  new Set(),
  joystickPointerId: null,

  // Gyro
  gyroEnabled:         false,
  gyroPermissionGranted: false,
  gyroNeutral:         null,
  gyroLast:            null,
  gyroSmoothed:        { x: 0, y: 0 },

  // Settings
  vibrationEnabled: lsGet('smashpad_vibration') !== 'false',
  gyroSensLevel:    Number(lsGet('smashpad_gyro_sens') || '3'),

  // QR
  qrStream:    null,
  qrAnimFrame: null,

  // Layout editor
  editMode:     false,
  editSelected: null,   // id of selected drag unit
  layout:       null,   // loaded from localStorage or defaults
};

/* ═══════════════════════════════════════════════════════════════════════
   ENTRY
   ═══════════════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
  bindSetup();
  bindController();
  applyPlayerTheme(1);
  initSettingsPanel();
  initLayout();           // must run before showController

  if (isCapacitor()) {
    injectIpScreen();
  } else {
    state.wsUrl = buildWsUrl();
    updateServerAddress();
    const p = getInitialPlayer();
    if (p) connectAs(p);
    else setSetupMessage('Toca tu jugador para conectarte.');
  }
});

/* ═══════════════════════════════════════════════════════════════════════
   MÓDULO: ENTORNO
   ═══════════════════════════════════════════════════════════════════════ */

function isCapacitor() {
  return (
    window.Capacitor !== undefined ||
    window.location.protocol === 'capacitor:' ||
    (window.location.protocol === 'http:' && window.location.hostname === 'localhost')
  );
}

function buildWsUrl(hostOverride) {
  const params = new URLSearchParams(window.location.search);
  const host   = hostOverride || params.get('wsHost');
  const port   = params.get('wsPort') || '8000';
  if (host) return `ws://${host}:${port}`;
  const h = window.location.hostname || '127.0.0.1';
  return `ws://${h}:${port}`;
}

/* ═══════════════════════════════════════════════════════════════════════
   MÓDULO: IP SCREEN (Capacitor only)
   ═══════════════════════════════════════════════════════════════════════ */

function injectIpScreen() {
  const saved = lsGet('smashpad_ip') || '';
  const scr = document.createElement('div');
  scr.id = 'ipScreen';
  scr.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(6,6,14,.97);font-family:\'Share Tech Mono\',monospace';
  scr.innerHTML = `
    <div style="width:min(90%,380px);padding:28px 24px;border:1px solid rgba(255,255,255,.1);border-radius:22px;background:rgba(10,12,22,.9);display:grid;gap:16px;text-align:center;">
      <div style="font-family:'Orbitron',sans-serif;font-size:22px;color:#fff;letter-spacing:.06em;">SMASH<span style="color:#e74c3c;">PAD</span></div>
      <div style="font-size:11px;color:#7c8ba1;letter-spacing:.1em;">INTRODUCE LA IP DE TU PC</div>
      <input id="ipInput" type="text" inputmode="decimal" placeholder="192.168.1.X" value="${saved}"
        style="padding:14px 16px;border-radius:12px;border:1px solid rgba(6,182,212,.35);background:rgba(6,182,212,.07);color:#d7fbff;font-size:18px;font-family:'Share Tech Mono',monospace;text-align:center;outline:none;width:100%;-webkit-appearance:none;" />
      <p style="font-size:11px;color:#7c8ba1;line-height:1.6;margin:0;">
        Ejecuta <code style="color:#06b6d4;">python server.py</code> en el PC.<br>
        <span style="color:#4a5568;">ej: 192.168.1.34</span>
      </p>
      <button id="ipConnectBtn" type="button" style="padding:15px;border-radius:999px;border:none;cursor:pointer;background:linear-gradient(180deg,#e74c3c,#c0392b);color:#fff;font-family:'Orbitron',sans-serif;font-size:14px;letter-spacing:.08em;-webkit-appearance:none;">CONECTAR</button>
      <div id="ipError" style="font-size:12px;color:#e74c3c;min-height:18px;line-height:1.4;"></div>
    </div>`;
  document.body.appendChild(scr);

  const inp = document.getElementById('ipInput');
  const btn = document.getElementById('ipConnectBtn');
  const err = document.getElementById('ipError');

  const attempt = () => {
    const raw = inp.value.trim();
    if (!raw) { err.textContent = 'Escribe la IP del PC.'; return; }
    const ip = raw.replace(/^wss?:\/\//,'').replace(/^https?:\/\//,'').split(':')[0].split('/')[0];
    if (!ip) { err.textContent = 'IP no valida.'; return; }
    lsSet('smashpad_ip', ip);
    const wsUrl = `ws://${ip}:8000`;
    err.textContent = 'Probando conexion…'; btn.disabled = true; btn.style.opacity = '0.6';
    let probe;
    try { probe = new WebSocket(wsUrl); }
    catch { err.textContent = 'URL no valida.'; btn.disabled = false; btn.style.opacity = '1'; return; }
    const timer = setTimeout(() => {
      try { probe.close(); } catch {}
      err.textContent = '¿Esta corriendo server.py?'; btn.disabled = false; btn.style.opacity = '1';
    }, 5000);
    probe.addEventListener('open', () => {
      clearTimeout(timer); try { probe.close(); } catch {}
      state.wsUrl = wsUrl; scr.remove(); updateServerAddress();
      const p = getInitialPlayer(); if (p) connectAs(p); else setSetupMessage('Toca tu jugador.');
    });
    probe.addEventListener('error', () => {
      clearTimeout(timer); err.textContent = 'No se pudo conectar. Revisa la IP y la Wi-Fi.';
      btn.disabled = false; btn.style.opacity = '1';
    });
  };
  btn.addEventListener('click', attempt);
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') attempt(); });
  if (saved) setTimeout(attempt, 300);
}

/* ═══════════════════════════════════════════════════════════════════════
   MÓDULO: SETUP
   ═══════════════════════════════════════════════════════════════════════ */

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
  document.getElementById('openQrScannerBtn')?.addEventListener('click', openQrScanner);
}

/* ═══════════════════════════════════════════════════════════════════════
   MÓDULO: CONTROLLER BINDINGS
   ═══════════════════════════════════════════════════════════════════════ */

function bindController() {
  document.getElementById('gyroBtn')?.addEventListener('click', toggleGyroMode);
  document.getElementById('gyroCenterBtn')?.addEventListener('click', calibrateGyro);
  document.getElementById('fullscreenBtn')?.addEventListener('click', toggleFullscreen);
  document.getElementById('settingsGearBtn')?.addEventListener('click', openSettings);

  bindButtonPad();
  bindJoystick();

  window.addEventListener('beforeunload', () => disconnect('pagehide'));
  window.addEventListener('pagehide',     () => disconnect('pagehide'));
  window.addEventListener('blur', releaseAllInputs);
  window.addEventListener('deviceorientation', handleDeviceOrientation);

  updateGyroUi();
}

/* ═══════════════════════════════════════════════════════════════════════
   MÓDULO: WEBSOCKET
   ═══════════════════════════════════════════════════════════════════════ */

function connectAs(player) {
  state.selectedPlayer = player;
  applyPlayerTheme(player);
  setStatus(`Conectando jugador ${player}...`);
  setSetupMessage(`Conectando P${player}…`);
  if (state.socket) disconnect('switch');

  let socket;
  try { socket = new WebSocket(state.wsUrl); }
  catch { showSetup(); setSetupMessage('No se pudo abrir el WebSocket.'); return; }
  state.socket = socket;

  const connectTimer = setTimeout(() => {
    if (state.socket !== socket) return;
    if (socket.readyState === WebSocket.CONNECTING) {
      socket.close(); state.socket = null; showSetup();
      setSetupMessage('Sin respuesta. Comprueba que server.py esta corriendo.');
    }
  }, 6000);

  socket.addEventListener('open', () => { clearTimeout(connectTimer); safeSend({ player }); });
  socket.addEventListener('message', (event) => {
    let msg; try { msg = JSON.parse(event.data); } catch { return; }
    if (msg.status === 'connected') {
      state.connectedPlayer = msg.player;
      applyPlayerTheme(msg.player);
      syncSettingsPlayerButtons(msg.player);
      showController();
      setStatus(`Jugador ${msg.player} conectado`);
    }
  });
  socket.addEventListener('error', () => {
    clearTimeout(connectTimer); if (state.socket !== socket) return;
    showSetup(); setSetupMessage('No se pudo conectar. Revisa la IP y la Wi-Fi.');
  });
  socket.addEventListener('close', () => {
    clearTimeout(connectTimer); if (state.socket !== socket) return;
    state.socket = null; releaseAllInputs();
    if (state.connectedPlayer !== null) { showSetup(); setSetupMessage('Conexion perdida.'); }
    state.connectedPlayer = null;
  });
}

function disconnect(reason) {
  releaseAllInputs();
  if (!state.socket) { state.connectedPlayer = null; return; }
  const s = state.socket; state.socket = null; state.connectedPlayer = null;
  try { s.close(1000, reason); } catch {}
}

function safeSend(payload) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
  state.socket.send(JSON.stringify(payload));
}

/* ═══════════════════════════════════════════════════════════════════════
   MÓDULO: BUTTON PAD
   ═══════════════════════════════════════════════════════════════════════ */

function bindButtonPad() {
  document.querySelectorAll('[data-btn]').forEach((btn) => {
    if (btn.id === 'joystick') return;
    const name = btn.dataset.btn;
    if (!name) return;

    const press = (e) => {
      if (state.editMode) return;
      e.preventDefault();
      if (e.pointerId !== undefined) { try { btn.setPointerCapture(e.pointerId); } catch {} }
      if (btn.dataset.pressed === '1') return;
      btn.dataset.pressed = '1';
      btn.classList.add('pressed');
      state.activeButtons.add(name);
      safeSend({ button: name, action: 'press' });
      if (['A','B','X','Y'].includes(name)) triggerHaptic();
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
    btn.addEventListener('pointerdown',        press);
    btn.addEventListener('pointerup',          release);
    btn.addEventListener('pointercancel',      release);
    btn.addEventListener('pointerleave',       release);
    btn.addEventListener('lostpointercapture', release);
  });
}

/* ═══════════════════════════════════════════════════════════════════════
   MÓDULO: JOYSTICK
   ═══════════════════════════════════════════════════════════════════════ */

function bindJoystick() {
  const area   = document.getElementById('joystick');
  const handle = document.getElementById('stickHandle');
  if (!area || !handle) return;

  const reset = () => { state.joystickPointerId = null; updateStickHandle(0, 0); syncDirections(new Set()); };
  const move  = (cx, cy) => {
    if (state.gyroEnabled || state.editMode) return;
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
    if (state.editMode) return;
    e.preventDefault(); state.joystickPointerId = e.pointerId; area.setPointerCapture(e.pointerId); move(e.clientX, e.clientY);
  });
  area.addEventListener('pointermove', (e) => {
    if (state.joystickPointerId !== e.pointerId) return; e.preventDefault(); move(e.clientX, e.clientY);
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

/* ═══════════════════════════════════════════════════════════════════════
   MÓDULO: GIROSCOPIO
   ═══════════════════════════════════════════════════════════════════════ */

async function toggleGyroMode() {
  if (state.gyroEnabled) { disableGyro(); setStatus(`Jugador ${state.connectedPlayer ?? state.selectedPlayer} conectado`); return; }
  const ok = await requestGyroPermission();
  if (!ok) { setGyroCopy('Permiso denegado. Pulsa Gyro otra vez.'); return; }
  state.gyroEnabled = true; state.gyroSmoothed = { x: 0, y: 0 };
  calibrateGyro(); releaseAllInputs(); setStatus('Giroscopio activo');
  setGyroCopy('Inclina el movil para mover. Pulsa "Centrar" si se desvia.');
  updateGyroUi();
}

function disableGyro() {
  state.gyroEnabled = false; state.gyroNeutral = null; state.gyroLast = null;
  state.gyroSmoothed = { x: 0, y: 0 };
  syncDirections(new Set()); updateStickHandle(0, 0); updateGyroUi();
  setGyroCopy('Usa el stick o activa el giroscopio.');
}

async function requestGyroPermission() {
  if (state.gyroPermissionGranted) return true;
  if (typeof DeviceOrientationEvent === 'undefined') return false;
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    try { const r = await DeviceOrientationEvent.requestPermission(); state.gyroPermissionGranted = r === 'granted'; return state.gyroPermissionGranted; }
    catch { return false; }
  }
  state.gyroPermissionGranted = true; return true;
}

function calibrateGyro() {
  if (!state.gyroLast) { setGyroCopy('Mueve el movil un momento y pulsa "Centrar".'); return; }
  state.gyroNeutral = { ...state.gyroLast }; state.gyroSmoothed = { x: 0, y: 0 };
  if (state.gyroEnabled) setGyroCopy('Centro guardado. Inclina para mover.');
}

function handleDeviceOrientation(ev) {
  if (typeof ev.beta !== 'number' || typeof ev.gamma !== 'number') return;
  state.gyroLast = { beta: ev.beta, gamma: ev.gamma };
  if (!state.gyroEnabled) return;
  if (!state.gyroNeutral) state.gyroNeutral = { ...state.gyroLast };
  const sens  = GYRO_SENSE_MAP[state.gyroSensLevel] || GYRO_SENSE_MAP[3];
  const rawX  = clamp((ev.gamma - state.gyroNeutral.gamma) / sens.scale, -1, 1);
  const rawY  = clamp((ev.beta  - state.gyroNeutral.beta)  / sens.scale, -1, 1);
  const alpha = 1 - GYRO_SMOOTHING;
  state.gyroSmoothed.x = alpha * rawX + GYRO_SMOOTHING * state.gyroSmoothed.x;
  state.gyroSmoothed.y = alpha * rawY + GYRO_SMOOTHING * state.gyroSmoothed.y;
  const sx = Math.abs(state.gyroSmoothed.x) > sens.deadzone ? state.gyroSmoothed.x : 0;
  const sy = Math.abs(state.gyroSmoothed.y) > sens.deadzone ? state.gyroSmoothed.y : 0;
  const T  = 0.22, next = new Set();
  if (sx >  T) next.add('RIGHT'); if (sx < -T) next.add('LEFT');
  if (sy >  T) next.add('DOWN');  if (sy < -T) next.add('UP');
  syncDirections(next);
  const area = document.getElementById('joystick');
  const maxR = area ? area.getBoundingClientRect().width * 0.34 : 0;
  updateStickHandle(sx * maxR, sy * maxR);
}

/* ═══════════════════════════════════════════════════════════════════════
   MÓDULO: HÁPTICA
   ═══════════════════════════════════════════════════════════════════════ */

function triggerHaptic() {
  if (!state.vibrationEnabled) return;
  if (window.Capacitor?.Plugins?.Haptics) { try { window.Capacitor.Plugins.Haptics.impact({ style: 'LIGHT' }); return; } catch {} }
  if (navigator.vibrate) { try { navigator.vibrate(22); } catch {} }
}

/* ═══════════════════════════════════════════════════════════════════════
   MÓDULO: QR SCANNER
   ═══════════════════════════════════════════════════════════════════════ */

function openQrScanner() {
  const modal = document.getElementById('qrScannerModal'); if (!modal) return;
  setQrResult('', ''); document.getElementById('qrScannerHint').textContent = 'Apunta al QR del servidor';
  modal.classList.add('open'); modal.setAttribute('aria-hidden','false');
  startQrCamera();
}

function closeQrScanner() {
  stopQrCamera();
  const modal = document.getElementById('qrScannerModal');
  if (modal) { modal.classList.remove('open'); modal.setAttribute('aria-hidden','true'); }
}

function startQrCamera() {
  const video = document.getElementById('qrVideo'), canvas = document.getElementById('qrCanvas');
  if (!video || !canvas) return;
  stopQrCamera();
  navigator.mediaDevices.getUserMedia({ video:{ facingMode:'environment', width:{ideal:1280}, height:{ideal:1280} }, audio:false })
    .then((stream) => {
      state.qrStream = stream; video.srcObject = stream; video.play().catch(()=>{});
      video.addEventListener('loadedmetadata', () => { canvas.width = video.videoWidth||640; canvas.height = video.videoHeight||640; scheduleQrScan(); }, { once:true });
    })
    .catch((err) => { setQrResult(`No se pudo acceder a la camara: ${err.name}`, 'error'); });
}

function stopQrCamera() {
  if (state.qrAnimFrame) { cancelAnimationFrame(state.qrAnimFrame); state.qrAnimFrame = null; }
  if (state.qrStream) { state.qrStream.getTracks().forEach(t => t.stop()); state.qrStream = null; }
  const video = document.getElementById('qrVideo'); if (video) video.srcObject = null;
}

function scheduleQrScan() { state.qrAnimFrame = requestAnimationFrame(scanQrFrame); }

function scanQrFrame() {
  const video = document.getElementById('qrVideo'), canvas = document.getElementById('qrCanvas');
  if (!video || !canvas || !state.qrStream) return;
  if (video.readyState !== video.HAVE_ENOUGH_DATA) { scheduleQrScan(); return; }
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  let imageData; try { imageData = ctx.getImageData(0, 0, canvas.width, canvas.height); } catch { scheduleQrScan(); return; }
  const code = (typeof jsQR !== 'undefined') ? jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts:'dontInvert' }) : null;
  if (code?.data) handleQrDetected(code.data); else scheduleQrScan();
}

function handleQrDetected(rawData) {
  let ip = null;
  try { ip = new URL(rawData.trim()).hostname; }
  catch { const m = rawData.trim().match(/(\d{1,3}(?:\.\d{1,3}){3})/); if (m) ip = m[1]; }
  if (!ip) { setQrResult('QR sin IP válida.', 'error'); scheduleQrScan(); return; }
  triggerHaptic();
  setQrResult(`✓ Servidor: ${ip}`, 'success');
  document.getElementById('qrScannerHint').textContent = 'Conectando…';
  lsSet('smashpad_ip', ip);
  setTimeout(() => {
    state.wsUrl = `ws://${ip}:8000`; updateServerAddress();
    closeQrScanner(); closeSettings();
    connectAs(getInitialPlayer() || state.selectedPlayer || 1);
  }, 900);
}

function setQrResult(text, type) {
  const el = document.getElementById('qrScannerResult'); if (!el) return;
  el.textContent = text; el.className = 'qr-scanner-result' + (type ? ` ${type}` : '');
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('qrScannerClose')?.addEventListener('click', closeQrScanner);
});

/* ═══════════════════════════════════════════════════════════════════════
   MÓDULO: SETTINGS PANEL
   ═══════════════════════════════════════════════════════════════════════ */

function initSettingsPanel() {
  document.getElementById('settingsCloseBtn')?.addEventListener('click', closeSettings);
  document.getElementById('settingsBackdrop')?.addEventListener('click', closeSettings);

  document.querySelectorAll('[data-settings-player]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const p = Number.parseInt(btn.dataset.settingsPlayer || '', 10); if (!p) return;
      if (state.connectedPlayer) { disconnect('switch'); connectAs(p); }
      else { state.selectedPlayer = p; applyPlayerTheme(p); syncSettingsPlayerButtons(p); }
      closeSettings();
    });
  });

  const vibToggle = document.getElementById('vibrationToggle');
  if (vibToggle) {
    vibToggle.setAttribute('aria-checked', state.vibrationEnabled ? 'true' : 'false');
    vibToggle.addEventListener('click', () => {
      state.vibrationEnabled = !state.vibrationEnabled;
      lsSet('smashpad_vibration', String(state.vibrationEnabled));
      vibToggle.setAttribute('aria-checked', state.vibrationEnabled ? 'true' : 'false');
      if (state.vibrationEnabled) triggerHaptic();
    });
  }

  const slider = document.getElementById('gyroSensSlider');
  if (slider) {
    slider.value = String(state.gyroSensLevel); updateGyroSensLabel();
    slider.addEventListener('input', () => {
      state.gyroSensLevel = Number(slider.value); lsSet('smashpad_gyro_sens', String(state.gyroSensLevel)); updateGyroSensLabel();
    });
  }

  document.getElementById('editLayoutBtn')?.addEventListener('click', () => { closeSettings(); setTimeout(enterEditMode, 300); });
  document.getElementById('rescanQrBtn')?.addEventListener('click', () => { closeSettings(); setTimeout(openQrScanner, 300); });
  document.getElementById('reconnectBtn')?.addEventListener('click', () => {
    closeSettings();
    if (state.wsUrl) { const p = state.connectedPlayer || state.selectedPlayer || 1; disconnect('manual'); setTimeout(() => connectAs(p), 300); }
    else { showSetup(); }
  });
  document.getElementById('changePlayerBtn')?.addEventListener('click', () => {
    closeSettings(); disconnect('manual'); disableGyro(); showSetup(); setStatus('Elige jugador.');
  });

  syncSettingsPlayerButtons(state.selectedPlayer);
}

function openSettings() {
  const overlay = document.getElementById('settingsOverlay'); if (!overlay) return;
  overlay.classList.add('open'); overlay.setAttribute('aria-hidden','false');
  syncSettingsPlayerButtons(state.connectedPlayer || state.selectedPlayer);
}

function closeSettings() {
  const overlay = document.getElementById('settingsOverlay'); if (!overlay) return;
  overlay.classList.remove('open'); overlay.setAttribute('aria-hidden','true');
}

function syncSettingsPlayerButtons(player) {
  document.querySelectorAll('[data-settings-player]').forEach((btn) => {
    btn.classList.toggle('active', Number.parseInt(btn.dataset.settingsPlayer || '',10) === player);
  });
}

function updateGyroSensLabel() {
  const labels = { 1:'Zona muerta: muy amplia', 2:'Zona muerta: amplia', 3:'Zona muerta: media', 4:'Zona muerta: pequeña', 5:'Zona muerta: mínima' };
  const el = document.getElementById('gyroSensLabel'); if (el) el.textContent = labels[state.gyroSensLevel] || labels[3];
}

/* ═══════════════════════════════════════════════════════════════════════
   MÓDULO: LAYOUT — Drag & Scale
   ═══════════════════════════════════════════════════════════════════════ */

function initLayout() {
  // Load saved layout or use defaults
  const saved = lsGet('smashpad_layout');
  state.layout = saved ? JSON.parse(saved) : getDefaultLayout();
  // Fill in any missing keys from defaults
  const defaults = getDefaultLayout();
  Object.keys(defaults).forEach(k => { if (!state.layout[k]) state.layout[k] = defaults[k]; });
  applyLayout();
}

function applyLayout() {
  const ctrl = document.getElementById('controller');
  if (!ctrl) return;

  Object.entries(state.layout).forEach(([id, pos]) => {
    const el = document.getElementById(id);
    if (!el) return;

    el.style.left      = `${pos.cx}%`;
    el.style.top       = `${pos.cy}%`;
    el.style.transform = `translate(-50%, -50%) scale(${pos.scale})`;

    // Shoulder row: keep full width, only vertical center matters
    if (id === 'shoulder-row') {
      el.style.left      = `${pos.cx}%`;
      el.style.top       = `${pos.cy}%`;
      el.style.transform = `translateX(-50%) translateY(-50%) scale(${pos.scale})`;
      el.style.width     = `calc(100% - var(--safe-left) - var(--safe-right) - 28px)`;
    }
  });
}

function saveLayout() {
  lsSet('smashpad_layout', JSON.stringify(state.layout));
}

function resetLayout() {
  state.layout = getDefaultLayout();
  applyLayout();
  saveLayout();
  if (state.editSelected) updateEditSizeBar(state.editSelected);
}

/* ─── Edit mode ──────────────────────────────────────────────────────── */

function enterEditMode() {
  state.editMode = true;
  state.editSelected = null;
  releaseAllInputs();

  const ctrl = document.getElementById('controller');
  ctrl.classList.add('edit-mode');

  document.getElementById('editBanner').hidden     = false;
  document.getElementById('editSizeBar').hidden    = true;
  document.getElementById('settingsGearBtn').style.display = 'none';

  // Bind drag on each unit
  Object.keys(state.layout).forEach(id => setupDrag(id));

  // Edit banner buttons
  document.getElementById('editResetBtn').onclick  = () => { resetLayout(); };
  document.getElementById('editDoneBtn').onclick   = () => exitEditMode();

  // Size bar buttons
  document.getElementById('sizeUpBtn').onclick   = () => adjustScale(+SCALE_STEP);
  document.getElementById('sizeDownBtn').onclick = () => adjustScale(-SCALE_STEP);
}

function exitEditMode() {
  state.editMode = false;
  saveLayout();

  const ctrl = document.getElementById('controller');
  ctrl.classList.remove('edit-mode');

  // Deselect
  if (state.editSelected) {
    document.getElementById(state.editSelected)?.classList.remove('edit-selected');
    state.editSelected = null;
  }

  document.getElementById('editBanner').hidden     = true;
  document.getElementById('editSizeBar').hidden    = true;
  document.getElementById('settingsGearBtn').style.display = '';

  // Remove drag listeners (re-bind on next enter)
  Object.keys(state.layout).forEach(id => removeDrag(id));
}

// Attach drag handlers to an element
const _dragHandlers = {};  // id → { down }

function setupDrag(id) {
  const el = document.getElementById(id); if (!el) return;

  let dragActive    = false;
  let dragPointerId = null;
  let startClientX  = 0;
  let startClientY  = 0;
  let startCx       = 0;
  let startCy       = 0;
  let moved         = false;

  const onDown = (e) => {
    if (!state.editMode) return;
    e.preventDefault();
    e.stopPropagation();

    dragActive    = true;
    dragPointerId = e.pointerId;
    moved         = false;
    startClientX  = e.clientX;
    startClientY  = e.clientY;
    startCx       = state.layout[id].cx;
    startCy       = state.layout[id].cy;

    el.setPointerCapture(e.pointerId);
  };

  const onMove = (e) => {
    if (!dragActive || e.pointerId !== dragPointerId) return;
    e.preventDefault();

    const ctrl  = document.getElementById('controller');
    const cRect = ctrl.getBoundingClientRect();

    const dx  = ((e.clientX - startClientX) / cRect.width)  * 100;
    const dy  = ((e.clientY - startClientY) / cRect.height) * 100;

    if (Math.abs(dx) > 0.3 || Math.abs(dy) > 0.3) moved = true;

    state.layout[id].cx = clamp(startCx + dx, 4, 96);
    state.layout[id].cy = clamp(startCy + dy, 4, 96);
    applyLayout();
  };

  const onUp = (e) => {
    if (!dragActive || e.pointerId !== dragPointerId) return;
    e.preventDefault();
    dragActive = false;

    // If didn't move much → select/deselect
    if (!moved) {
      toggleEditSelect(id);
    } else {
      // Just dragged: select it
      selectEditUnit(id);
    }
  };

  el.addEventListener('pointerdown', onDown, { passive: false });
  el.addEventListener('pointermove', onMove, { passive: false });
  el.addEventListener('pointerup',   onUp,   { passive: false });
  el.addEventListener('pointercancel', onUp, { passive: false });

  _dragHandlers[id] = { down: onDown, move: onMove, up: onUp };
}

function removeDrag(id) {
  const el = document.getElementById(id); if (!el) return;
  const h = _dragHandlers[id]; if (!h) return;
  el.removeEventListener('pointerdown', h.down);
  el.removeEventListener('pointermove', h.move);
  el.removeEventListener('pointerup',   h.up);
  el.removeEventListener('pointercancel', h.up);
  delete _dragHandlers[id];
}

function toggleEditSelect(id) {
  if (state.editSelected === id) {
    document.getElementById(id)?.classList.remove('edit-selected');
    state.editSelected = null;
    document.getElementById('editSizeBar').hidden = true;
  } else {
    selectEditUnit(id);
  }
}

function selectEditUnit(id) {
  if (state.editSelected && state.editSelected !== id) {
    document.getElementById(state.editSelected)?.classList.remove('edit-selected');
  }
  state.editSelected = id;
  document.getElementById(id)?.classList.add('edit-selected');
  updateEditSizeBar(id);
  document.getElementById('editSizeBar').hidden = false;
}

function updateEditSizeBar(id) {
  const scale = state.layout[id]?.scale ?? 1.0;
  document.getElementById('editSizeLabel').textContent = UNIT_LABELS[id] || id;
  document.getElementById('editSizeValue').textContent = `${Math.round(scale * 100)}%`;
}

function adjustScale(delta) {
  if (!state.editSelected) return;
  const pos   = state.layout[state.editSelected];
  pos.scale   = clamp(Math.round((pos.scale + delta) * 10) / 10, SCALE_MIN, SCALE_MAX);
  applyLayout();
  updateEditSizeBar(state.editSelected);
  triggerHaptic();
}

/* ═══════════════════════════════════════════════════════════════════════
   MÓDULO: UI HELPERS
   ═══════════════════════════════════════════════════════════════════════ */

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
  const g = document.getElementById('gyroBtn'), c = document.getElementById('gyroCenterBtn');
  if (!g || !c) return;
  g.textContent = state.gyroEnabled ? 'Gyro ON' : 'Gyro OFF';
  g.classList.toggle('mini-btn-active', state.gyroEnabled);
  c.disabled = !state.gyroEnabled; c.classList.toggle('mini-btn-disabled', !state.gyroEnabled);
}

function setGyroCopy(t) { const el = document.getElementById('gyroCopy'); if (el) el.textContent = t; }

function applyPlayerTheme(player) {
  const color = PLAYER_COLORS[player] || PLAYER_COLORS[1];
  document.documentElement.style.setProperty('--player-color', color);
  document.documentElement.style.setProperty('--player-glow',  `${color}66`);
  document.querySelectorAll('.player-card').forEach(c => {
    const sel = Number.parseInt(c.dataset.player || '',10) === player;
    c.classList.toggle('selected', sel); c.setAttribute('aria-checked', String(sel));
  });
}

function updateServerAddress() {
  const el = document.getElementById('serverAddress'); if (el) el.textContent = state.wsUrl || '--';
}

function showController() {
  document.getElementById('setup').style.display      = 'none';
  document.getElementById('controller').style.display = 'block';
  applyLayout(); // re-apply after display:block so getBoundingClientRect works
}

function showSetup() {
  if (state.editMode) exitEditMode();
  document.getElementById('controller').style.display = 'none';
  document.getElementById('setup').style.display      = 'flex';
}

function setStatus(t) { const el = document.getElementById('statusText'); if (el) el.textContent = t; }
function setSetupMessage(t) { const el = document.getElementById('setupCopy'); if (el) el.textContent = t; }

async function toggleFullscreen() {
  const root = document.documentElement;
  if (!document.fullscreenElement && root.requestFullscreen) { try { await root.requestFullscreen(); } catch {} }
  else if (document.fullscreenElement && document.exitFullscreen) { try { await document.exitFullscreen(); } catch {} }
}

/* ─── localStorage ───────────────────────────────────────────────────── */
function lsGet(k)    { try { return localStorage.getItem(k); }    catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); }        catch {} }
