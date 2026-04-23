# Node.js driver for Leuze LPS 36

A Node.js library for communicating with the Leuze LPS 36 (line profile sensor) over UDP/IP. Handles connection, protocol framing, and exposes a clean async API with no external dependencies.

|Required | |
|-|-|
| Node.js | 14 or later |
| Network | Leuze LPS 36 sensor reachable over UDP |
| Firewall | UDP ports 9008 (commands) and 5634 (measure data) open, and ICMP echo (ping) allowed |

### Installation

```
npm install ANDOR-Automation-AB/node-lps36-driver
```

```js
const LPS36 = require('node-lps36-driver');
const sensor = new LPS36({ host: '192.168.60.3' });
```

Constants (`PARAM`, `TASK_PARAM`, `CMD`, `RSP`) are static properties on the class:

```js
await sensor.setTaskParam(LPS36.TASK_PARAM.OPERATION_MODE, 1, true);
await sensor.setUserParam(LPS36.PARAM.MEDIAN_FILTER, 1);
```

### Running the test suite

`test.js` exercises every protocol command against a live sensor and reports a PASS, WARN or FAIL per step. The exit code is 0 when no steps have failed.

```
npm test
```

Two environment variables control the target:

| Variable | Default | Description |
|----------|---------|-------------|
| `LPS_HOST` | `192.168.60.3` | Sensor IP address |
| `LPS_TIMEOUT` | `3000` | Response timeout in milliseconds |

```
LPS_HOST=10.0.0.5 LPS_TIMEOUT=5000 npm test
```

#### Output format

Each step is printed as a block with a heading in brackets followed by a result line:

| Prefix | Counted as | Meaning |
|--------|-----------|---------|
| `PASS` | passed | Command acknowledged. Returned value printed as JSON. |
| `WARN` | warned | Command not supported on this sensor model. Not a failure. |
| `FAIL` | failed | Timeout or NACK. Exit code will be 1. |

Free-running stream events are logged with prefix `[stream]` (only the first two per phase are shown).

#### Test steps

The table below lists every test block, what it verifies, and the expected result by sensor model.

