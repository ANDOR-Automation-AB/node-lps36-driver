'use strict';

const dgram = require('dgram');
const EventEmitter = require('events');

const HEADER_SIZE = 30;

// Commands (control to sensor), little-endian on wire
const CMD = {
  CONNECT:        0x434E,
  DISCONNECT:     0x4443,
  ENTER_CMD:      0x3132,
  EXIT_CMD:       0x3133,
  SET_LASER:      0x0001,
  TRIGGER_SINGLE: 0x0003,
  GET_X:          0x0011,
  GET_Z:          0x0013,
  GET_ZX:         0x005F,  // HI-Connect only
  SET_ENCODER:    0x0029,
  SET_TASK:       0x004B,
  GET_TASK:       0x0049,
  SET_SCAN_NUM:   0x0053,
  SET_USER_PARAM: 0x0059,
  GET_USER_PARAM: 0x005B,
  SET_TASK_PARAM: 0x006D,
  GET_TASK_PARAM: 0x006F,
  ETH_TRIGGER:    0x4554,
  ETH_ACTIVATION: 0x4541,
  // ⚠ Undocumented — observed in LPSsoft Wireshark capture, not in public spec:
  GET_ALL_TASK_PARAMS: 0x0043,  // bulk read all task params; arg = 0x0002
  GET_DEVICE_INFO:     0x0045,  // firmware version + serial; arg = 0x0011
};

// Responses (sensor to control)
const RSP = {
  ACK:        0x4141,
  NACK:       0x414E,
  Z_DATA:     0x5A5A,  // measure mode Z packet
  X_DATA:     0x5858,  // measure mode X packet
  ZX_DATA:    0x5A58,  // measure mode ZX packet (HI-Connect)
  X_COORDS:   0x0012,  // command mode GET_X response
  Z_COORDS:   0x0014,  // command mode GET_Z response
  ZX_COORDS:  0x0060,  // command mode GET_ZX response
  TASK_NUM:   0x004A,
  USER_PARAM: 0x005C,
  TASK_PARAM: 0x0070,
  // ⚠ Undocumented — observed in LPSsoft Wireshark capture, not in public spec:
  ALL_TASK_PARAMS: 0x0044,
  DEVICE_INFO:     0x0046,
};

// Set/Get User Parameter IDs (cmd 0x0059 / 0x005B)
const PARAM = {
  DISABLE_X_OUTPUT: 0x07D4,
  TX_PAUSE:         0x07D8,
  MEDIAN_FILTER:    0x07DB,
};

// Set/Get Inspection Task Parameter IDs (cmd 0x006D / 0x006F)
const TASK_PARAM = {
  TASK_NUMBER:     0x0BB8,
  TASK_NAME:       0x0BB9,
  OPERATION_MODE:  0x0BBA,  // 0=FreeRunning, 1=InputTriggered
  ACTIVATION:      0x0BBB,  // 0=Disregard, 1=Regard
  CASCADE_OUTPUT:  0x0BBC,  // 0=Disable, 1=Enable
  LIGHT_EXPOSURE:  0x0BBD,  // 0=Normal,1=Bright,2=Dark,3=NormalToBright,4=Manual
  EXPOSURE_MANUAL: 0x0BBE,
  FOV_X:           0x0BBF,
  FOV_Z:           0x0BC0,
};

// ─────────────────────────────────────────────
// Packet builder
// ─────────────────────────────────────────────

function buildPacket(cmd, txNum, userWords = []) {
  const buf = Buffer.alloc(HEADER_SIZE + userWords.length * 2, 0);
  buf.writeUInt16LE(0xFFFF, 0);            // start seq 1
  buf.writeUInt16LE(0xFFFF, 2);            // start seq 2
  // bytes 4-5: fill 0x0000
  buf.writeUInt16LE(cmd, 6);              // command number
  // bytes 8-13: fill 0x0000
  buf.writeUInt16LE(txNum, 14);           // transaction number
  // bytes 16-23: fill 0x0000
  // bytes 24-25: scan no 0x0000
  buf.writeUInt16LE(0x0010, 26);          // type (fixed)
  buf.writeUInt16LE(userWords.length, 28); // user data words
  for (let i = 0; i < userWords.length; i++) {
    buf.writeUInt16LE(userWords[i] & 0xFFFF, HEADER_SIZE + i * 2);
  }
  return buf;
}

