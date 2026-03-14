# Changelog

## [1.1.1] - 2026-03-14

### Fixed
- `nanit-auth` CLI no longer skips the MFA code prompt — readline was consuming keystrokes during raw-mode password entry, causing the MFA input to resolve immediately with an empty string. Fixed by pausing/resuming readline around the raw stdin section.

## [1.1.0] - Initial release