| Test step | Verifies | Standard LPS 36 | LPS 36HI/EN |
|-----------|----------|-----------------|-------------|
| open sockets | UDP socket bind | PASS | PASS |
| connect (Standard-Connect) | `CONNECT` (0x434E) | PASS | PASS |
| free-running measure mode | 2 s of streaming Z+X data at up to 100 Hz | PASS | PASS |
| enterCommandMode | `ENTER_CMD` (0x3132) | PASS | PASS |
| getInspectionTask | `GET_TASK` (0x0049) | PASS | PASS |
| setInspectionTask (temp) | `SET_TASK` (0x004B), save=false | PASS | PASS |
| setInspectionTask (persist) | `SET_TASK` (0x004B), save=true | PASS | PASS |
| getTaskParam TASK_NUMBER | `GET_TASK_PARAM` (0x006F), ID 0x0BB8 | PASS | PASS |
| getTaskParam TASK_NAME | `GET_TASK_PARAM`, ID 0x0BB9 — prints decoded name | PASS | PASS |
| getTaskParam OPERATION_MODE | `GET_TASK_PARAM`, ID 0x0BBA | PASS | PASS |
| getTaskParam ACTIVATION | `GET_TASK_PARAM`, ID 0x0BBB | PASS | PASS |
| getTaskParam CASCADE_OUTPUT | `GET_TASK_PARAM`, ID 0x0BBC | PASS | PASS |
| getTaskParam LIGHT_EXPOSURE | `GET_TASK_PARAM`, ID 0x0BBD | PASS | PASS |
| getTaskParam EXPOSURE_MANUAL | `GET_TASK_PARAM`, ID 0x0BBE | PASS | PASS |
| getTaskParam FOV_X | `GET_TASK_PARAM`, ID 0x0BBF — prints range in mm | PASS | PASS |
| getTaskParam FOV_Z | `GET_TASK_PARAM`, ID 0x0BC0 — prints range in mm | PASS | PASS |
| setTaskParam OPERATION_MODE (FreeRunning, temp) | `SET_TASK_PARAM` (0x006D), saves value 0 temporarily | PASS | PASS |
| setTaskParam OPERATION_MODE (restore, temp) | Restores original value temporarily | PASS | PASS |
| setTaskParam ACTIVATION (Disregard, temp) | Writes Disregard (0) temporarily | PASS | PASS |
| setTaskParam CASCADE_OUTPUT (Disable, temp) | Writes Disable (0) temporarily | PASS | PASS |
| setTaskParam LIGHT_EXPOSURE (Normal, temp) | Writes Normal (0) temporarily | PASS | PASS |
| setTaskParam FOV_X (restore, temp) | Restores previously read FOV X temporarily | PASS | PASS |
| setTaskParam FOV_Z (restore, temp) | Restores previously read FOV Z temporarily | PASS | PASS |
| getUserParam DISABLE_X_OUTPUT | `GET_USER_PARAM` (0x005B), ID 0x07D4 | PASS | PASS |
| getUserParam TX_PAUSE | `GET_USER_PARAM`, ID 0x07D8 — prints value in ms | PASS | PASS |
| getUserParam MEDIAN_FILTER | `GET_USER_PARAM`, ID 0x07DB | PASS | PASS |
| setXOutput(disable, temp) | `SET_USER_PARAM` via convenience wrapper | PASS | PASS |
| setXOutput(enable, temp) | Restores X output | PASS | PASS |
| setMedianFilter(on, temp) | Enables median filter temporarily | PASS | PASS |
| setMedianFilter(off, temp) | Disables median filter temporarily | PASS | PASS |
| setTxPause(5, temp) | Sets TX pause to 0.5 ms temporarily | PASS | PASS |
| setTxPause(0, temp) | Restores TX pause to default | PASS | PASS |
| setScanNumber(100) | `SET_SCAN_NUM` (0x0053) | PASS | PASS |
| setEncoderValue(0) | `SET_ENCODER` (0x0029), 32-bit value 0 | PASS | PASS |
| setEncoderValue(12345) | `SET_ENCODER`, 32-bit value 12345 | PASS | PASS |
| setEncoderValue(0) | Resets encoder to 0 | PASS | PASS |
| setLaserGate(off) | `SET_LASER` (0x0001), value 0 | PASS | PASS |
| setLaserGate(on) | `SET_LASER`, value 1 | PASS | PASS |
| triggerSingleMeasurement | `TRIGGER_SINGLE` (0x0003) + 30 ms settle | PASS | PASS |
| getZCoordinates | `GET_Z` (0x0013) — prints valid point count and Z range | PASS | PASS |
| getXCoordinates | `GET_X` (0x0011) — prints X range | PASS | PASS |
| getZXCoordinates (HI-Connect only) | `GET_ZX` (0x005F) | WARN | PASS |
| setTaskParam OPERATION_MODE (Input Triggered, temp) | Sets Input Triggered mode for the ethernetTrigger test | PASS | PASS |
| exitCommandMode | `EXIT_CMD` (0x3133) | PASS | PASS |
| ethernetTrigger | `ETH_TRIGGER` (0x4554) — sensor is now in Input Triggered mode, returns one triggered scan | PASS | PASS |
| enterCommandMode (activation setup) | Re-enters command mode to configure activation | PASS | PASS |
| setTaskParam ACTIVATION (Regard, temp) | Sets Activation Input = Regard for the ethernetActivation test | PASS | PASS |
| setTaskParam OPERATION_MODE (FreeRunning, temp) | Sets Free Running so that activation immediately produces a scan | PASS | PASS |
| exitCommandMode (activation setup) | Returns to measure mode | PASS | PASS |
| ethernetActivation(true) | `ETH_ACTIVATION` (0x4541), value 1 — sensor activates and returns first free-running scan | PASS | PASS |
| ethernetActivation(false, deactivate) | `ETH_ACTIVATION`, value 0 — sensor deactivates, no response per spec (fire-and-forget) | PASS | PASS |
| enterCommandMode (restore) | Re-enters command mode to restore original settings | PASS | PASS |
| setTaskParam ACTIVATION (restore, temp) | Restores original Activation Input setting | PASS | PASS |
| setTaskParam OPERATION_MODE (restore, temp) | Restores original Operation Mode | PASS | PASS |
| getAllTaskParams (undocumented 0x0043) | Undocumented bulk read of all task params. WARN if not supported. | PASS or WARN | PASS or WARN |
| getDeviceInfo (undocumented 0x0045) | Undocumented `GET_DEVICE_INFO` — prints firmware and serial strings. WARN if not supported. | PASS or WARN | PASS or WARN |
| exitCommandMode (restore) | Returns to measure mode | PASS | PASS |
| disconnect | `DISCONNECT` (0x4443) | PASS | PASS |
| connect (HI-Connect) | `CONNECT` with user data word 0x0001 — standard model falls back to Standard-Connect | PASS | PASS |
| HI-Connect free-running | 1 s of streaming data — ZX packets on HI model, Z+X pairs on standard | PASS | PASS |
| enterCommandMode (HI) | Same as standard enterCommandMode | PASS | PASS |
| triggerSingleMeasurement (HI) | Same as standard triggerSingleMeasurement | PASS | PASS |
| getZXCoordinates (HI) | `GET_ZX` in HI command mode | WARN | PASS |
| exitCommandMode (HI) | Same as standard exitCommandMode | PASS | PASS |
| disconnect (HI) | Same as standard disconnect | PASS | PASS |

#### Expected summary by model

| Sensor model | passed | warned | failed | Exit code |
|--------------|--------|--------|--------|-----------|
| LPS 36 (standard), getDeviceInfo supported | 63 | 2 | 0 | 0 |
| LPS 36 (standard), getDeviceInfo not supported | 62 | 3 | 0 | 0 |
| LPS 36HI/EN, getDeviceInfo supported | 65 | 0 | 0 | 0 |
| LPS 36HI/EN, getDeviceInfo not supported | 64 | 1 | 0 | 0 |
| Sensor unreachable | 0 | 0 | 1 | 1 |

