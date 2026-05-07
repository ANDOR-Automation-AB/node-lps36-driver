# Changelog

See [README](README.md) for full documentation.

## 1.0.3 — 2026-05-07

### Fixed

- **Unhandled rejection crash on `close()` with unawaited commands.** If a caller issued a
  command without awaiting the returned promise and `close()` was then called (e.g. during a
  stop→reconnect sequence), the pending promise was rejected with `Error: closed` but had no
  rejection handler, crashing the Node.js process with an unhandledRejection event.
  A noop `.catch(() => {})` is now attached to every command promise before it is returned.
  Callers that do `await` the promise still receive the rejection normally.

## 1.0.2 — 2026-04-29

### Changed

- **`getAllTaskParams` now accepts a `group` argument** (default `0x0002`, backwards-compatible).
  Wireshark analysis of LPSsoft "Export settings to sensor" revealed that command `0x0043`
  supports three group selectors:
  - `0x0001` — user parameters (same IDs as `PARAM.*`)
  - `0x0002` — inspection task parameters by internal sensor ID (1–21) — previous and default behaviour
  - `0x0004` — inspection task parameters by documented ID (`0x0BBx`, same IDs as `TASK_PARAM.*`)

## 1.0.1 — 2026-04-23

### Fixed

- **Concurrent same-command calls clobber each other** (`_pending` map). The internal
  `_pending` map was keyed on command code, so two simultaneous calls to the same command
  (e.g. two concurrent `getTaskParam` calls) would overwrite each other and the first
  caller would never receive a response. The map now holds a FIFO queue per command code
  so concurrent calls are resolved in the order the sensor responds to them.

## 1.0.0 — 2026-04-23

Initial release. Full implementation of the LPS 36 UDP/IP Ethernet protocol:

- Standard-Connect and HI-Connect (LPS 36HI/EN)
- Free-running measure mode with `z-data`, `x-data`, and `zx-data` events
- Software trigger (`ethernetTrigger`) and Ethernet activation (`ethernetActivation`)
- Command mode: trigger, get/set coordinates, inspection task parameters, user parameters
- Convenience wrappers: `setXOutput`, `setTxPause`, `setMedianFilter`
- Undocumented commands `getAllTaskParams` (0x0043) and `getDeviceInfo` (0x0045)
