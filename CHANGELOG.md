# Changelog

See [README](README.md) for full documentation.

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