#### Notes on specific steps

`ethernetTrigger` is tested with OPERATION_MODE temporarily set to Input Triggered (1). The test sets this mode, calls the trigger, then restores the original mode. If the sensor was already in Input Triggered mode the result is the same.

`ethernetActivation(true)` is tested with ACTIVATION temporarily set to Regard (1) and OPERATION_MODE set to Free Running (0) so that activation immediately produces a scan without an additional software trigger.

`ethernetActivation(false, deactivate)` sends the deactivation command but does not wait for a response. The LPS 36 protocol specification states that the sensor sends no response in the deactivated state, so the call is fire-and-forget. The PASS line confirms the UDP packet was transmitted.

The `connected` field in the status object returned by `connect()` reflects the sensor state at the moment the ACK was generated, before the connection flag is updated internally by the sensor firmware. The value `false` immediately after a successful connect is normal and expected.

### Quick start

#### Free-running measure mode (100 Hz streaming)

Each Z and X event carries a `scanNo`. Z and X events with the same `scanNo` belong to the same physical scan. Z values are unsigned, unit 1/10 mm, range 0–8100. X values are signed, unit 1/10 mm.

```js
const LPS36 = require('./lps36');

const sensor = new LPS36({ host: '192.168.60.3' });

sensor.on('z-data', ({ scanNo, z }) => {
  console.log('Z scan', scanNo, z[0]);
});

sensor.on('x-data', ({ scanNo, x }) => {
  console.log('X scan', scanNo, x[0]);
});

sensor.on('error', (err) => console.error(err));

await sensor.open();
await sensor.connect();
```

The sensor now streams Z+X data continuously at up to 100 Hz.

#### Software trigger in measure mode

Switch the sensor to Input Triggered mode first — this persists across restarts. Then call `ethernetTrigger()` for each scan.

```js
const LPS36 = require('./lps36');
const sensor = new LPS36({ host: '192.168.60.3' });

await sensor.open();
await sensor.connect();

await sensor.enterCommandMode();
await sensor.setTaskParam(LPS36.TASK_PARAM.OPERATION_MODE, 1, true);
await sensor.exitCommandMode();

const { scanNo, z, x } = await sensor.ethernetTrigger();
console.log('scan', scanNo, 'z0=', z[0], 'x0=', x[0]);

await sensor.disconnect();
sensor.close();
```

#### Command mode — single triggered measurement

`triggerSingleMeasurement()` includes the required 30 ms settling delay internally. Call `getZCoordinates` and `getXCoordinates` immediately after.

```js
await sensor.open();
await sensor.connect();
await sensor.enterCommandMode();

await sensor.triggerSingleMeasurement();

const z = await sensor.getZCoordinates();
const x = await sensor.getXCoordinates();

await sensor.exitCommandMode();
await sensor.disconnect();
sensor.close();
```

### Protocol overview

The LPS 36 communicates over UDP/IP using a proprietary binary protocol. All multi-byte integers are transmitted in **little-endian** byte order.

#### Modes

| Mode | Description |
|------|-------------|
| Measure mode | Sensor streams or triggers measurement data. Only a small subset of commands are accepted. |
| Command mode | Sensor accepts configuration and query commands. No measurement data is streamed. |
| Menu mode | Sensor display is being operated by hand. No commands are processed. Exits automatically after 3 minutes of inactivity. |
| Error mode | Sensor has detected an error. |

#### Packet structure

Every packet (both directions) consists of a fixed 30-byte header followed by optional user data words.

| Byte offset | Length | Field | Notes |
|-------------|--------|-------|-------|
| 0–1 | 2 | Start sequence 1 | Fixed: `0xFFFF` |
| 2–3 | 2 | Start sequence 2 | Fixed: `0xFFFF` |
| 4–5 | 2 | Fill | Fixed: `0x0000` |
| 6–7 | 2 | Command number | See command tables below |
| 8–9 | 2 | Fill | Fixed: `0x0000` |
| 10–11 | 2 | Packet number | Internal sensor use |
| 12–13 | 2 | Fill | Fixed: `0x0000` |
| 14–15 | 2 | Transaction number | Used to match command responses |
| 16–17 | 2 | Status | Sensor state flags (see Status section) |
| 18–19 | 2 | Encoder high word | 0 if no encoder input |
| 20–21 | 2 | Encoder low word | 0 if no encoder input |
| 22–23 | 2 | Fill | Fixed: `0x0000` |
| 24–25 | 2 | Scan number | Increments after each measurement, wraps at 0xFFFF |
| 26–27 | 2 | Type | Fixed: `0x0010` (16-bit data) |
| 28–29 | 2 | User data words | Number of 16-bit words following the header |
| 30+ | variable | User data | Command parameters or measurement values |

#### Transaction number

The sensor echoes the **command number** of the incoming packet back in the transaction number field of its response (per section 10.2.3 of the LPS 36 protocol spec). This driver uses that echoed command number to match responses to their pending Promises. All outgoing commands are sent with transaction number `0x0000`.

