# Changelog

## [1.1.9] - 2026-04-27

### Fixed
- **ffmpeg exits immediately with code 8 on ffmpeg 6.x**: The `-stimeout` option was removed in ffmpeg 6. Replaced with `-timeout`, which is the correct socket I/O timeout option for RTSP input in ffmpeg 6.
- **RTMP publisher race with go2rtc**: go2rtc registers a stream entry immediately when asked but only connects to the RTMP source lazily — when an RTSP consumer arrives. The previous approach of polling `_waitForGo2rtcStream` for tracks would always time out because no RTSP consumer existed yet. Fixed by waiting for node-media-server's `postPublish` event to confirm the camera is actually pushing RTMP *before* registering with go2rtc, then starting ffmpeg directly. go2rtc connects to the live RTMP stream immediately when ffmpeg opens the RTSP URL.

---

## [1.1.8] - 2026-04-26

### Fixed
- **Local stream stops immediately**: The go2rtc readiness poll was checking for `producers.length > 0`, but go2rtc adds a producer entry as soon as it starts trying to pull the RTMP URL — before the camera has actually connected and started pushing data. FFmpeg was starting against an empty RTSP stream and exiting immediately. Fixed by checking `producers[].tracks` instead, which go2rtc only populates once real video/audio data is flowing.
- FFmpeg process errors now log at error level (was debug-only) with a hint about missing binary.
- go2rtc poll now includes a 2s HTTP request timeout.
- go2rtc raw response is now logged at debug level to aid diagnosis.

---

## [1.1.7] - 2026-04-26

### Changed
- Minimum Node.js version updated to v20 (Node 18 reached end-of-life April 2025)
- Fixed `repository.url` field in package.json

---

## [1.1.6] - 2026-04-26

### Security
- Auth server now binds to `127.0.0.1` only — previously bound to `0.0.0.0`, exposing the Nanit login proxy to all devices on the LAN
- Auth server POST body capped at 10 KB to prevent memory exhaustion from oversized requests
- `-tls_verify 0` removed as a default ffmpeg flag; TLS certificate verification is now only skipped when `allowInsecureTls: true` is explicitly set in config

### Added
- `allowInsecureTls` config option (default `false`) — opt-in TLS verification bypass for cloud RTMPS streams, for users whose ffmpeg build cannot verify Nanit's certificate chain

---

## [1.1.5] - 2026-04-26

### Changed
- README: expanded troubleshooting section, documented `localAddress` use cases, full changelog history

---

## [1.1.4] - 2026-04-26

### Fixed
- **Local stream stops at ~28s**: Replaced the fixed 2500ms pre-FFmpeg wait with a go2rtc stream readiness poll — FFmpeg now starts only once go2rtc reports an active producer (camera is actually pushing RTMP), eliminating the race condition that caused HomeKit to time out waiting for frames
- **Cloud RTMPS "IO Error: -9806"**: Added `-tls_verify 0` and `-timeout 10000000` to cloud RTMPS inputs; the TLS handshake was failing on macOS due to certificate chain validation in the tessus FFmpeg build
- **FFmpeg output hidden**: Both streaming delegates now log all FFmpeg stderr at debug level (previously cloud mode filtered to lines containing "error"/"Error" only, making failures invisible)
- Added `-stimeout 10000000` to local RTSP input so FFmpeg reports a clear connection error immediately if go2rtc is not running, rather than hanging silently

---

## [1.1.3] - 2026-03-14

### Fixed
- `refreshAccessToken()` is now mutex-guarded — concurrent calls (e.g. auto-refresh firing during startup) share a single in-flight promise instead of issuing parallel token requests
- `allocateRtmpPort()` wraps at 100 ports above base (`localRtmpPort`) to prevent counter exceeding valid port range on long-running instances

---

## [1.1.2] - 2026-03-14

### Fixed
- Motion sensor service now initialized before camera controller so HKSV motion triggering works correctly
- Rotated refresh token (from `nanit-tokens.json`) now takes priority over the stale token in `config.json` on restart
- Snapshot FFmpeg process now killed after 10s if stream is unreachable, preventing hung requests
- Auth server can be disabled via `"authServer": false` in config (default: enabled on port 8586)

## [1.1.1] - 2026-03-14

### Fixed
- `nanit-auth` CLI no longer skips the MFA code prompt — readline was consuming keystrokes during raw-mode password entry, causing the MFA input to resolve immediately with an empty string. Fixed by pausing/resuming readline around the raw stdin section.

## [1.1.0] - Initial release
