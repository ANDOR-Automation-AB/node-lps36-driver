'use strict';

const LPS36 = require('./lps36');
const { PARAM, TASK_PARAM } = LPS36;

const HOST    = process.env.LPS_HOST    || '192.168.60.3';
const TIMEOUT = Number(process.env.LPS_TIMEOUT) || 3000;

const sensor = new LPS36({ host: HOST, timeout: TIMEOUT });

let passed = 0;
let failed = 0;
let warned = 0;

function ok(label, value) {
  console.log(`  PASS  ${label}`, value !== undefined ? JSON.stringify(value) : '');
  passed++;
}

function fail(label, err) {
  console.error(`  FAIL  ${label}: ${err.message}`);
  failed++;
}

function warn(label, msg) {
  console.log(`  WARN  ${label}: ${msg}`);
  warned++;
}

async function run(label, fn) {
  process.stdout.write(`\n[${label}]\n`);
  try {
    const result = await fn();
    ok(label, result);
    return result;
  } catch (err) {
    fail(label, err);
    return null;
  }
}

async function runOptional(label, fn, notSupportedMsg) {
  process.stdout.write(`\n[${label}]\n`);
  try {
    const result = await fn();
    ok(label, result);
    return result;
  } catch (err) {
    warn(label, notSupportedMsg || err.message);
    return null;
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function summaryScan(scan) {
  if (!scan) return null;
  const validZ = scan.z.filter(v => v > 0);
  return {
    scanNo: scan.scanNo,
    points: scan.z.length,
    validPoints: validZ.length,
    zRange: validZ.length ? [Math.min(...validZ), Math.max(...validZ)] : null,
    xRange: scan.x.length ? [Math.min(...scan.x), Math.max(...scan.x)] : null,
  };
}

// ─── stream listeners (active throughout) ────────────────────────────────────

let freeRunCount = 0;
let lastFreeRunScanNo = null;

sensor.on('z-data', ({ scanNo, z }) => {
  freeRunCount++;
  lastFreeRunScanNo = scanNo;
  if (freeRunCount <= 2)
    console.log(`  [stream] z-data  scanNo=${scanNo}  z[0]=${z[0]}  z[187]=${z[187]}`);
});

sensor.on('x-data', ({ scanNo, x }) => {
  if (freeRunCount <= 2)
    console.log(`  [stream] x-data  scanNo=${scanNo}  x[0]=${x[0]}  x[187]=${x[187]}`);
});

sensor.on('zx-data', ({ scanNo, z, x }) => {
  console.log(`  [stream] zx-data scanNo=${scanNo}  z[0]=${z[0]}  x[0]=${x[0]}`);
});

sensor.on('error', (err) => console.error('  [socket error]', err.message));

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nLPS 36 test  host=${HOST}  timeout=${TIMEOUT}ms\n${'='.repeat(60)}`);

  // ── sockets ─────────────────────────────────────────────────────────────────
  await run('open sockets', () => sensor.open());

  // ── Standard-Connect ────────────────────────────────────────────────────────
  const status = await run('connect (Standard-Connect)', () => sensor.connect(false));
  if (!status) {
    console.error('\nCould not connect. Aborting.');
    sensor.close();
    process.exit(1);
  }
  console.log(`  mode=${status.mode}  connected=${status.connected}  activated=${status.activated}  warning=${status.warning}  error=${status.error}`);

  // ── free-running measure data (2 s) ──────────────────────────────────────────
  console.log('\n[free-running measure mode — collecting 2 s]');
  freeRunCount = 0;
  await sleep(2000);
  console.log(`  received ${freeRunCount} z+x scan pairs  lastScanNo=${lastFreeRunScanNo}`);
  if (freeRunCount > 0) ok('free-running data', { scans: freeRunCount, lastScanNo: lastFreeRunScanNo });
  else fail('free-running data', new Error('no data received'));

  // ── command mode ─────────────────────────────────────────────────────────────
  await run('enterCommandMode', () => sensor.enterCommandMode());

  // ── getInspectionTask / setInspectionTask ────────────────────────────────────
  const currentTask = await run('getInspectionTask', () => sensor.getInspectionTask());
  if (currentTask !== null) {
    await run('setInspectionTask (temp)', () => sensor.setInspectionTask(currentTask, false));
    await run('setInspectionTask (persist)', () => sensor.setInspectionTask(currentTask, true));
  }

  // ── getTaskParam — all IDs ───────────────────────────────────────────────────
  await run('getTaskParam TASK_NUMBER',    () => sensor.getTaskParam(TASK_PARAM.TASK_NUMBER));

  const nameResult = await run('getTaskParam TASK_NAME', () => sensor.getTaskParam(TASK_PARAM.TASK_NAME));
  if (nameResult) {
    const name = String.fromCharCode(...nameResult.values).replace(/\0/g, '').trim();
    console.log(`  task name: "${name}"`);
  }

  const opMode      = await run('getTaskParam OPERATION_MODE', () => sensor.getTaskParam(TASK_PARAM.OPERATION_MODE));
  const activation  = await run('getTaskParam ACTIVATION',     () => sensor.getTaskParam(TASK_PARAM.ACTIVATION));
  await run('getTaskParam CASCADE_OUTPUT', () => sensor.getTaskParam(TASK_PARAM.CASCADE_OUTPUT));
  await run('getTaskParam LIGHT_EXPOSURE', () => sensor.getTaskParam(TASK_PARAM.LIGHT_EXPOSURE));
  await run('getTaskParam EXPOSURE_MANUAL',() => sensor.getTaskParam(TASK_PARAM.EXPOSURE_MANUAL));

  const fovX = await run('getTaskParam FOV_X', () => sensor.getTaskParam(TASK_PARAM.FOV_X));
  if (fovX) console.log(`  FOV X: ${fovX.values[0] / 10} mm to ${fovX.values[1] / 10} mm`);

  const fovZ = await run('getTaskParam FOV_Z', () => sensor.getTaskParam(TASK_PARAM.FOV_Z));
  if (fovZ) console.log(`  FOV Z: ${fovZ.values[0] / 10} mm to ${fovZ.values[1] / 10} mm`);

  // ── setTaskParam — write and restore ────────────────────────────────────────
  await run('setTaskParam OPERATION_MODE (FreeRunning, temp)',  () => sensor.setTaskParam(TASK_PARAM.OPERATION_MODE, 0, false));
  await run('setTaskParam OPERATION_MODE (restore, temp)',      () => sensor.setTaskParam(TASK_PARAM.OPERATION_MODE, 0, false));
  await run('setTaskParam ACTIVATION (Disregard, temp)',        () => sensor.setTaskParam(TASK_PARAM.ACTIVATION, 0, false));
  await run('setTaskParam CASCADE_OUTPUT (Disable, temp)',      () => sensor.setTaskParam(TASK_PARAM.CASCADE_OUTPUT, 0, false));
  await run('setTaskParam LIGHT_EXPOSURE (Normal, temp)',       () => sensor.setTaskParam(TASK_PARAM.LIGHT_EXPOSURE, 0, false));

  if (fovX) {
    await run('setTaskParam FOV_X (restore, temp)', () =>
      sensor.setTaskParam(TASK_PARAM.FOV_X, fovX.values, false));
  }
  if (fovZ) {
    await run('setTaskParam FOV_Z (restore, temp)', () =>
      sensor.setTaskParam(TASK_PARAM.FOV_Z, fovZ.values, false));
  }

  // ── getUserParam — all IDs ───────────────────────────────────────────────────
  await run('getUserParam DISABLE_X_OUTPUT', () => sensor.getUserParam(PARAM.DISABLE_X_OUTPUT));

  const txPause = await run('getUserParam TX_PAUSE', () => sensor.getUserParam(PARAM.TX_PAUSE));
  if (txPause !== null) console.log(`  TX pause: ${txPause * 0.1} ms`);

  await run('getUserParam MEDIAN_FILTER', () => sensor.getUserParam(PARAM.MEDIAN_FILTER));

  // ── setUserParam / convenience wrappers ─────────────────────────────────────
  await run('setXOutput(disable, temp)',     () => sensor.setXOutput(false, false));
  await run('setXOutput(enable, temp)',      () => sensor.setXOutput(true,  false));
  await run('setMedianFilter(on, temp)',     () => sensor.setMedianFilter(true,  false));
  await run('setMedianFilter(off, temp)',    () => sensor.setMedianFilter(false, false));
  await run('setTxPause(5, temp)',           () => sensor.setTxPause(5, false));
  await run('setTxPause(0, temp)',           () => sensor.setTxPause(0, false));

  // ── setScanNumber ────────────────────────────────────────────────────────────
  await run('setScanNumber(100)', () => sensor.setScanNumber(100));

  // ── setEncoderValue ──────────────────────────────────────────────────────────
  await run('setEncoderValue(0)',      () => sensor.setEncoderValue(0));
  await run('setEncoderValue(12345)',  () => sensor.setEncoderValue(12345));
  await run('setEncoderValue(0)',      () => sensor.setEncoderValue(0));

  // ── laser gate ───────────────────────────────────────────────────────────────
  await run('setLaserGate(off)', () => sensor.setLaserGate(false));
  await sleep(200);
  await run('setLaserGate(on)',  () => sensor.setLaserGate(true));
  await sleep(200);

  // ── trigger + get Z + get X ──────────────────────────────────────────────────
  await run('triggerSingleMeasurement', () => sensor.triggerSingleMeasurement());
  const z = await run('getZCoordinates', () => sensor.getZCoordinates());
  const x = await run('getXCoordinates', () => sensor.getXCoordinates());
  if (z && x) {
    const validZ = z.filter(v => v > 0);
    console.log(`  Z: ${validZ.length} valid points  min=${Math.min(...validZ)}  max=${Math.max(...z)}`);
    console.log(`  X: min=${Math.min(...x)}  max=${Math.max(...x)}`);
  }

  // ── getZXCoordinates (HI-Connect command mode) ───────────────────────────────
  await runOptional('getZXCoordinates (HI-Connect only)', () => sensor.getZXCoordinates(),
    'not supported on standard LPS 36 (HI/EN model required)');

  // ── ethernet trigger — set Input Triggered mode, then trigger ────────────────
  // ethernetTrigger requires OPERATION_MODE = Input Triggered (1).
  // We set it temporarily here and restore it afterward.
  await run('setTaskParam OPERATION_MODE (Input Triggered, temp)',
    () => sensor.setTaskParam(TASK_PARAM.OPERATION_MODE, 1, false));
  await run('exitCommandMode', () => sensor.exitCommandMode());

  const trigScan = await run('ethernetTrigger', () => sensor.ethernetTrigger());
  if (trigScan) console.log(`  `, JSON.stringify(summaryScan(trigScan)));

  // ── ethernet activation — set Regard + FreeRunning, then activate/deactivate ─
  // ethernetActivation requires ACTIVATION = Regard (1).
  // OPERATION_MODE is set to FreeRunning (0) so that activation(true) immediately
  // produces a scan without needing an additional software trigger.
  // activation(false) deactivates the sensor; per the protocol spec the sensor
  // sends no response in the deactivated state, so the call is fire-and-forget.
  await run('enterCommandMode (activation setup)', () => sensor.enterCommandMode());
  await run('setTaskParam ACTIVATION (Regard, temp)',
    () => sensor.setTaskParam(TASK_PARAM.ACTIVATION, 1, false));
  await run('setTaskParam OPERATION_MODE (FreeRunning, temp)',
    () => sensor.setTaskParam(TASK_PARAM.OPERATION_MODE, 0, false));
  await run('exitCommandMode (activation setup)', () => sensor.exitCommandMode());

  await run('ethernetActivation(true)',  () => sensor.ethernetActivation(true));
  await run('ethernetActivation(false, deactivate)', () => sensor.ethernetActivation(false));
  await sleep(200);

  // ── restore original OPERATION_MODE and ACTIVATION ───────────────────────────
  const origOpMode     = opMode     ? opMode.values[0]     : 0;
  const origActivation = activation ? activation.values[0] : 0;
  await run('enterCommandMode (restore)', () => sensor.enterCommandMode());
  await run('setTaskParam ACTIVATION (restore, temp)',
    () => sensor.setTaskParam(TASK_PARAM.ACTIVATION, origActivation, false));
  await run('setTaskParam OPERATION_MODE (restore, temp)',
    () => sensor.setTaskParam(TASK_PARAM.OPERATION_MODE, origOpMode, false));

  // ── getAllTaskParams (undocumented 0x0043) — while still in command mode ─────
  const allParams = await runOptional('getAllTaskParams (undocumented 0x0043)',
    () => sensor.getAllTaskParams(),
    'command 0x0043 not supported on this firmware');
  if (allParams) {
    console.log(`  ${allParams.length} entries:`);
    for (const p of allParams) {
      const extra = p.valCount === 1 ? `  limitLo=${p.limitLo}` : '';
      console.log(`    paramId=0x${p.paramId.toString(16).padStart(4,'0')}  type=${p.dataType}  valCount=${p.valCount}  values=${JSON.stringify(p.values)}${extra}`);
    }
  }

  // ── getDeviceInfo (undocumented 0x0045) — while still in command mode ────────
  const devInfo = await runOptional('getDeviceInfo (undocumented 0x0045)',
    () => sensor.getDeviceInfo(),
    'command 0x0045 not supported on this firmware');
  if (devInfo) console.log(`  firmware: "${devInfo.firmware}"  serial: "${devInfo.serial}"`);

  await run('exitCommandMode (restore)', () => sensor.exitCommandMode());

  // ── disconnect ───────────────────────────────────────────────────────────────
  await run('disconnect', () => sensor.disconnect());

  // ── HI-Connect (LPS 36HI/EN only) ───────────────────────────────────────────
  console.log('\n[HI-Connect — LPS 36HI/EN only, FAIL expected on standard model]');
  freeRunCount = 0;

  const hiStatus = await run('connect (HI-Connect)', () => sensor.connect(true));
  if (hiStatus) {
    console.log(`  mode=${hiStatus.mode}  connected=${hiStatus.connected}`);

    console.log('\n[HI-Connect free-running — collecting 1 s]');
    await sleep(1000);
    console.log(`  received ${freeRunCount} zx scans`);
    if (freeRunCount > 0) ok('HI-Connect free-running data', { scans: freeRunCount });
    else fail('HI-Connect free-running data', new Error('no zx-data received'));

    await run('enterCommandMode (HI)', () => sensor.enterCommandMode());
    await run('triggerSingleMeasurement (HI)', () => sensor.triggerSingleMeasurement());
    await runOptional('getZXCoordinates (HI)',   () => sensor.getZXCoordinates(),
      'not supported on standard LPS 36 (HI/EN model required)');
    await run('exitCommandMode (HI)',           () => sensor.exitCommandMode());
    await run('disconnect (HI)',                () => sensor.disconnect());
  }

  // ── done ─────────────────────────────────────────────────────────────────────
  sensor.close();

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  passed: ${passed}   warned: ${warned}   failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  sensor.close();
  process.exit(1);
});
