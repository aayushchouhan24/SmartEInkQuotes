# E-Ink Anime Display

> AI-powered e-ink display that shows anime art and quotes, controlled wirelessly via Bluetooth.

An ESP32-powered 2.9" e-ink display that fetches AI-generated anime artwork and iconic anime quotes from a Node.js server. Configure everything wirelessly through a sleek Web Bluetooth control panel — no wires, no serial monitor needed.

## Features

- **AI-Generated Anime Art** — Pixazo Flux Schnell generates unique anime scenes (free, no credit card)
- **Anime Quotes** — AI picks iconic lines from Naruto, One Piece, Attack on Titan, Death Note, and more
- **Quote ↔ Image Sync** — Each image is derived from its paired quote, so they always match thematically
- **3 Display Modes** — AI Art + Quote, Quotes Only, or Custom Text
- **BLE Control Panel** — Configure Wi-Fi, switch modes, adjust refresh timing, send custom text — all from your browser
- **Always-On Bluetooth** — Reconfigure anytime without reflashing
- **Floyd-Steinberg Dithering** — Converts AI images to crisp 1-bit bitmaps optimized for e-ink
- **100% Free APIs** — Both Puter.com (text) and Pixazo (images) have free tiers with no credit card required

## Hardware

| Part | Details |
|------|---------|
| MCU | ESP32-S3 (or any ESP32 with BLE) |
| Display | Waveshare 2.9" e-ink (296×128), driver: GDEH029A1 / SSD1680 |
| Wiring | CS→10, DC→13, RST→14, BUSY→4, PWR→5 |


## Architecture

```
┌─────────────┐    Wi-Fi     ┌──────────────┐    HTTPS     ┌──────────────┐
│   ESP32 +   │ ──────────── │  Node.js     │ ──────────── │  Pixazo AI   │
│  2.9" E-Ink │   GET /image │  Server      │  Flux image  │  (free)      │
│             │   GET /quote │  :8787       │              └──────────────┘
└──────┬──────┘              │              │    HTTPS     ┌──────────────┐
       │ BLE                 │              │ ──────────── │  Puter.com   │
┌──────┴──────┐              │              │  GPT-4o-mini │  (free)      │
│  Browser    │ ─── HTTP ──→ │  /           │              └──────────────┘
│  Control    │              │  (panel)     │
│  Panel      │              └──────────────┘
└─────────────┘
```

## Quick Start

### 1. Server Setup

```bash
cd server
cp .env.example .env
# Edit .env — add your Puter auth token and Pixazo API key (both free)
npm install
node server.js
```

Get your free API keys:
- **Puter**: Sign up at [puter.com](https://puter.com), get token from developer settings
- **Pixazo**: Sign up at [pixazo.ai](https://www.pixazo.ai), get API key from dashboard

### 2. Flash the ESP32

1. Open `eink.ino` in Arduino IDE
2. Install libraries: **GxEPD2**, **Adafruit GFX**
3. Select your ESP32 board and port
4. Upload

### 3. Connect & Configure

1. Open `http://localhost:8787` in Chrome/Edge
2. Click **"Scan for Device"** → select `EInk-Display`
3. Enter your Wi-Fi credentials and server IP (e.g., `192.168.1.100:8787`)
4. Click **Save & Connect**

The display will immediately fetch its first anime artwork!

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /` | Web control panel (BLE + server controls) |
| `GET /image` | AI anime image → 1-bit bitmap (4736 bytes) |
| `GET /image?prompt=...` | Custom prompt → bitmap |
| `GET /quote` | Anime quote (synced with last image) |
| `GET /custom?text=...` | Render custom text → bitmap |
| `GET /preview` | Last served bitmap as PNG |
| `GET /health` | Server health check |

## Display Modes

| Mode | What it does |
|------|-------------|
| **AI Art** (0) | Generates paired anime quote + matching artwork |
| **Quotes** (1) | Full-screen anime quote rendered as text bitmap |
| **Custom** (2) | Shows your custom text message |

## BLE Commands

Send these via the Command characteristic from the control panel:

| Command | Action |
|---------|--------|
| `SAVE` | Save Wi-Fi credentials and reconnect |
| `REFRESH` | Force immediate display update |
| `MODE:0/1/2` | Switch display mode |
| `DELAY:ms` | Set refresh interval (milliseconds) |
| `CUSTOM:text` | Set custom display text |
| `STATUS` | Get device info (mode, delay, Wi-Fi, IP) |

## Control Panel

The web-based control panel has 4 tabs:

- **Setup** — Wi-Fi SSID, password, server address
- **Display** — Mode selection, refresh, status, live preview
- **Custom** — Custom text input, AI image prompt generator
- **Settings** — Refresh delay slider, server preview, device info

> **Note**: Web Bluetooth requires Chrome/Edge and either HTTPS or `localhost`. It does not work on Firefox or Safari.

## Project Structure

```
eink/
├── eink.ino              # ESP32 firmware (Arduino)
├── README.md
├── LICENSE
├── .gitignore
└── server/
    ├── server.js          # Node.js Express server
    ├── ble-config.html    # Web control panel
    ├── package.json
    ├── .env.example       # Config template
    └── .env               # Your config (git-ignored)
```

## How It Works

1. **Server generates a quote** — AI picks an iconic anime line via Puter (GPT-4o-mini)
2. **Server derives an image scene** — AI describes a dramatic visual scene matching the quote
3. **Pixazo renders the scene** — Flux Schnell generates a 512×512 image from the description
4. **Server dithers to 1-bit** — Floyd-Steinberg dithering converts to 296×128 packed bitmap
5. **ESP32 fetches & displays** — HTTP GET retrieves bitmap + paired quote, draws on e-ink
6. **Repeat** — Auto-refreshes every N seconds (configurable via BLE)

## Troubleshooting

| Problem | Fix |
|---------|-----|
| BLE "requestDevice" error | Open panel via `localhost:8787`, use Chrome/Edge |
| "Failed to fetch" on custom prompt | Server must be running; CORS is enabled |
| Display shows "No WiFi" | Re-enter credentials via BLE control panel |
| Images look too dark/light | Adjust dithering threshold in `server.js` (line ~112) |
| Pixazo 429 error | Rate limited — wait a minute and retry |

## Tech Stack

- **Firmware**: Arduino (C++) — ESP32, GxEPD2, BLE
- **Server**: Node.js, Express, Sharp (image processing)
- **AI Text**: Puter.com (GPT-4o-mini) — free tier
- **AI Images**: Pixazo (Flux 1 Schnell) — free tier
- **Control**: Web Bluetooth API, vanilla HTML/CSS/JS

## License

MIT — see [LICENSE](LICENSE)
