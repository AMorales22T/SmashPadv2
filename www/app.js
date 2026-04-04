const PLAYER_COLORS = {
  1: '#e74c3c',
  2: '#3498db',
  3: '#f1c40f',
  4: '#2ecc71'
};

const state = {
  socket: null,
  selectedPlayer: 1,
  connectedPlayer: null,
  wsUrl: null,             // se asigna tras conocer la IP
  activeButtons: new Set(),
  activeDirections: new Set(),
  joystickPointerId: null,
  joystickRadius: 0,
  gyroEnabled: false,
  gyroPermissionGranted: false,
  gyroNeutral: null,
  gyroLast: null
};

// ─── Detección de entorno ────────────────────────────────────────────────────

function isCapacitor() {
  return (
    window.Capacitor !== undefined ||
    window.location.protocol === 'capacitor:' ||
    window.location.hostname === 'localhost' && navigator.userAgent.includes('iPhone')
  );
}

function buildWsUrl(hostOverride) {
  const params = new URLSearchParams(window.location.search);
  const explicitHost = hostOverride || params.get('wsHost');
  const explicitPort = params.get('wsPort') || '8000';

  if (explicitHost) {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${protocol}://${explicitHost}:${explicitPort}`;
  }

  const host = window.location.hostname || '127.0.0.1';
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${host}:8000`;
}

function getSavedIp() {
  try { return localStorage.getItem('smashpad_ip') || ''; } catch { return ''; }
}

function saveIp(ip) {
  try { localStorage.setItem('smashpad_ip', ip); } catch { /* ignore */ }
}

// ─── Pantalla de IP (solo en modo Capacitor / app nativa) ───────────────────

function injectIpScreen() {
  const setup = document.getElementById('setup');
  if (!setup || document.getElementById('ipScreen')) return;

  const screen = document.createElement('div');
  screen.id = 'ipScreen';
  screen.style.cssText = `
    position:fixed;inset:0;z-index:999;
    display:flex;align-items:center;justify-content:center;
    background:rgba(6,6,14,0.97);
    font-family:'Share Tech Mono',monospace;
  `;

  screen.innerHTML = `
    <div style="
      width:min(90%,380px);
      padding:28px 24px;
      border:1px solid rgba(255,255,255,0.1);
      border-radius:22px;
      background:rgba(10,12,22,0.9);
      display:grid;gap:18px;text-align:center;
    ">
      <div style="font-family:'Orbitron',sans-serif;font-size:22px;color:#fff;">
        SMASH<span style="color:#e74c3c;">PAD</span>
      </div>
      <div style="font-size:12px;color:#7c8ba1;letter-spacing:.08em;">
        INTRODUCE LA IP DE TU PC
      </div>
      <input id="ipInput" type="text" inputmode="decimal"
        placeholder="192.168.1.X"
        value="${getSavedIp()}"
        style="
          padding:14px 16px;border-radius:12px;
          border:1px solid rgba(6,182,212,0.3);
          background:rgba(6,182,212,0.07);
          color:#d7fbff;font-size:18px;
          font-family:'Share Tech Mono',monospace;
          text-align:center;outline:none;width:100%;
        "
      >
      <p style="font-size:11px;color:#7c8ba1;line-height:1.5;">
        Ejecuta <code style="color:#06b6d4;">python server.py</code> en el PC.<br>
        La IP aparece en la terminal al arrancar.
      </p>
      <button id="ipConnectBtn" type="button" style="
        padding:14px;border-radius:999px;border:none;cursor:pointer;
        background:linear-gradient(180deg,#e74c3c,#c0392b);
        color:#fff;font-family:'Orbitron',sans-serif;font-size:14px;
        letter-spacing:.08em;
      ">CONECTAR</button>
      <div id="ipError" style="font-size:12px;color:#e74c3c;min-height:16px;"></div>
    </div>
  `;

  document.body.appendChild(screen);

  const input = document.getElementById('ipInput');
  const btn   = document.getElementById('ipConnectBtn');
  const err   = document.getElementById('ipError');

  const attempt = () => {
    const raw = input.value.trim();
    if (!raw) { err.textContent = 'Escribe la IP del PC.'; return; }

    const ip = raw.replace(/^wss?:\/\//, '').split(':')[0];
    saveIp(ip);
    state.wsUrl = buildWsUrl(ip);

    // Prueba la conexión antes de continuar
    err.textContent = 'Conectando…';
    btn.disabled = true;

    const probe = new WebSocket(state.wsUrl);
    const timeout = setTimeout(() => {
      probe.close();
      err.textContent = 'Sin respuesta. Revisa que server.py esté corriendo y la IP sea correcta.';
      btn.disabled = false;
    }, 4000);

    probe.addEventListener('open', () => {
      clearTimeout(timeout);
      probe.close();
      screen.remove();
      // Ahora arranca la app normalmente
      initApp();
    });

    probe.addEventListener('error', () => {
      clearTimeout(timeout);
      err.textContent = 'No se pudo conectar. Comprueba IP y red Wi-Fi.';
      btn.disabled = false;
    });
  };

  btn.addEventListener('click', attempt);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') attempt(); });
}

// ─── Init ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  bindController();
  applyPlayerTheme(1);

  if (isCapacitor()) {
    // En app nativa: pide IP primero
    injectIpScreen();
  } else {
    // En navegador normal: comportamiento original
    state.wsUrl = buildWsUrl();
    initApp();
  }
});

function initApp() {
  bindSetup();
  updateServerAddress();

  const initialPlayer = getInitialPlayer();
  if (initialPlayer) {
    connectAs(initialPlayer);
  } else {
    setSetupMessage('Toca tu jugador para conectarte automaticamente.');
  }
}

function getInitialPlayer() {
  const params = new URLSearchParams(window.location.search);
  const player = Number.parseInt(params.get('player') || '', 10);
  return Number.isInteger(player) && player >= 1 && player <= 4 ? player : null;
}

function bindSetup() {
  document.querySelectorAll('.player-card').forEach((card) => {
    card.addEventListener('click', () => {
      const player = Number.parseInt(card.dataset.player || '', 10);
      if (player) connectAs(player);
    });
  });
}

function bindController() {
  const gyroBtn       = document.getElementById('gyroBtn');
  const gyroCenterBtn = document.getElementById('gyroCenterBtn');
  const fullscreenBtn = document.getElementById('fullscreenBtn');
  const resetBtn      = document.getElementById('resetBtn');

  gyroBtn.addEventListener('click', toggleGyroMode);
  gyroCenterBtn.addEventListener('click', calibrateGyro);
  fullscreenBtn.addEventListener('click', toggleFullscreen);
  resetBtn.addEventListener('click', () => {
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

// ─── WebSocket ───────────────────────────────────────────────────────────────

function connectAs(player) {
  state.selectedPlayer = player;
  applyPlayerTheme(player);
  setStatus(`Conectando jugador ${player}...`);
  setSetupMessage(`Conectando P${player} con ${state.wsUrl}`);

  if (state.socket) disconnect('switch');

  let socket;
  try {
    socket = new WebSocket(state.wsUrl);
  } catch (error) {
    showSetup();
    setStatus('No se pudo abrir el WebSocket.');
    setSetupMessage('Fallo al crear la conexion. Revisa que el movil y el PC esten en la misma red.');
    return;
  }

  state.socket = socket;

  socket.addEventListener('open', () => {
    safeSend({ player });
  });

  socket.addEventListener('message', (event) => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }

    if (message.status === 'connected') {
      state.connectedPlayer = message.player;
      applyPlayerTheme(message.player);
      showController();
      setStatus(`Jugador ${message.player} conectado`);
      setSetupMessage(`P${message.player} conectado correctamente.`);
    }
  });

  socket.addEventListener('error', () => {
    if (state.socket !== socket) return;
    showSetup();
    setStatus('No se pudo conectar con el servidor.');
    setSetupMessage('El WebSocket no responde. Ejecuta server.py y usa la misma Wi-Fi.');
  });

  socket.addEventListener('close', () => {
    if (state.socket !== socket) return;
    state.socket = null;
    releaseAllInputs();
    if (state.connectedPlayer !== null) {
      showSetup();
      setStatus('Conexion cerrada');
      setSetupMessage('La conexion se ha perdido. Toca tu jugador para volver a entrar.');
    }
    state.connectedPlayer = null;
  });
}

function disconnect(reason) {
  releaseAllInputs();
  if (!state.socket) { state.connectedPlayer = null; return; }

  const socket = state.socket;
  state.socket = null;
  state.connectedPlayer = null;
  try { socket.close(1000, reason); } catch { /* ignore */ }
}

function safeSend(payload) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
  state.socket.send(JSON.stringify(payload));
}

// ─── Buttons & Joystick ──────────────────────────────────────────────────────

function bindButtonPad() {
  document.querySelectorAll('[data-btn]').forEach((button) => {
    if (button.id === 'joystick') return;
    const name = button.dataset.btn;
    if (!name) return;

    const press = (event) => {
      event.preventDefault();
      if (button.dataset.pressed === '1') return;
      button.dataset.pressed = '1';
      button.classList.add('pressed');
      state.activeButtons.add(name);
      safeSend({ button: name, action: 'press' });
    };

    const release = (event) => {
      if (event) event.preventDefault();
      if (button.dataset.pressed !== '1') return;
      button.dataset.pressed = '0';
      button.classList.remove('pressed');
      state.activeButtons.delete(name);
      safeSend({ button: name, action: 'release' });
    };

    button.addEventListener('pointerdown', press);
    button.addEventListener('pointerup',   release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('pointerleave', release);
  });
}

function bindJoystick() {
  const area   = document.getElementById('joystick');
  const handle = document.getElementById('stickHandle');
  if (!area || !handle) return;

  const resetStick = () => {
    state.joystickPointerId = null;
    updateStickHandle(0, 0);
    syncDirections(new Set());
  };

  const moveStick = (clientX, clientY) => {
    if (state.gyroEnabled) return;
    const rect    = area.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top  + rect.height / 2;
    const dx      = clientX - centerX;
    const dy      = clientY - centerY;
    const maxRadius = rect.width * 0.34;
    const distance  = Math.hypot(dx, dy);
    const clamped   = distance > maxRadius ? maxRadius / distance : 1;
    const limitedX  = dx * clamped;
    const limitedY  = dy * clamped;

    updateStickHandle(limitedX, limitedY);

    const nx = limitedX / maxRadius;
    const ny = limitedY / maxRadius;
    const nextDirections = new Set();
    const threshold = 0.35;

    if (nx >  threshold) nextDirections.add('RIGHT');
    if (nx < -threshold) nextDirections.add('LEFT');
    if (ny >  threshold) nextDirections.add('DOWN');
    if (ny < -threshold) nextDirections.add('UP');

    syncDirections(nextDirections);
  };

  area.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    state.joystickPointerId = event.pointerId;
    area.setPointerCapture(event.pointerId);
    moveStick(event.clientX, event.clientY);
  });

  area.addEventListener('pointermove', (event) => {
    if (state.joystickPointerId !== event.pointerId) return;
    event.preventDefault();
    moveStick(event.clientX, event.clientY);
  });

  const release = (event) => {
    if (state.joystickPointerId !== event.pointerId) return;
    event.preventDefault();
    resetStick();
  };

  area.addEventListener('pointerup',          release);
  area.addEventListener('pointercancel',      release);
  area.addEventListener('lostpointercapture', resetStick);
}

function syncDirections(nextDirections) {
  state.activeDirections.forEach((d) => {
    if (!nextDirections.has(d)) safeSend({ button: d, action: 'release' });
  });
  nextDirections.forEach((d) => {
    if (!state.activeDirections.has(d)) safeSend({ button: d, action: 'press' });
  });
  state.activeDirections = nextDirections;
}

// ─── Gyro ────────────────────────────────────────────────────────────────────

async function toggleGyroMode() {
  if (state.gyroEnabled) {
    disableGyro();
    setStatus(`Jugador ${state.connectedPlayer ?? state.selectedPlayer} conectado`);
    return;
  }

  const granted = await requestGyroPermission();
  if (!granted) {
    setStatus('Gyro bloqueado por el navegador.');
    setGyroCopy('iPhone necesita permiso de movimiento. Pulsa Gyro OFF otra vez y acepta el permiso.');
    return;
  }

  state.gyroEnabled = true;
  calibrateGyro();
  releaseAllInputs();
  setStatus('Gyro activo');
  setGyroCopy('Inclina el movil para mover. Usa "Centrar gyro" si se desvia.');
  updateGyroUi();
}

function disableGyro() {
  state.gyroEnabled  = false;
  state.gyroNeutral  = null;
  state.gyroLast     = null;
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
      const result = await DeviceOrientationEvent.requestPermission();
      state.gyroPermissionGranted = result === 'granted';
      return state.gyroPermissionGranted;
    } catch { return false; }
  }

  state.gyroPermissionGranted = true;
  return true;
}

function calibrateGyro() {
  if (!state.gyroLast) {
    setGyroCopy('Mueve un poco el movil y vuelve a pulsar "Centrar gyro".');
    return;
  }
  state.gyroNeutral = { ...state.gyroLast };
  if (state.gyroEnabled) {
    setStatus('Gyro centrado');
    setGyroCopy('Centro guardado. Ahora inclina el movil para mover.');
  }
}

function handleDeviceOrientation(event) {
  if (typeof event.beta !== 'number' || typeof event.gamma !== 'number') return;

  state.gyroLast = { beta: event.beta, gamma: event.gamma };
  if (!state.gyroEnabled) return;

  if (!state.gyroNeutral) state.gyroNeutral = { ...state.gyroLast };

  const rawX = clamp((event.gamma - state.gyroNeutral.gamma) / 18, -1, 1);
  const rawY = clamp((event.beta  - state.gyroNeutral.beta)  / 18, -1, 1);
  const nextDirections = new Set();
  const threshold = 0.24;

  if (rawX >  threshold) nextDirections.add('RIGHT');
  if (rawX < -threshold) nextDirections.add('LEFT');
  if (rawY >  threshold) nextDirections.add('DOWN');
  if (rawY < -threshold) nextDirections.add('UP');

  syncDirections(nextDirections);

  const area = document.getElementById('joystick');
  const maxRadius = area ? area.getBoundingClientRect().width * 0.34 : 0;
  updateStickHandle(rawX * maxRadius, rawY * maxRadius);
}

// ─── UI helpers ──────────────────────────────────────────────────────────────

function releaseAllInputs() {
  state.activeButtons.forEach((b) => safeSend({ button: b, action: 'release' }));
  state.activeButtons.clear();
  syncDirections(new Set());
  document.querySelectorAll('[data-btn]').forEach((b) => {
    b.classList.remove('pressed');
    b.dataset.pressed = '0';
  });
  updateStickHandle(0, 0);
}

function updateStickHandle(x, y) {
  const handle = document.getElementById('stickHandle');
  if (!handle) return;
  handle.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
}

function updateGyroUi() {
  const gyroBtn       = document.getElementById('gyroBtn');
  const gyroCenterBtn = document.getElementById('gyroCenterBtn');
  if (!gyroBtn || !gyroCenterBtn) return;
  gyroBtn.textContent = state.gyroEnabled ? 'Gyro ON' : 'Gyro OFF';
  gyroBtn.classList.toggle('mini-btn-active',   state.gyroEnabled);
  gyroCenterBtn.disabled = !state.gyroEnabled;
  gyroCenterBtn.classList.toggle('mini-btn-disabled', !state.gyroEnabled);
}

function setGyroCopy(text) {
  const copy = document.getElementById('gyroCopy');
  if (copy) copy.textContent = text;
}

function applyPlayerTheme(player) {
  const color = PLAYER_COLORS[player] || PLAYER_COLORS[1];
  const glow  = `${color}66`;
  document.documentElement.style.setProperty('--player-color', color);
  document.documentElement.style.setProperty('--player-glow',  glow);
  document.querySelectorAll('.player-card').forEach((card) => {
    const isSelected = Number.parseInt(card.dataset.player || '', 10) === player;
    card.classList.toggle('selected', isSelected);
    card.setAttribute('aria-checked', String(isSelected));
  });
}

function updateServerAddress() {
  const address = document.getElementById('serverAddress');
  if (!address) return;
  address.textContent = state.wsUrl ? state.wsUrl.replace(/^ws/, 'ws') : '--';
}

function showController() {
  document.getElementById('setup').style.display     = 'none';
  document.getElementById('controller').style.display = 'block';
}

function showSetup() {
  document.getElementById('controller').style.display = 'none';
  document.getElementById('setup').style.display      = 'flex';
}

function setStatus(text) {
  const label = document.getElementById('statusText');
  if (label) label.textContent = text;
}

function setSetupMessage(text) {
  const copy = document.getElementById('setupCopy');
  if (copy) copy.textContent = text;
}

async function toggleFullscreen() {
  const root = document.documentElement;
  if (!document.fullscreenElement && root.requestFullscreen) {
    try { await root.requestFullscreen(); } catch {
      setStatus('Pantalla completa no disponible en este navegador.');
    }
    return;
  }
  if (document.fullscreenElement && document.exitFullscreen) {
    try { await document.exitFullscreen(); } catch {
      setStatus('No se pudo salir de pantalla completa.');
    }
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