In **measure mode**, measurement data packets (`0x5A5A`, `0x5858`, `0x5A58`) carry transaction number `0x0000`; they are dispatched as events rather than matched to pending commands.

#### Status word

The 16-bit status field (bytes 16–17) contains two bytes.

Byte at offset 16 carries mode and connection state:

| Bits | Meaning |
|------|---------|
| `[3:0]` bit 0 | `1` = sensor connected via Ethernet |
| `[7:4]` nibble | `0x1` = measure mode, `0x2` = menu mode, `0x4` = command mode, `0x8` = error mode |

Byte at offset 17 carries operational flags:

| Bit | Meaning |
|-----|---------|
| 0 | `1` = measurement activated (via activation source) |
| 1 | `1` = warning, temporary sensor malfunction |
| 2 | `1` = triggered measure mode (vs. free running) |
| 3 | `1` = configuration memory connected |
| 5 | `1` = error detected |

`parseStatus(rawUint16)` returns a plain object with named boolean fields.

#### Measurement data (measure mode)

In Standard-Connect mode, each measurement produces two consecutive UDP packets with the same `scanNo`:

| Command number | Content | Values | Unit |
|----------------|---------|--------|------|
| `0x5A5A` | Z coordinates | 376 unsigned 16-bit values | 1/10 mm, range 0–8100 |
| `0x5858` | X coordinates | 376 signed 16-bit values | 1/10 mm |

X values are transmitted as unsigned 16-bit two's-complement. Values above 32767 are negative: actual value = raw value − 65536. This driver applies the conversion automatically.

When an LPS 36HI/EN is used in Standard-Connect mode (for backwards compatibility), measurement points 241–376 are always 0.

In HI-Connect mode (LPS 36HI/EN only), Z and X are combined in a single packet:

| Command number | Content | Values | Unit |
|----------------|---------|--------|------|
| `0x5A58` | Z + X combined | 480 values (Z: 0–239, X: 240–479) | 1/100 mm, Z range 0–61000, X range −7000 to 7000 |

Invalid measurement points (occlusion, low reflectivity, out of detection range) have Z=0 and X=0.

### API reference

#### Constructor

