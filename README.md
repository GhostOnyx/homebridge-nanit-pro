# homebridge-nanit-pro

A [Homebridge](https://homebridge.io) plugin that brings your **Nanit baby camera** into Apple HomeKit — viewable on iPhone, iPad, Apple TV, and Mac.

## Features

- **Live video streaming** — local (LAN) or cloud mode
- **Low latency** — uses [go2rtc](https://github.com/AlexxIT/go2rtc) as a relay for minimal lag
- **Temperature & humidity sensors** — shown as separate accessories in the Home app
- **HomeKit Secure Video (HKSV)** — activity zones, event recording (requires iCloud+ and a Home Hub)
- **Multi-viewer** — multiple devices can watch simultaneously
- **Homebridge v1 and v2** compatible

## Requirements

- [Homebridge](https://homebridge.io) v1.6.0 or later
- [ffmpeg](https://ffmpeg.org) with `libx264` and `libopus` support
- [go2rtc](https://github.com/AlexxIT/go2rtc) v1.9+ (strongly recommended for stable audio)
- A Nanit baby camera on your local network

## Installation

```bash
npm install -g homebridge-nanit-pro
```

Or search for **Nanit Pro** in the Homebridge UI (Config UI X).

## go2rtc Setup

go2rtc acts as a relay between the Nanit camera's RTMP push and HomeKit, providing stable audio and multi-viewer support.

1. Install go2rtc: https://github.com/AlexxIT/go2rtc#installation
2. Configure it (`/etc/go2rtc/go2rtc.yaml` or equivalent):

```yaml
api:
  listen: 127.0.0.1:1984

rtsp:
  listen: 127.0.0.1:8554

log:
  level: warn
```

3. Start go2rtc as a service and ensure it runs on boot.

> **Security note:** Bind the go2rtc API and RTSP to `127.0.0.1` so they are not accessible from other devices on your network.

## Configuration

Add to your Homebridge `config.json`:

```json
{
  "platform": "NanitCamera",
  "name": "Nanit Cameras",
  "email": "your@nanit-email.com",
  "refreshToken": "YOUR_REFRESH_TOKEN",
  "streamMode": "local"
}
```

### Getting a Refresh Token

Password login triggers an SMS code every time Homebridge restarts. Use a refresh token instead:

```bash
npx nanit-auth
```

Follow the prompts — it will output a `refreshToken` to paste into your config.

### All Config Options

| Option | Default | Description |
|--------|---------|-------------|
| `email` | — | Your Nanit account email **(required)** |
| `password` | — | Your Nanit password (use `refreshToken` instead) |
| `refreshToken` | — | Long-lived token from `npx nanit-auth` (recommended) |
| `streamMode` | `local` | `local` = LAN direct, `cloud` = via Nanit servers, `auto` = local with cloud fallback |
| `localAddress` | auto-detected | Override the Homebridge host IP (only needed if auto-detection picks the wrong interface) |
| `localRtmpPort` | `1935` | Port the plugin's RTMP server listens on |
| `go2rtcApiUrl` | `http://localhost:1984` | go2rtc REST API URL |
| `ffmpegPath` | `ffmpeg` | Path to the ffmpeg binary |
| `refreshInterval` | `300` | How often to refresh the camera list (seconds) |

## HomeKit Secure Video

To enable activity zones and event recording:

1. You need an **iCloud+** subscription
2. You need a **Home Hub** (Apple TV 4K, HomePod, or iPad set as Home Hub)
3. Open the Home app → tap the camera → **Camera Settings** → enable recording

## Streaming Architecture

```
Nanit Camera
    │ RTMP push (LAN)
    ▼
node-media-server (port 1935)
    │ go2rtc pulls via RTMP
    ▼
go2rtc relay
    │ RTSP (localhost only)
    ▼
ffmpeg → SRTP → HomeKit
```

Using go2rtc as a relay means:
- Stable audio (go2rtc normalises RTMP timestamps before RTSP delivery)
- Multiple HomeKit viewers share one camera connection
- go2rtc handles reconnection if the camera drops

## Troubleshooting

**Camera shows "No Response"**
- Check that the Nanit camera and Homebridge host are on the same LAN
- Set `localAddress` in config to the exact IP of your Homebridge host if auto-detection fails
- Check Homebridge logs for ffmpeg errors

**No audio / choppy audio**
- Ensure go2rtc is running (`systemctl status go2rtc`)
- Verify go2rtc API is reachable: `curl http://localhost:1984/api/streams`

**Token expired**
- Run `npx nanit-auth` to get a fresh refresh token and update your config

## Security

The following security measures are built into this plugin:

| Area | Detail |
|------|--------|
| **go2rtc API & RTSP** | Bound to `127.0.0.1` — not reachable from other devices on the network |
| **Access token never logged** | The Nanit access token is redacted in all log output |
| **No shell injection** | ffmpeg is launched via `child_process.spawn()` with an arguments array, never a shell string — user-controlled values cannot inject shell commands |
| **Refresh token preferred over password** | Using a refresh token means your Nanit password is never stored on disk. Password login is intentionally rate-limited to prevent MFA spam |
| **SRTP encrypted video** | All HomeKit video streams are encrypted end-to-end using SRTP (AES-CM-128-HMAC-SHA1-80) |
| **WSS signalling** | The WebSocket connection to Nanit's signalling server uses TLS (`wss://`) |
| **RTMP port 1935** | Must be accessible from the camera on your LAN (required for local streaming). It is not exposed to the internet — ensure your router does not forward this port |
| **Dependencies** | All dependencies (`node-media-server`, `ws`, `protobufjs`) are pinned to latest versions with no known CVEs. `protobufjs` v7.5.4 includes the fix for CVE-2023-36665 (Prototype Pollution) |

### Recommended go2rtc config (security hardened)

```yaml
api:
  listen: 127.0.0.1:1984   # localhost only — blocks external API access

rtsp:
  listen: 127.0.0.1:8554   # localhost only — blocks external RTSP access

log:
  level: warn
```

## License

MIT © [GhostOnyx](https://github.com/GhostOnyx)
