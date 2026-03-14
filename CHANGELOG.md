# Changelog

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