```js
new LPS36(options)
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `host` | string | `'192.168.60.3'` | Sensor IP address |
| `cmdPort` | number | `9008` | UDP port for commands |
| `dataPort` | number | `5634` | UDP port to listen on for measure data |
| `timeout` | number | `2000` | Response timeout in milliseconds |

#### Lifecycle

##### `sensor.open()` — `Promise<void>`

Opens two UDP sockets: one on an ephemeral port for sending commands and receiving responses, and one bound to `dataPort` for receiving free-running measure data. Must be called before any other method.

##### `sensor.close()` — `void`

Closes both sockets immediately. Any pending command Promises are rejected with `Error('closed')`.

#### Elementary commands

These commands are accepted in both measure mode and command mode.

##### `sensor.connect(hiConnect?)` — `Promise<statusObject>`

Establishes a logical connection to the sensor. Returns a parsed status object (see `parseStatus`).

`hiConnect` (boolean, default `false`): pass `true` to use HI-Connect mode (LPS 36HI/EN only). HI-Connect combines Z and X into a single packet at 1/100 mm resolution instead of two packets at 1/10 mm.

Throws if the sensor responds with NACK (already connected or in menu mode).

##### `sensor.disconnect()` — `Promise<void>`

Terminates the logical connection. Throws on NACK.

##### `sensor.enterCommandMode()` — `Promise<void>`

Switches the sensor to command mode. The sensor stops streaming measurement data. Throws on NACK (sensor may be in menu mode or already in command mode).

##### `sensor.exitCommandMode()` — `Promise<void>`

Returns the sensor to measure mode. Throws on NACK (sensor was not in command mode).

#### Measure mode commands

These commands are only processed when the sensor is in measure mode and connected.

##### `sensor.ethernetTrigger()` — `Promise<scanResult>`

Sends a software trigger. Equivalent to a rising edge on the hardware trigger input. Requires Operation Mode = Input Triggered, set via `setTaskParam(LPS36.TASK_PARAM.OPERATION_MODE, 1)`.

Returns a `scanResult` object. Field contents differ between connection types:

| Field | Standard-Connect | HI-Connect |
|-------|-----------------|------------|
| `scanNo` | Scan counter, 0–65535, wraps | Same |
| `z` | 376 unsigned values, unit 1/10 mm | 240 unsigned values, unit 1/100 mm |
| `x` | 376 signed values, unit 1/10 mm | 240 signed values, unit 1/100 mm |

In HI-Connect mode the single combined `0x5A58` packet is used. Throws on timeout.

##### `sensor.ethernetActivation(active)` — `Promise<scanResult>`

Activates (`true`) or deactivates (`false`) measurement via Ethernet. Requires Activation Input Mode set to Regard in LPSsoft. Returns the same `scanResult` shape as `ethernetTrigger` when active.

#### Command mode commands

These commands require the sensor to be in command mode (`enterCommandMode` called first).

##### `sensor.setLaserGate(on)` — `Promise<void>`

Turns the laser on (`true`) or off (`false`). Throws on NACK.

##### `sensor.triggerSingleMeasurement()` — `Promise<void>`

Triggers one measurement via software. Includes the required 30 ms settling delay internally, so `getZCoordinates` and `getXCoordinates` can be called immediately after. Throws on NACK.

##### `sensor.getXCoordinates()` — `Promise<number[]>`

Returns X coordinates from the last triggered measurement. 376 signed values in 1/10 mm (or 1/100 mm if connected with HI-Connect). Throws on NACK.

##### `sensor.getZCoordinates()` — `Promise<number[]>`

Returns Z coordinates from the last triggered measurement. 376 unsigned values in 1/10 mm (or 1/100 mm if HI-Connect). Throws on NACK.

##### `sensor.getZXCoordinates()` — `Promise<{ z: number[], x: number[] }>`

HI-Connect / command mode only (`CMD.GET_ZX`, `0x005F`). Returns Z (240 values) and X (240 signed values) in a single call. Throws on NACK.

> **Note:** The protocol spec command table lists the response as 376 user data words, but the accompanying description and actual sensor behaviour give 480 words (240 Z + 240 X). This driver uses 480.

##### `sensor.setEncoderValue(value)` — `Promise<void>`

Sets the encoder counter to `value` (32-bit unsigned). Only available on sensor models with encoder input. Throws on NACK.

##### `sensor.setInspectionTask(taskNum, save?)` — `Promise<void>`

Activates inspection task `taskNum` (0–15). `save = true` persists the change after a sensor restart. Throws on NACK.

##### `sensor.getInspectionTask()` — `Promise<number>`

Returns the currently active inspection task number (0–15). Throws on NACK.

##### `sensor.setScanNumber(scanNo)` — `Promise<void>`

Sets the scan counter to `scanNo` (0–65535). Used to synchronise scan numbers across multiple cascaded sensors. See the cascaded multi-sensor sync recipe for the required sequence. Throws on NACK.

##### `sensor.setUserParam(paramId, value, save?)` — `Promise<void>`

Writes a global sensor parameter. Use `LPS36.PARAM.*` constants for `paramId`. `save = true` persists after restart. Applies to all inspection tasks. Throws on NACK.

##### `sensor.getUserParam(paramId)` — `Promise<number>`

Reads a global sensor parameter. Returns the 16-bit parameter value. Throws on NACK.

##### `sensor.setTaskParam(paramId, values, save?)` — `Promise<void>`

Writes one or more parameters of the active inspection task. Use `LPS36.TASK_PARAM.*` constants for `paramId`. `values` is a single number or an array of numbers (each a 16-bit word). `save = true` persists after restart. Throws on NACK.

Switch to Input Triggered mode permanently:

```js
await sensor.setTaskParam(LPS36.TASK_PARAM.OPERATION_MODE, 1, true);
```

Set X field of view to −50 to +50 mm (values in 1/10 mm):

```js
await sensor.setTaskParam(LPS36.TASK_PARAM.FOV_X, [-500, 500], false);
```

##### `sensor.getTaskParam(paramId)` — `Promise<{ paramId, dataType, values }>`

Reads a parameter of the active inspection task. The `dataType` field encodes the value format: 1 = UINT8, 2 = UINT16, 5 = SINT16, 7 = CHAR. For CHAR type, each entry in `values` is the UTF-16 code point of one character — reconstruct the string with `String.fromCharCode(...result.values)`. Throws on NACK.

#### Undocumented commands

> **Warning:** The following commands are **not described in the public LPS 36 Ethernet protocol specification**. They were reverse-engineered from network traffic captured while operating LPSsoft. They may change or disappear in future sensor firmware without notice. Do not rely on them in production code without independent verification against your specific firmware version.

##### `sensor.getDeviceInfo()` — `Promise<{ raw: number[], info: string }>`

Sends undocumented command `0x0045` (arg `0x0011`) and reads response `0x0046`. Returns:

| Field | Type | Description |
|-------|------|-------------|
| `raw` | `number[]` | All response payload words as unsigned 16-bit integers — for diagnostics or future parsing |
| `firmware` | `string` | Firmware version string (e.g. `"V01.525011132401"`) |
| `serial` | `string` | Article / serial number string (e.g. `"546003261O005"`) |

The payload layout is inferred from a single Wireshark capture of LPSsoft "Check Connectivity":

| Words | Content |
|-------|---------|
| 0–10 | Numerical device properties (meaning unknown) |
| 11 | Character count of the firmware string |
| 12 + fwLen | Firmware UTF-16LE chars (one char per word, ASCII range) |
| Immediately after | Article/serial chars until first non-ASCII word |

##### `sensor.getAllTaskParams()` — `Promise<entry[]>`

Sends undocumented command `0x0043` (arg `0x0002`) and reads response `0x0044`. Returns all inspection task parameters in one round-trip instead of one `getTaskParam` call per ID.

Each entry in the returned array:

| Field | Type | Description |
|-------|------|-------------|
| `paramId` | `number` | Internal sensor parameter ID — see observed mapping below |
| `dataType` | `number` | 1=UINT8, 2=UINT16, 3=UINT32(?), 5=SINT16, 7=CHAR |
| `valCount` | `number` | Total value count for this parameter; bulk caps at 2 returned |
| `limitLo` | `number` | Lower allowed value — only meaningful when `valCount === 1` |
| `values` | `number[]` | `[current]` for scalar params (`valCount === 1`); `[min, max]` for range params (`valCount ≥ 2`) |
| `persist` | `number` | `1` = value saved to flash (observed always `1`) |
| `raw` | `number[]` | Raw 8 words for this entry |

Entry layout (inferred from live capture on firmware V01.525011132401):

```
word 0 : paramId
word 1 : dataType
word 2 : valCount
word 3 : padding (always 0)
word 4 : limitLo  (scalar, valCount=1)  OR  value[0] / range min  (valCount ≥ 2)
word 5 : padding (0 for most types; non-zero for type-3 entries — see notes)
word 6 : current value  (scalar)        OR  value[1] / range max  (valCount ≥ 2)
word 7 : persist flag (always 1)
```

#### Observed parameter mapping

Parameters returned by `getAllTaskParams` use an internal numbering that differs from the user-facing `TASK_PARAM.*` IDs used by `getTaskParam`/`setTaskParam`. The following mapping was established from live capture on an LPS 36 (firmware V01.525011132401):

| Internal paramId | dataType | Identified as | Notes |
|------------------|----------|---------------|-------|
| `0x0001` | SINT16 | **FOV_X** (`TASK_PARAM.FOV_X`) | `values = [minX, maxX]` in 1/10 mm, signed |
| `0x0002` | UINT16 | **FOV_Z** (`TASK_PARAM.FOV_Z`) | `values = [minZ, maxZ]` in 1/10 mm |
| `0x0003` | 3 | Unknown — possibly 32-bit range | `word5` is non-zero (see notes) |
| `0x0004` | 3 | Unknown — possibly 32-bit range | `word5` is non-zero (see notes) |
| `0x0005` | UINT16 | Unknown scalar | |
| `0x0006` | UINT16 | Unknown scalar | `limitLo=1` |
| `0x0007` | CHAR | Unknown string (6 chars) | `values=[0,255]` is char range, not content |
| `0x0008` | CHAR | Unknown string (8 chars) | `values=[0,255]` is char range, not content |
| `0x0009` | CHAR | Unknown string (15 chars) | `values=[0,255]` is char range, not content |
| `0x0013` | UINT16 | **EXPOSURE_MANUAL** (`TASK_PARAM.EXPOSURE_MANUAL`) | `limitLo=973`, range 973–13109 matches spec |
| `0x0014` | UINT16 | Unknown scalar | `limitLo=10` |
| `0x0015` | UINT16 | Unknown scalar | `limitLo=41` |

#### Notes on getAllTaskParams

**CHAR-type parameters** (`dataType=7`, paramIds 7–9): the bulk response cannot return multi-character string content in two words. The `values` field will always be `[0, 255]`, which is the allowed character range, not the current string. Use `getTaskParam` with the corresponding `TASK_PARAM.*` ID to read string content.

**Type-3 parameters** (paramIds 3 and 4): `word5` in the raw entry is non-zero (`65534` and `15` respectively), which breaks the normal 8-word layout where word 5 is always `0`. These parameters may use a 32-bit value format where `[word4, word5]` and `[word6, word7]` each encode one 32-bit value. The current decoder treats them the same as other `valCount ≥ 2` params and returns `[word4, word6]` — the result may be incorrect for these entries.

**Internal IDs vs. TASK_PARAM IDs**: `getAllTaskParams` returns parameters using the sensor's internal ID scheme (1–21 in observed data). These bear no relation to the `0x0BB8`–`0x0BC0` IDs used by `getTaskParam`/`setTaskParam`. There is currently no known complete mapping between the two.

Throws if the sensor does not respond within `timeout` ms.

#### Convenience wrappers

##### `sensor.setXOutput(enable, save?)` — `Promise<void>`

Enables or disables the transmission of X coordinates in measure mode. When disabled, only Z packets (`0x5A5A`) are sent, halving network traffic. If X output is disabled, 2D/3D views in LPSsoft will not work — re-enable with `setXOutput(true)` or factory reset. Wraps `setUserParam(LPS36.PARAM.DISABLE_X_OUTPUT, ...)`.

##### `sensor.setTxPause(steps, save?)` — `Promise<void>`

Sets the transmission pause between Z and X data packets. `steps` is 0–9 in units of 0.1 ms (factory default: 0, i.e. 0.1 ms). Increase when the receiver has a slow or small Ethernet buffer. Wraps `setUserParam(LPS36.PARAM.TX_PAUSE, ...)`.

##### `sensor.setMedianFilter(enable, save?)` — `Promise<void>`

Enables or disables the median filter for Z coordinates. The filter smooths Z values while preserving edges, suppressing small interference and structures. Wraps `setUserParam(LPS36.PARAM.MEDIAN_FILTER, ...)`.

##### `sensor.parseStatus(raw)` — `statusObject`

Parses a raw 16-bit status word. Returns a plain object with fields `connected`, `mode` (`'measure'` | `'menu'` | `'command'` | `'error'` | `'unknown'`), `activated`, `warning`, `triggered`, `configMemory`, and `error`.

#### Events

The `LPS36` instance is an `EventEmitter`. Register listeners before calling `connect`.

##### `'z-data'`

Emitted for every received Z measurement packet (`0x5A5A`) in measure mode, both free-running and triggered. The payload contains `scanNo` (number, 0–65535 wrapping), `status` (raw uint16 — pass to `parseStatus()` if needed), and `z` (376 unsigned values, 1/10 mm).

```js
sensor.on('z-data', ({ scanNo, status, z }) => { ... });
```

##### `'x-data'`

Emitted for every received X measurement packet (`0x5858`). The `scanNo` matches the preceding `z-data` event for the same physical scan. The payload contains `scanNo`, `status`, and `x` (376 signed values, 1/10 mm).

```js
sensor.on('x-data', ({ scanNo, status, x }) => { ... });
```

##### `'zx-data'`

Emitted for HI-Connect combined packets (`0x5A58`). Carries both Z (240 unsigned values, 1/100 mm) and X (240 signed values, 1/100 mm) from a single UDP packet.

```js
sensor.on('zx-data', ({ scanNo, status, z, x }) => { ... });
```

##### `'error'`

Emitted on socket errors. Attach a listener to prevent Node.js from throwing unhandled errors.

```js
sensor.on('error', (err) => console.error('sensor error:', err));
```

#### Exported constants

##### `CMD` — command numbers (control to sensor)

| Key | Value | Description |
|-----|-------|-------------|
| `CONNECT` | `0x434E` | Connect to sensor |
| `DISCONNECT` | `0x4443` | Disconnect from sensor |
| `ENTER_CMD` | `0x3132` | Enter command mode |
| `EXIT_CMD` | `0x3133` | Exit command mode |
| `SET_LASER` | `0x0001` | Set laser gate on/off |
| `TRIGGER_SINGLE` | `0x0003` | Trigger single measurement (command mode) |
| `GET_X` | `0x0011` | Get X coordinates (command mode) |
| `GET_Z` | `0x0013` | Get Z coordinates (command mode) |
| `GET_ZX` | `0x005F` | Get ZX coordinates (HI-Connect, command mode) |
| `SET_ENCODER` | `0x0029` | Set encoder counter value |
| `SET_TASK` | `0x004B` | Set active inspection task |
| `GET_TASK` | `0x0049` | Get active inspection task number |
| `SET_SCAN_NUM` | `0x0053` | Set scan number |
| `SET_USER_PARAM` | `0x0059` | Write global user parameter |
| `GET_USER_PARAM` | `0x005B` | Read global user parameter |
| `SET_TASK_PARAM` | `0x006D` | Write inspection task parameter |
| `GET_TASK_PARAM` | `0x006F` | Read inspection task parameter |
| `ETH_TRIGGER` | `0x4554` | Software trigger (measure mode) |
| `ETH_ACTIVATION` | `0x4541` | Ethernet activation on/off (measure mode) |
| `GET_ALL_TASK_PARAMS` ⚠ | `0x0043` | **Undocumented.** Bulk read all task params (arg = `0x0002`) |
| `GET_DEVICE_INFO` ⚠ | `0x0045` | **Undocumented.** Firmware version + serial (arg = `0x0011`) |

##### `RSP` — response command numbers (sensor to control)

| Key | Value | Description |
|-----|-------|-------------|
| `ACK` | `0x4141` | Command executed successfully |
| `NACK` | `0x414E` | Command not executed |
| `Z_DATA` | `0x5A5A` | Measure mode Z packet |
| `X_DATA` | `0x5858` | Measure mode X packet |
| `ZX_DATA` | `0x5A58` | Measure mode ZX packet (HI-Connect) |
| `X_COORDS` | `0x0012` | Command mode GET_X response |
| `Z_COORDS` | `0x0014` | Command mode GET_Z response |
| `ZX_COORDS` | `0x0060` | Command mode GET_ZX response |
| `TASK_NUM` | `0x004A` | GET_TASK response |
| `USER_PARAM` | `0x005C` | GET_USER_PARAM response |
| `TASK_PARAM` | `0x0070` | GET_TASK_PARAM response |
| `ALL_TASK_PARAMS` ⚠ | `0x0044` | **Undocumented.** Response to GET_ALL_TASK_PARAMS |
| `DEVICE_INFO` ⚠ | `0x0046` | **Undocumented.** Response to GET_DEVICE_INFO |

##### `PARAM` — user parameter IDs (for `setUserParam` / `getUserParam`)

| Key | Value | Description |
|-----|-------|-------------|
| `DISABLE_X_OUTPUT` | `0x07D4` | Enable/disable X output in measure mode. `0` = both Z and X sent, `1` = only Z sent. |
| `TX_PAUSE` | `0x07D8` | Pause between Z and X packets. Steps 0–9, unit 0.1 ms. |
| `MEDIAN_FILTER` | `0x07DB` | Median filter for Z. `0` = off, `1` = on. |

##### `TASK_PARAM` — inspection task parameter IDs (for `setTaskParam` / `getTaskParam`)

| Key | Value | Description |
|-----|-------|-------------|
| `TASK_NUMBER` | `0x0BB8` | Read-only: number of the active task (0–15) |
| `TASK_NAME` | `0x0BB9` | Name string, max 12 ASCII characters (each stored as 16-bit word) |
| `OPERATION_MODE` | `0x0BBA` | `0` = Free Running, `1` = Input Triggered |
| `ACTIVATION` | `0x0BBB` | `0` = Disregard (always on), `1` = Regard activation input |
| `CASCADE_OUTPUT` | `0x0BBC` | `0` = Disable cascading, `1` = Enable |
| `LIGHT_EXPOSURE` | `0x0BBD` | `0`=Normal (~261 µs), `1`=Bright (~97 µs), `2`=Dark (~655 µs), `3`=Normal to Bright (~328 µs), `4`=Manual |
| `EXPOSURE_MANUAL` | `0x0BBE` | Manual exposure time in 1/10 µs. LPS36HI/EN: 739–13109, LPS36: 973–13109. The sensor sets exposure incrementally — actual exposure may deviate slightly from the value written. Read back with `getTaskParam` to get the value the sensor actually applied. |
| `FOV_X` | `0x0BBF` | X detection range: two signed 16-bit values [minX, maxX] in 1/10 mm |
| `FOV_Z` | `0x0BC0` | Z detection range: two unsigned 16-bit values [minZ, maxZ] in 1/10 mm |

### Common recipes

#### Read one scan in triggered mode

`scan.z[i]` and `scan.x[i]` correspond to the same measurement point. Divide by 10 to convert to mm.

```js
const sensor = new LPS36({ host: '192.168.60.3' });
await sensor.open();
await sensor.connect();