function parseHeader(buf) {
  return {
    cmd:      buf.readUInt16LE(6),
    txNum:    buf.readUInt16LE(14),
    status:   buf.readUInt16LE(16),
    encoderH: buf.readUInt16LE(18),
    encoderL: buf.readUInt16LE(20),
    scanNo:   buf.readUInt16LE(24),
    udataLen: buf.readUInt16LE(28),
  };
}

// Status word: little-endian, byte 16 = connection/mode, byte 17 = operational flags
// Bit layout per LPS36 manual section 10.2.4
function parseStatus(raw) {
  const b0 = raw & 0xFF;         // byte at offset 16: connection + mode nibble
  const b1 = (raw >> 8) & 0xFF;  // byte at offset 17: activation / warning / error
  return {
    connected:    !!(b0 & 0x01),
    mode:         (b0 & 0xF0) === 0x10 ? 'measure' :
                  (b0 & 0xF0) === 0x20 ? 'menu' :
                  (b0 & 0xF0) === 0x40 ? 'command' :
                  (b0 & 0xF0) === 0x80 ? 'error' : 'unknown',
    activated:    !!(b1 & 0x01),
    warning:      !!(b1 & 0x02),
    triggered:    !!(b1 & 0x04),
    configMemory: !!(b1 & 0x08),
    error:        !!(b1 & 0x20),
  };
}

// ─────────────────────────────────────────────
// LPS36 client
// ─────────────────────────────────────────────

