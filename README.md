# homebridge-nanit-pro

A [Homebridge](https://homebridge.io) plugin that brings your **Nanit baby camera** into Apple HomeKit — viewable on iPhone, iPad, Apple TV, and Mac.

## Features

- **Live video streaming** — local (LAN), cloud, or auto mode (local with cloud fallback)
- **Audio** — full audio support in both local and cloud streaming modes
- **Low latency** — uses [go2rtc](https://github.com/AlexxIT/go2rtc) as a relay for minimal lag
- **Temperature & humidity sensors** — polled every 60 seconds, shown as separate accessories in the Home app
- **Motion detection** — triggers a HomeKit MotionSensor when the camera detects motion
- **HomeKit Secure Video (HKSV)** — activity zones, event recording (requires iCloud+ and a Home Hub)
- **Multi-viewer** — multiple devices can watch simultaneously
- **Homebridge v1 and v2** compatible

## Requirements

- [Homebridge](https://homebridge.io) v1.6.0 or later
- Node.js v20 or later
- [ffmpeg](https://ffmpeg.org) with `libx264` and `libopus` support
- [go2rtc](https://github.com/AlexxIT/go2rtc) v1.9+ (required for local mode; strongly recommended for stable audio)
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
| `refreshToken` | — | Long-lived token from `npx nanit-auth` **(recommended)** |
| `password` | — | Your Nanit password (only used once to obtain a refresh token via CLI) |
| `streamMode` | `local` | `local` = LAN direct, `cloud` = via Nanit servers, `auto` = local with automatic cloud fallback |
| `localAddress` | auto-detected | Override the Homebridge host IP sent to the camera for RTMP push. Set this if the camera cannot reach Homebridge or if streaming silently fails after connecting |
| `localRtmpPort` | `1935` | Port the plugin's RTMP server listens on |
| `go2rtcApiUrl` | `http://localhost:1984` | go2rtc REST API URL |
| `ffmpegPath` | `ffmpeg` | Path to the ffmpeg binary |
| `refreshInterval` | `300` | How often to refresh the camera list (seconds) |
| `sensorInterval` | `60` | How often to poll temperature & humidity (seconds) |
| `allowInsecureTls` | `false` | Disable TLS certificate verification for cloud RTMPS streams. Only enable if cloud streaming fails with a TLS error and switching to a properly built ffmpeg is not possible. See Security section. |

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

In `auto` mode, if the local stream cannot be established the plugin automatically falls back to cloud streaming — no manual intervention needed.

Using go2rtc as a relay means:
- Stable audio (go2rtc normalises RTMP timestamps before RTSP delivery)
- Multiple HomeKit viewers share one camera connection
- go2rtc handles reconnection if the camera drops

## Motion Detection

When the camera detects motion, the plugin triggers a **MotionSensor** accessory in HomeKit. The sensor automatically clears after 10 seconds.

To use motion as a HomeKit automation trigger, set up a Home automation on the MotionSensor accessory.

## Troubleshooting

**Camera shows "No Response"**
- Check that the Nanit camera and Homebridge host are on the same LAN
- Set `localAddress` in config to the exact LAN IP of your Homebridge host — auto-detection can pick the wrong interface (VPN, secondary adapter)
- Check Homebridge logs for ffmpeg errors (enable debug logging in the Homebridge UI)

**Stream starts then stops with no video**
- go2rtc must be running before streaming starts — verify with `curl http://localhost:1984/api/streams`
- The camera pushes RTMP to the IP reported as `Requesting camera push →` in the logs. If that IP is wrong, set `localAddress` to the correct LAN IP
- Confirm port 1935 is not blocked by a host firewall between the camera and Homebridge
- Ensure ffmpeg 6 or later is installed — ffmpeg 5 and earlier used `-stimeout` which was removed in ffmpeg 6

**Cloud stream fails with "IO Error: -9806" or TLS error**
- This is a TLS handshake failure between ffmpeg and Nanit's RTMPS server, commonly seen with the [tessus macOS ffmpeg build](https://evermeet.cx/ffmpeg/) on newer macOS versions
- First try a [Homebrew ffmpeg](https://formulae.brew.sh/formula/ffmpeg) build (`brew install ffmpeg`) and set `ffmpegPath` to `/opt/homebrew/bin/ffmpeg`
- If switching ffmpeg is not possible, enable `allowInsecureTls: true` in config as a last resort — note this disables certificate verification (see Security section)

**No audio / choppy audio**
- Ensure go2rtc is running (`systemctl status go2rtc`)
- Verify go2rtc API is reachable: `curl http://localhost:1984/api/streams`

**Streaming falls back to cloud unexpectedly**
- Check the camera's local IP is reachable from the Homebridge host: `ping <camera-ip>`
- Ensure port 1935 is not blocked by a firewall between the camera and Homebridge

**Token expired**
- Run `npx nanit-auth` to get a fresh refresh token and update your config

## Security

| Area | Detail |
|------|--------|
| **go2rtc API & RTSP** | Bound to `127.0.0.1` — not reachable from other devices on the network |
| **Auth server** | Bound to `127.0.0.1` — the token generation page is only reachable from the Homebridge host itself; access it via SSH tunnel or a local browser session |
| **`allowInsecureTls`** | Off by default. When enabled, ffmpeg skips TLS certificate verification for RTMPS connections — an on-path attacker could intercept the stream or steal the access token. Prefer switching to a properly compiled ffmpeg instead |
| **Access token never logged** | The Nanit access token is redacted in all log output |
| **No shell injection** | ffmpeg is launched via `child_process.spawn()` with an arguments array, never a shell string |
| **Refresh token preferred over password** | Using a refresh token means your Nanit password is never stored on disk. Password login is intentionally disabled in the plugin to prevent MFA spam |
| **SRTP encrypted video** | All HomeKit video streams are encrypted end-to-end using SRTP (AES-CM-128-HMAC-SHA1-80) |
| **WSS signalling** | The WebSocket connection to Nanit's signalling server uses TLS (`wss://`) |
| **Token persistence** | Refresh tokens are stored in Homebridge's own storage directory (`nanit-tokens.json`) — not in any external or internal HAP storage API |
| **Dependencies** | All dependencies (`node-media-server`, `ws`, `protobufjs`) are pinned to latest versions with no known CVEs |

## Changelog

### v1.1.10
- Security: updated `protobufjs` to 7.5.5 (critical arbitrary code execution — GHSA-xq3m-2v4x-88gg)
- Security: resolved high-severity `lodash` and `path-to-regexp` vulnerabilities in the `node-media-server` dependency tree

### v1.1.9
- Fixed immediate ffmpeg exit (code 8) on ffmpeg 6.x: `-stimeout` was removed in ffmpeg 6 and is now replaced with `-timeout`
- Fixed RTMP publisher race: plugin now waits for node-media-server to confirm the camera is pushing RTMP before registering the stream with go2rtc (go2rtc is lazy — it only connects to the RTMP source when an RTSP consumer arrives, so the previous track-readiness poll always timed out unnecessarily)

### v1.1.8
- Fixed local stream stopping immediately: go2rtc readiness check now waits for actual video/audio tracks instead of just a producer entry (go2rtc adds a producer as soon as it starts pulling the RTMP URL, before the camera is actually pushing data)
- ffmpeg process errors now log at error level with a hint if the binary is missing
- ffmpeg log now shows which RTSP URL it's connecting to
- go2rtc poll now includes a 2s HTTP timeout and debug-logs the raw response to aid diagnosis

### v1.1.7
- Minimum Node.js version updated to v20 (Node 18 is EOL)

### v1.1.6
- Security: auth server now binds to `127.0.0.1` only (was `0.0.0.0` — any LAN device could reach the Nanit login proxy)
- Security: auth server POST body capped at 10 KB to prevent memory exhaustion
- Security: `-tls_verify 0` is no longer applied by default; TLS certificate verification is now only disabled when `allowInsecureTls: true` is explicitly set in config
- Added `allowInsecureTls` config option (default `false`) for users whose ffmpeg build cannot verify Nanit's RTMPS certificate chain

### v1.1.5
- README: expanded troubleshooting section with guidance for the ~28s stream failure and macOS TLS error, documented `localAddress` use cases

### v1.1.4
- Fixed local stream stopping at ~28s: replaced the fixed pre-FFmpeg delay with a go2rtc stream readiness poll — FFmpeg now starts only once go2rtc confirms the camera is pushing RTMP
- Fixed cloud RTMPS "IO Error: -9806" TLS handshake failure on macOS (tessus ffmpeg build)
- Fixed FFmpeg output being hidden in cloud mode (stderr was filtered to error-only lines, making failures invisible in logs)
- FFmpeg now fails fast with a clear error if go2rtc is not running, instead of hanging silently

### v1.1.3
- Refresh token requests are now mutex-guarded to prevent parallel token refresh on startup

### v1.1.2
- Motion sensor initialised before camera controller (fixes HKSV motion triggering)
- Rotated refresh token now takes priority over stale config token on restart
- Snapshot FFmpeg process killed after 10s if stream is unreachable
- Auth server can be disabled via `"authServer": false` in config

### v1.1.1
- Fixed `nanit-auth` MFA prompt being skipped due to readline consuming keystrokes during raw stdin mode

### v1.1.0
- Added audio to cloud streaming mode
- Added motion detection (HomeKit MotionSensor)
- Added independent sensor polling every 60s (configurable via `sensorInterval`)
- `auto` mode now falls back to cloud if local stream fails
- Replaced internal `HAPStorage` API with file-based token storage
- Fixed hardcoded `hap-nodejs` internal import paths in recording delegate
- `nanit-auth` CLI is now properly registered as a bin command

### v1.0.0
- Initial release

## License

MIT © [GhostOnyx](https://github.com/GhostOnyx)
