"""
server.py — SmashPad  |  WebSocket + HTTP en un solo proceso
=============================================================
Levanta dos servidores simultáneamente:
  · WebSocket en :8000  → recibe los inputs del mando
  · HTTP      en :3000  → sirve los archivos estáticos del controlador

Requisitos:
    pip install websockets pynput qrcode

Uso:
    python server.py

Al arrancar imprime la IP local, la URL y el QR en terminal.
"""

import asyncio
import json
import socket
import threading
import http.server
import socketserver
from pathlib import Path
from collections import defaultdict

import websockets
from pynput.keyboard import Controller, Key

# ─── Configuración ─────────────────────────────────────────────────────────────

WS_HOST   = "0.0.0.0"
WS_PORT   = 8000
HTTP_PORT = 3000

STATIC_DIR = Path(__file__).parent.resolve()

PLAYER_KEY_MAP: dict[int, dict[str, str | Key]] = {
    1: {
        "A": "z",  "B": "x",  "X": "c",  "Y": "v",
        "L": "a",  "R": "s",  "Z": "d",
        "START": Key.enter,
        "UP": Key.right, "DOWN": Key.left, "LEFT": Key.up, "RIGHT": Key.down,
    },
    2: {
        "A": "q",  "B": "w",  "X": "e",  "Y": "r",
        "L": "u",  "R": "j",  "Z": "k",
        "START": "y",
        "UP": "h", "DOWN": "f", "LEFT": "t", "RIGHT": "g",
    },
    3: {
        "A": "i",  "B": "l",  "X": "m",  "Y": ",",
        "L": "o",  "R": "p",  "Z": "[",
        "START": Key.f7,
        "UP": Key.f8, "DOWN": Key.f5, "LEFT": Key.f4, "RIGHT": Key.f6,
    },
    4: {
        "A": "1",  "B": "2",  "X": "3",  "Y": "4",
        "L": "5",  "R": "6",  "Z": "7",
        "START": "0",
        "UP": Key.end, "DOWN": Key.home, "LEFT": Key.page_up, "RIGHT": Key.page_down,
    },
}

keyboard    = Controller()
active_keys: dict[int, set] = defaultdict(set)


# ═══ WebSocket ════════════════════════════════════════════════════════════════

async def handle_connection(websocket) -> None:
    player_id: int | None = None
    try:
        async for raw in websocket:
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue

            if "player" in msg:
                player_id = int(msg["player"])
                await websocket.send(json.dumps({"status": "connected", "player": player_id}))
                print(f"  [+] Jugador {player_id} conectado")
                continue

            if player_id is None:
                continue

            button = msg.get("button")
            action = msg.get("action")
            if not button or not action:
                continue

            key = PLAYER_KEY_MAP.get(player_id, {}).get(button)
            if key:
                _apply_key(player_id, key, action)

    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        if player_id is not None:
            _release_all(player_id)
            print(f"  [-] Jugador {player_id} desconectado")


def _apply_key(player_id: int, key, action: str) -> None:
    pressed = active_keys[player_id]
    if action == "press" and key not in pressed:
        keyboard.press(key)
        pressed.add(key)
    elif action == "release" and key in pressed:
        keyboard.release(key)
        pressed.discard(key)


def _release_all(player_id: int) -> None:
    for key in list(active_keys[player_id]):
        try:
            keyboard.release(key)
        except Exception:
            pass
    active_keys[player_id].clear()


# ═══ HTTP (archivos estáticos) ════════════════════════════════════════════════

class _QuietHTTPHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC_DIR), **kwargs)
    def log_message(self, *_):
        pass


def _start_http_server() -> None:
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("0.0.0.0", HTTP_PORT), _QuietHTTPHandler) as httpd:
        httpd.serve_forever()


# ═══ QR en terminal ══════════════════════════════════════════════════════════

def _print_terminal_qr(url: str) -> None:
    try:
        import qrcode
        qr = qrcode.QRCode(border=1)
        qr.add_data(url)
        qr.make(fit=True)
        print()
        qr.print_ascii(invert=True)
        print()
    except ImportError:
        print("  (pip install qrcode  →  para ver QR en terminal)\n")


# ═══ Main ═════════════════════════════════════════════════════════════════════

def _detect_local_ip() -> str:
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.connect(("8.8.8.8", 80))
        return probe.getsockname()[0]
    except Exception:
        try:
            return socket.gethostbyname(socket.gethostname())
        except Exception:
            return "127.0.0.1"
    finally:
        probe.close()


async def main() -> None:
    local_ip = _detect_local_ip()

    controller_url = f"http://{local_ip}:{HTTP_PORT}"

    # HTTP en hilo separado
    threading.Thread(target=_start_http_server, daemon=True).start()

    print("\n" + "═" * 52)
    print("  SmashPad Server")
    print("═" * 52)
    print(f"  🌐 Controlador  →  {controller_url}")
    print(f"  📡 QR page      →  {controller_url}/pair.html")
    print(f"  🔌 WebSocket    →  ws://{local_ip}:{WS_PORT}")
    print("─" * 52)
    print("  Escanea el QR o comparte la URL con los jugadores.")
    print("═" * 52)

    _print_terminal_qr(controller_url)

    async with websockets.serve(handle_connection, WS_HOST, WS_PORT):
        print("  Esperando jugadores… (Ctrl+C para salir)\n")
        await asyncio.Future()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n  Servidor detenido.")