const scan = await sensor.ethernetTrigger();

await sensor.disconnect();
sensor.close();
```

#### Continuous acquisition with scan pairing

In free-running mode, Z and X packets arrive as separate events. Match them by `scanNo`:

```js
const scans = new Map();

sensor.on('z-data', ({ scanNo, z }) => {
  scans.set(scanNo, { z });
});

sensor.on('x-data', ({ scanNo, x }) => {
  const scan = scans.get(scanNo);
  if (scan) {
    scans.delete(scanNo);
    processScan(scanNo, scan.z, x);
  }
});
```

#### Command mode — configure and measure

```js
await sensor.open();
await sensor.connect();
await sensor.enterCommandMode();

await sensor.setInspectionTask(2, false);

await sensor.triggerSingleMeasurement();
const z = await sensor.getZCoordinates();
const x = await sensor.getXCoordinates();

await sensor.exitCommandMode();
await sensor.disconnect();
sensor.close();
```

#### Cascaded multi-sensor scan number sync

Exit slaves first, then master. Command mode disables cascading output, so the sequence matters.

```js
await sensor1.enterCommandMode();
await sensor1.setScanNumber(0);

await sensor2.enterCommandMode();
await sensor2.setScanNumber(0);

await sensor3.enterCommandMode();
await sensor3.setScanNumber(0);