class LPS36 extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string} opts.host       Sensor IP, default '192.168.60.3'
   * @param {number} opts.cmdPort    Command port, default 9008
   * @param {number} opts.dataPort   Measure data listen port, default 5634
   * @param {number} opts.timeout    Response timeout ms, default 2000
   */
  constructor({ host = '192.168.60.3', cmdPort = 9008, dataPort = 5634, timeout = 2000 } = {}) {
    super();
    this.host = host;
    this.cmdPort = cmdPort;
    this.dataPort = dataPort;
    this.timeout = timeout;
    this._pending = new Map(); // cmd code → queue of { resolve, reject, timer }
    this._cmdSock = null;
    this._dataSock = null;
  }

  // Open UDP sockets. Call before any commands.
  async open() {
    this._cmdSock  = await this._bindSocket(0);               // ephemeral port for commands
    this._dataSock = await this._bindSocket(this.dataPort);   // receive measure data
  }

  // Close sockets and cancel pending requests.
  close() {
    for (const sock of [this._cmdSock, this._dataSock]) {
      if (sock) try { sock.close(); } catch (_) {}
    }
    this._cmdSock = null;
    this._dataSock = null;
    for (const queue of this._pending.values()) {
      for (const { reject, timer } of queue) {
        clearTimeout(timer);
        reject(new Error('closed'));
      }
    }
    this._pending.clear();
  }

  // ── Internal helpers ─────────────────────────────

  _bindSocket(port) {
    return new Promise((resolve, reject) => {
      const s = dgram.createSocket('udp4');
      s.on('message', (msg) => this._onMessage(msg));
      // Temporary error handler during bind — rejects the promise and cleans up the socket.
      // Replaced with the permanent handler once bind succeeds.
      s.once('error', (err) => {
        try { s.close(); } catch (_) {}
        reject(err);
      });
      s.bind(port, () => {
        s.removeAllListeners('error');
        s.on('error', (err) => this.emit('error', err));
        resolve(s);
      });
    });
  }

  _send(buf) {
    return new Promise((resolve, reject) => {
      this._cmdSock.send(buf, 0, buf.length, this.cmdPort, this.host,
        (err) => err ? reject(err) : resolve());
    });
  }

  async _sendCmd(cmd, userWords = []) {
    const buf = buildPacket(cmd, 0, userWords);

    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const q = this._pending.get(cmd);
        if (q) {
          const i = q.findIndex(x => x.timer === timer);
          if (i !== -1) q.splice(i, 1);
          if (!q.length) this._pending.delete(cmd);
        }
        reject(new Error(`0x${cmd.toString(16).padStart(4, '0')} timeout`));
      }, this.timeout);
      const q = this._pending.get(cmd) ?? [];
      q.push({ resolve, reject, timer });
      this._pending.set(cmd, q);
    });

    await this._send(buf);
    return promise;
  }

  _onMessage(msg) {
    if (msg.length < HEADER_SIZE) return;
    if (msg.readUInt16LE(0) !== 0xFFFF || msg.readUInt16LE(2) !== 0xFFFF) return;

    const hdr = parseHeader(msg);
    const userdata = msg.slice(HEADER_SIZE, HEADER_SIZE + hdr.udataLen * 2);

    // Measure data: emit as events (free-running + triggered)
    if (hdr.cmd === RSP.Z_DATA || hdr.cmd === RSP.X_DATA || hdr.cmd === RSP.ZX_DATA) {
      this._emitMeasureData(hdr, userdata);
      return;
    }

    // Response txNum = echoed cmd code of the incoming packet (protocol spec 10.2.3).
    // Each cmd code maps to a FIFO queue so concurrent calls of the same command
    // are resolved in the order the sensor processes them.
    const q = this._pending.get(hdr.txNum);
    if (q?.length) {
      const p = q.shift();
      if (!q.length) this._pending.delete(hdr.txNum);
      clearTimeout(p.timer);
      p.resolve({ hdr, userdata });
    }
  }

  _emitMeasureData(hdr, userdata) {
    if (hdr.cmd === RSP.Z_DATA) {
      const z = readUInt16Array(userdata, hdr.udataLen);
      this.emit('z-data', { scanNo: hdr.scanNo, status: hdr.status, z });

    } else if (hdr.cmd === RSP.X_DATA) {
      const x = readSignedArray(userdata, hdr.udataLen);
      this.emit('x-data', { scanNo: hdr.scanNo, status: hdr.status, x });

    } else {
      // ZX_DATA (HI-Connect): words 0-239 = Z, 240-479 = X (signed)
      const zLen = Math.min(240, hdr.udataLen);
      const xLen = Math.max(0, hdr.udataLen - 240);
      const z = readUInt16Array(userdata, zLen, 0);
      const x = readSignedArray(userdata, xLen, 240 * 2);
      this.emit('zx-data', { scanNo: hdr.scanNo, status: hdr.status, z, x });
    }
  }

  // Wait for next scan after sending an ETH_TRIGGER / ETH_ACTIVATION command.
  // Handles both Standard-Connect (Z + X packets) and HI-Connect (ZX packet).
  _waitForScan(cmd, userWords) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const xListeners = [];

      const done = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.off('z-data',  onZ);
        this.off('zx-data', onZX);
        for (const fn of xListeners) this.off('x-data', fn);
        if (result instanceof Error) reject(result);
        else resolve(result);
      };

      const timer = setTimeout(
        () => done(new Error(`0x${cmd.toString(16).padStart(4, '0')} scan timeout`)),
        this.timeout
      );

      const onZX = (data) => done(data);

      const onZ = (zData) => {
        const onX = (xData) => {
          if (xData.scanNo === zData.scanNo) {
            done({ scanNo: zData.scanNo, z: zData.z, x: xData.x });
          }
        };
        xListeners.push(onX);
        this.on('x-data', onX);
      };

      this.on('z-data',  onZ);
      this.on('zx-data', onZX);

      const buf = buildPacket(cmd, 0, userWords);
      this._send(buf).catch(done);
    });
  }

  // ── Public API ───────────────────────────────────

  // Elementary commands (work in both modes)

  /** Connect to sensor. Returns parsed status object. */
  async connect(hiConnect = false) {
    // Clear any stale server-side connection before establishing a new one
    try { await this._sendCmd(CMD.DISCONNECT); } catch (_) {}
    const { hdr } = await this._sendCmd(CMD.CONNECT, hiConnect ? [0x0001] : []);
    if (hdr.cmd === RSP.NACK) throw new Error('Connect NACK');
    return parseStatus(hdr.status);
  }

  /** Disconnect from sensor. */
  async disconnect() {
    const { hdr } = await this._sendCmd(CMD.DISCONNECT);
    if (hdr.cmd === RSP.NACK) throw new Error('Disconnect NACK');
  }

  /** Switch sensor to command mode (stops free-running data). */
  async enterCommandMode() {
    const { hdr } = await this._sendCmd(CMD.ENTER_CMD);
    if (hdr.cmd === RSP.NACK) throw new Error('Enter command mode NACK');
  }

  /** Return sensor to measure mode. */
  async exitCommandMode() {
    const { hdr } = await this._sendCmd(CMD.EXIT_CMD);
    if (hdr.cmd === RSP.NACK) throw new Error('Exit command mode NACK');
  }

  // Measure mode commands

  /**
   * Send software trigger. Returns { scanNo, z, x } or { scanNo, z, x } for HI-Connect.
   * Requires sensor in Input Triggered mode.
   */
  ethernetTrigger() {
    return this._waitForScan(CMD.ETH_TRIGGER, []);
  }

  /**
   * Enable / disable measurement via Ethernet.
   * Requires Activation Input = Regard (set via setTaskParam ACTIVATION = 1).
   * active=true: activates sensor and returns the first scan.
   * active=false: deactivates sensor. Per the protocol spec the sensor sends no
   *   response in the deactivated state, so this call is fire-and-forget.
   */
  async ethernetActivation(active) {
    if (!active) {
      const buf = buildPacket(CMD.ETH_ACTIVATION, 0, [0]);
      await this._send(buf);
      return;
    }
    return this._waitForScan(CMD.ETH_ACTIVATION, [1]);
  }

  // Command mode commands

  /** Turn laser on (true) or off (false). */
  async setLaserGate(on) {
    const { hdr } = await this._sendCmd(CMD.SET_LASER, [on ? 1 : 0]);
    if (hdr.cmd === RSP.NACK) throw new Error('Set laser gate NACK');
  }

  /**
   * Trigger a single measurement in command mode.
   * Wait ≥30 ms before calling getXCoordinates / getZCoordinates.
   */
  async triggerSingleMeasurement() {
    const { hdr } = await this._sendCmd(CMD.TRIGGER_SINGLE);
    if (hdr.cmd === RSP.NACK) throw new Error('Trigger single NACK');
    await new Promise(r => setTimeout(r, 30));
  }

  /** Get X coordinates from last triggered measurement. Returns signed array (1/10 mm). */
  async getXCoordinates() {
    const { hdr, userdata } = await this._sendCmd(CMD.GET_X);
    if (hdr.cmd !== RSP.X_COORDS) throw new Error('Get X NACK');
    return readSignedArray(userdata, hdr.udataLen);
  }

  /** Get Z coordinates from last triggered measurement. Returns unsigned array (1/10 mm). */
  async getZCoordinates() {
    const { hdr, userdata } = await this._sendCmd(CMD.GET_Z);
    if (hdr.cmd !== RSP.Z_COORDS) throw new Error('Get Z NACK');
    return readUInt16Array(userdata, hdr.udataLen);
  }

  /** Get combined ZX coordinates (HI-Connect, command mode). Returns { z, x }. */
  async getZXCoordinates() {
    const { hdr, userdata } = await this._sendCmd(CMD.GET_ZX);
    if (hdr.cmd !== RSP.ZX_COORDS) throw new Error('Get ZX NACK');
    const zLen = Math.min(240, hdr.udataLen);
    return {
      z: readUInt16Array(userdata, zLen, 0),
      x: readSignedArray(userdata, Math.max(0, hdr.udataLen - 240), 240 * 2),
    };
  }

  /** Set encoder counter value (32-bit). */
  async setEncoderValue(value) {
    const { hdr } = await this._sendCmd(CMD.SET_ENCODER, [
      value & 0xFFFF,
      (value >>> 16) & 0xFFFF,
    ]);
    if (hdr.cmd === RSP.NACK) throw new Error('Set encoder NACK');
  }

  /** Set active inspection task (0-15). save=true persists after restart. */
  async setInspectionTask(taskNum, save = false) {
    const { hdr } = await this._sendCmd(CMD.SET_TASK, [taskNum & 0x0F, save ? 1 : 0]);
    if (hdr.cmd === RSP.NACK) throw new Error('Set task NACK');
  }

  /** Get current inspection task number (0-15). */
  async getInspectionTask() {
    const { hdr, userdata } = await this._sendCmd(CMD.GET_TASK);
    if (hdr.cmd !== RSP.TASK_NUM) throw new Error('Get task NACK');
    return userdata.readUInt16LE(0) & 0x0F;
  }

  /** Set scan number (for cascaded multi-sensor sync). */
  async setScanNumber(scanNo) {
    const { hdr } = await this._sendCmd(CMD.SET_SCAN_NUM, [scanNo & 0xFFFF]);
    if (hdr.cmd === RSP.NACK) throw new Error('Set scan number NACK');
  }

  /**
   * Set a global user parameter.
   * @param {number} paramId   Use PARAM.* constants.
   * @param {number} value
   * @param {boolean} save     Persist after restart.
   */
  async setUserParam(paramId, value, save = false) {
    const { hdr } = await this._sendCmd(CMD.SET_USER_PARAM, [save ? 1 : 0, paramId, value]);
    if (hdr.cmd === RSP.NACK) throw new Error('Set user param NACK');
  }

  /**
   * Get a global user parameter.
   * @param {number} paramId   Use PARAM.* constants.
   */
  async getUserParam(paramId) {
    const { hdr, userdata } = await this._sendCmd(CMD.GET_USER_PARAM, [paramId]);
    if (hdr.cmd !== RSP.USER_PARAM) throw new Error('Get user param NACK');
    return userdata.readUInt16LE(0);
  }

  /**
   * Write an inspection task parameter.
   * @param {number} paramId   Use TASK_PARAM.* constants.
   * @param {number|number[]} values  One or more 16-bit words.
   * @param {boolean} save     Persist after restart.
   */
  async setTaskParam(paramId, values, save = false) {
    if (!Array.isArray(values)) values = [values];
    const { hdr } = await this._sendCmd(CMD.SET_TASK_PARAM, [save ? 1 : 0, paramId, ...values]);
    if (hdr.cmd === RSP.NACK) throw new Error('Set task param NACK');
  }

  /**
   * Read an inspection task parameter.
   * @param {number} paramId   Use TASK_PARAM.* constants.
   * @returns {{ paramId, dataType, values }} dataType: 1=UINT8, 2=UINT16, 5=SINT16, 7=CHAR
   */
  async getTaskParam(paramId) {
    const { hdr, userdata } = await this._sendCmd(CMD.GET_TASK_PARAM, [paramId]);
    if (hdr.cmd !== RSP.TASK_PARAM) throw new Error('Get task param NACK');
    // Response layout (userdata offsets, all uint16LE words):
    //   0: paramId, 2: dataType, 4: count, 6-9: lowerLimit, 10-13: upperLimit, 14: filler, 16+: values
    const dataType = userdata.readUInt16LE(2);
    const count    = userdata.readUInt16LE(4);
    const values   = [];
    for (let i = 0; i < count; i++) {
      const off = 16 + i * 2;
      values.push(dataType === 5 ? userdata.readInt16LE(off) : userdata.readUInt16LE(off));
    }
    return { paramId, dataType, values };
  }

  // ── Convenience wrappers ─────────────────────────

  /** Enable/disable X-coordinate output in measure mode. */
  setXOutput(enable, save = false) {
    return this.setUserParam(PARAM.DISABLE_X_OUTPUT, enable ? 0 : 1, save);
  }

  /**
   * Set transmission pause between Z and X packets.
   * @param {number} steps  0-9 (unit: 0.1 ms, so 0=0.1 ms, 9=1.0 ms)
   */
  setTxPause(steps, save = false) {
    return this.setUserParam(PARAM.TX_PAUSE, steps & 0x0F, save);
  }

  /** Enable/disable median filter for Z coordinates. */
  setMedianFilter(enable, save = false) {
    return this.setUserParam(PARAM.MEDIAN_FILTER, enable ? 1 : 0, save);
  }

  /** Parse a raw status word into a human-readable object. */
  parseStatus(raw) { return parseStatus(raw); }

  // ── Undocumented commands ─────────────────────────
  // These commands were observed in LPSsoft Wireshark traffic. They are NOT
  // described in the public LPS 36 Ethernet protocol specification and may
  // change or disappear in future firmware versions without notice.

  /**
   * Get device information: firmware version and article/serial number.
   *
   * ⚠ UNDOCUMENTED — reverse-engineered from LPSsoft network traffic.
   *   Not in the public protocol spec. May break on future firmware.
   *
   * Response payload layout (inferred, all uint16LE words):
   *   Words  0–10 : numerical device properties (meaning unknown)
   *   Word   11   : character count of the firmware string
   *   Words  12+  : firmware UTF-16LE chars (one char per word, high byte = 0x00)
   *   Immediately after: article/serial UTF-16LE chars until first non-ASCII word
   *
   * @returns {{ raw: number[], firmware: string, serial: string }}
   *   raw      = all response words (for diagnostics / future parsing)
   *   firmware = firmware version string  (e.g. "V01.525011132401")
   *   serial   = article / serial string  (e.g. "546003261O005")
   */
  async getDeviceInfo() {
    const { hdr, userdata } = await this._sendCmd(CMD.GET_DEVICE_INFO, [0x0011]);
    if (hdr.cmd !== RSP.DEVICE_INFO) throw new Error('Get device info NACK');
    const wordCount = hdr.udataLen;
    const raw = readUInt16Array(userdata, wordCount);

    function decodeAsciiWords(startIdx, maxLen) {
      let s = '';
      for (let i = 0; i < maxLen && startIdx + i < wordCount; i++) {
        const ch = raw[startIdx + i] & 0x00FF;
        if (ch === 0 || ch > 127) break;
        s += String.fromCharCode(ch);
      }
      return s;
    }

    const fwLen    = wordCount > 11 ? raw[11] : 0;
    const firmware = decodeAsciiWords(12, fwLen);
    const serial   = decodeAsciiWords(12 + fwLen, wordCount - 12 - fwLen);
    return { raw, firmware, serial };
  }

  /**
   * Bulk-read all inspection task parameters in one command.
   *
   * ⚠ UNDOCUMENTED — reverse-engineered from LPSsoft network traffic.
   *   Not in the public protocol spec. May break on future firmware.
   *
   * Response is a flat array of 8-word entries. Entry layout (inferred from live data):
   *   Word 0 : paramId   (internal sensor ID, distinct from the user-facing TASK_PARAM IDs)
   *   Word 1 : dataType  (1=UINT8, 2=UINT16, 3=UINT32?, 5=SINT16, 7=CHAR)
   *   Word 2 : valCount  (number of values in the full parameter; bulk caps at 2)
   *   Word 3 : padding   (always 0)
   *   Word 4 : limitLo   (scalar params: lower allowed value)
   *          OR value[0] (range params with valCount ≥ 2, e.g. FOV min — apply sign if dataType=5)
   *   Word 5 : padding   (always 0)
   *   Word 6 : current value (scalar params)
   *          OR value[1] (range params with valCount ≥ 2, e.g. FOV max — apply sign if dataType=5)
   *   Word 7 : persist flag (1 = value is saved to flash, observed always 1)
   *
   * @returns {Array<{ paramId, dataType, valCount, limitLo, values, persist, raw }>}
   *   limitLo is only meaningful for scalar params (valCount === 1).
   *   values contains 1 element for scalar params, 2 elements for range params.
   */
  async getAllTaskParams() {
    const { hdr, userdata } = await this._sendCmd(CMD.GET_ALL_TASK_PARAMS, [0x0002]);
    if (hdr.cmd !== RSP.ALL_TASK_PARAMS) throw new Error('Get all task params NACK');
    const words = readUInt16Array(userdata, hdr.udataLen);
    const ENTRY  = 8;
    const result = [];
    for (let base = 0; base + ENTRY <= words.length; base += ENTRY) {
      const paramId  = words[base];
      const dataType = words[base + 1];
      const valCount = words[base + 2];
      const limitLo  = words[base + 4];   // only meaningful when valCount === 1
      const persist  = words[base + 7];   // 1 = saved to flash
      const s = (v) => dataType === 5 ? (v > 32767 ? v - 65536 : v) : v;
      const values = valCount >= 2
        ? [s(words[base + 4]), s(words[base + 6])]
        : [s(words[base + 6])];
      result.push({ paramId, dataType, valCount, limitLo, values, persist,
                    raw: words.slice(base, base + ENTRY) });
    }
    return result;
  }
}

// ─────────────────────────────────────────────
// Buffer helpers
// ─────────────────────────────────────────────

function readUInt16Array(buf, count, byteOffset = 0) {
  return Array.from({ length: count }, (_, i) => buf.readUInt16LE(byteOffset + i * 2));
}

function readSignedArray(buf, count, byteOffset = 0) {
  return Array.from({ length: count }, (_, i) => {
    const v = buf.readUInt16LE(byteOffset + i * 2);
    return v > 32767 ? v - 65536 : v;  // two's complement
  });
}

// Attach constants as static properties so callers only need to import LPS36
LPS36.PARAM      = PARAM;
LPS36.TASK_PARAM = TASK_PARAM;
LPS36.CMD        = CMD;
LPS36.RSP        = RSP;

// ⚠ Undocumented command codes for consumers that want to inspect raw responses
LPS36.UNDOCUMENTED_CMD = {
  GET_ALL_TASK_PARAMS: CMD.GET_ALL_TASK_PARAMS,
  GET_DEVICE_INFO:     CMD.GET_DEVICE_INFO,
};

module.exports = LPS36;