await sensor2.exitCommandMode();
await sensor3.exitCommandMode();
await sensor1.exitCommandMode();
```

#### HI-Connect (LPS 36HI/EN)

Pass `true` to `connect()`. Data arrives as `zx-data` events at 1/100 mm resolution instead of separate Z and X events.

```js
await sensor.open();
const status = await sensor.connect(true);

sensor.on('zx-data', ({ scanNo, z, x }) => {
  console.log(scanNo, z[0], x[0]);
});
```

### Error handling

All async methods throw an `Error` in these cases:

| Cause | Error message example |
|-------|-----------------------|
| Sensor responds with NACK (`0x414E`) | `'Enter command mode NACK'` |
| No response within `timeout` ms | `'0x3132 timeout'` |
| Socket closed while waiting | `'closed'` |

```js
try {
  await sensor.enterCommandMode();
} catch (err) {
  console.error('Failed:', err.message);
}
```

Socket errors are emitted on the `'error'` event, not thrown.

### Notes on byte order

The LPS 36 protocol documentation presents command numbers in big-endian notation (e.g. `0x434E` for Connect). The wire format is **little-endian**: the low byte is transmitted first. This means `0x434E` is sent as the byte sequence `[0x4E, 0x43]`. This driver handles the conversion automatically using `Buffer.writeUInt16LE` and `Buffer.readUInt16LE` throughout.

If the sensor does not respond to commands even though communication works in LPSsoft, the most likely cause is a byte order mismatch. Verify with a packet capture that the bytes arrive in little-endian order.

### Exported functions

In addition to the `LPS36` class and constant objects, the module exports two low-level functions for use in custom packet handling:

| Function | Returns | Description |
|----------|---------|-------------|
| `buildPacket(cmd, txNum, userWords)` | `Buffer` | Complete protocol packet |
| `parseStatus(rawUint16)` | `object` | Raw status word as named boolean fields |
