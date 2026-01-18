const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const { startExpressApp } = require('./harness/startExpressApp');
const {
  createMockRoboflowServer,
  buildRoboflowResponse,
  makePrediction,
  buildYoloLikeResponse
} = require('./harness/mockRoboflowServer');
const { FakeDeviceClient } = require('./harness/fakeDeviceClient');
const { createTinyPng } = require('./harness/imageFactory');

jest.mock('../../src/utils/logger', () => {
  return jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }));
});

jest.setTimeout(60000);

const UPLOAD_DIR = path.resolve(process.cwd(), 'artifacts', 'iotVisionTurret');

function loadStrategy() {
  jest.resetModules();
  return require('../../src/plugins/iotVisionTurret/strategies/local');
}

async function listUploadFiles() {
  try {
    const entries = await fs.promises.readdir(UPLOAD_DIR);
    return entries.map((entry) => path.join(UPLOAD_DIR, entry));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function cleanupUploadDir() {
  await fs.promises.rm(UPLOAD_DIR, { recursive: true, force: true });
}

async function withTimeout(promise, timeoutMs, label) {
  let timeoutId = null;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(label)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function waitFor(conditionFn, timeoutMs = 2000, intervalMs = 50) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await conditionFn();
    if (ok) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('waitFor timeout');
}

async function createHarness(options = {}) {
  const appServer = await startExpressApp();
  const mockServer = createMockRoboflowServer();
  await mockServer.start(0);

  if (options.defaultResponse) {
    mockServer.setDefaultResponse(options.defaultResponse);
  }

  if (Array.isArray(options.responses)) {
    for (const response of options.responses) {
      mockServer.enqueueResponse(response);
    }
  }

  const strategy = loadStrategy();

  await strategy.online({
    expressApp: appServer.app,
    roboflow: {
      baseUrl: mockServer.getBaseUrl(),
      apiKey: 'test-key',
      workspace: 'test-workspace',
      workflowId: 'test-workflow',
      targetClass: options.roboflowTargetClass || '',
      timeoutMs: Number.isFinite(options.inferTimeoutMs) ? options.inferTimeoutMs : 400,
      maxResponseBytes: options.roboflowMaxResponseBytes
    }
  });

  const device = new FakeDeviceClient({
    baseUrl: appServer.baseUrl,
    deviceId: 'device-1',
    imageFactory: { createTinyPng },
    uploadBehavior: options.uploadBehavior,
    idleAbortMs: options.idleAbortMs
  });

  await device.register();

  if (options.startPolling !== false) {
    device.startPolling();
  }

  return {
    strategy,
    device,
    appServer,
    mockServer
  };
}

async function cleanupHarness(harness) {
  if (!harness) return;

  if (harness.device) {
    await harness.device.stop();
  }

  if (harness.strategy && typeof harness.strategy.offline === 'function') {
    await harness.strategy.offline();
  }

  if (harness.appServer) {
    await harness.appServer.close();
  }

  if (harness.mockServer) {
    await harness.mockServer.close();
  }

  await cleanupUploadDir();
}

function centeredResponse() {
  return {
    status: 200,
    json: buildRoboflowResponse({
      predictions: [makePrediction({ x: 320, y: 240 })],
      imageSize: { width: 640, height: 480 }
    })
  };
}

describe('iotVisionTurret e2e', () => {
  let harness = null;

  afterEach(async () => {
    await cleanupHarness(harness);
    harness = null;
  });

  test('happy path: centered detection fires IR and never moves pitch below 0', async () => {
    harness = await createHarness({ defaultResponse: centeredResponse() });

    const result = await withTimeout(
      harness.strategy.send({ device: 'light', method: 'turn_on' }),
      8000,
      'send timeout'
    );

    expect(result).toEqual({ ok: true });

    await waitFor(() => harness.device.history.irSends.length === 1, 3000);
    expect(harness.device.history.irSends[0]).toMatchObject({
      device: 'light',
      code: '0x000000'
    });
    expect(harness.device.history.invalidMoves).toHaveLength(0);

    await harness.device.stop();
    expect(harness.device.getActivePulls()).toBe(0);

    const files = await listUploadFiles();
    expect(files.length).toBe(0);
  });

  test('scan completes with no predictions -> ok:false and no stale commands', async () => {
    const noPredictions = {
      status: 200,
      json: buildRoboflowResponse({ predictions: [], imageSize: { width: 640, height: 480 } })
    };

    harness = await createHarness({ defaultResponse: noPredictions });

    const result = await withTimeout(
      harness.strategy.send({ device: 'light', method: 'turn_on' }),
      15000,
      'send timeout'
    );

    expect(result).toEqual({ ok: false });
    expect(harness.device.history.irSends).toHaveLength(0);

    const commandCount = harness.device.history.moves.length + harness.device.history.captures.length;
    await new Promise((resolve) => setTimeout(resolve, 400));
    const commandCountAfter =
      harness.device.history.moves.length + harness.device.history.captures.length;
    expect(commandCountAfter).toBe(commandCount);
  });

  test('track adjusts yaw toward center within TRACK_MAX_STEPS', async () => {
    const responses = [
      {
        status: 200,
        json: buildRoboflowResponse({
          predictions: [makePrediction({ x: 600, y: 240 })],
          imageSize: { width: 640, height: 480 }
        })
      },
      {
        status: 200,
        json: buildRoboflowResponse({
          predictions: [makePrediction({ x: 520, y: 240 })],
          imageSize: { width: 640, height: 480 }
        })
      },
      {
        status: 200,
        json: buildRoboflowResponse({
          predictions: [makePrediction({ x: 440, y: 240 })],
          imageSize: { width: 640, height: 480 }
        })
      },
      {
        status: 200,
        json: buildRoboflowResponse({
          predictions: [makePrediction({ x: 340, y: 240 })],
          imageSize: { width: 640, height: 480 }
        })
      }
    ];

    harness = await createHarness({
      responses,
      defaultResponse: centeredResponse()
    });

    const result = await withTimeout(
      harness.strategy.send({ device: 'fan', method: 'turn_on' }),
      8000,
      'send timeout'
    );

    expect(result).toEqual({ ok: true });

    const moves = harness.device.history.moves;
    expect(moves.length).toBeGreaterThan(1);

    const trackingMoves = moves.slice(1);
    const yaws = trackingMoves.map((move) => move.yaw).filter((yaw) => Number.isFinite(yaw));
    for (let i = 1; i < yaws.length; i += 1) {
      expect(yaws[i]).toBeGreaterThanOrEqual(yaws[i - 1]);
    }

    await waitFor(() => harness.device.history.irSends.length === 1, 3000);
  });

  test('mechanical constraint: target below center at pitch=0 never requests negative pitch', async () => {
    harness = await createHarness({
      defaultResponse: {
        status: 200,
        json: buildRoboflowResponse({
          predictions: [makePrediction({ x: 320, y: 420 })],
          imageSize: { width: 640, height: 480 }
        })
      }
    });

    const result = await withTimeout(
      harness.strategy.send({ device: 'light', method: 'turn_on' }),
      8000,
      'send timeout'
    );

    expect(typeof result.ok).toBe('boolean');
    expect(harness.device.history.invalidMoves).toHaveLength(0);
  });

  test('long-poll close mid-wait does not break subsequent commands', async () => {
    harness = await createHarness({ defaultResponse: centeredResponse(), startPolling: false });

    await harness.device.pullOnce({ abortAfterMs: 100 });
    expect(harness.device.history.pulls.some((pull) => pull.status === 'aborted')).toBe(true);

    harness.device.startPolling();

    const result = await withTimeout(
      harness.strategy.send({ device: 'light', method: 'turn_on' }),
      8000,
      'send timeout'
    );

    expect(result).toEqual({ ok: true });
    await waitFor(() => harness.device.history.irSends.length === 1, 3000);
  });

  test('Roboflow HTTP 500 returns ok:false and releases lock', async () => {
    harness = await createHarness({
      defaultResponse: { status: 500, text: 'error', contentType: 'text/plain' }
    });

    const result1 = await withTimeout(
      harness.strategy.send({ device: 'light', method: 'turn_on' }),
      8000,
      'send timeout'
    );
    const result2 = await withTimeout(
      harness.strategy.send({ device: 'light', method: 'turn_on' }),
      8000,
      'send timeout'
    );

    expect(result1).toEqual({ ok: false });
    expect(result2).toEqual({ ok: false });
    expect(harness.device.history.irSends).toHaveLength(0);
  });

  test('Roboflow timeout aborts within bounded time', async () => {
    harness = await createHarness({
      inferTimeoutMs: 200,
      defaultResponse: {
        status: 200,
        delayMs: 600,
        json: buildRoboflowResponse({
          predictions: [makePrediction({ x: 320, y: 240 })],
          imageSize: { width: 640, height: 480 }
        })
      }
    });

    const result = await withTimeout(
      harness.strategy.send({ device: 'light', method: 'turn_on' }),
      8000,
      'send timeout'
    );

    expect(result).toEqual({ ok: false });
  });

  test('malformed and unexpected Roboflow JSON handled safely', async () => {
    const responses = [
      { status: 200, malformedJson: true },
      { status: 200, json: buildYoloLikeResponse() }
    ];

    harness = await createHarness({
      responses,
      defaultResponse: {
        status: 200,
        json: buildRoboflowResponse({ predictions: [], imageSize: { width: 640, height: 480 } })
      }
    });

    const result = await withTimeout(
      harness.strategy.send({ device: 'light', method: 'turn_on' }),
      15000,
      'send timeout'
    );

    expect(result).toEqual({ ok: false });
  });

  test('unknown device/method returns ok:false and does not deadlock jobLock', async () => {
    harness = await createHarness({ defaultResponse: centeredResponse(), startPolling: false });

    const bad = await withTimeout(
      harness.strategy.send({ device: 'unknown', method: 'turn_on' }),
      2000,
      'send timeout'
    );
    expect(bad).toEqual({ ok: false });

    harness.device.startPolling();

    const good = await withTimeout(
      harness.strategy.send({ device: 'light', method: 'turn_on' }),
      8000,
      'send timeout'
    );
    expect(good).toEqual({ ok: true });
  });

  test('out-of-order upload resolves before waiter exists', async () => {
    harness = await createHarness({
      defaultResponse: centeredResponse(),
      uploadBehavior: { type: 'out_of_order', duplicate: true, gapMs: 5 }
    });

    const result = await withTimeout(
      harness.strategy.send({ device: 'light', method: 'turn_on' }),
      8000,
      'send timeout'
    );

    expect(result).toEqual({ ok: true });
    expect(harness.device.history.uploads.length).toBeGreaterThan(0);
  });

  test('re-register during active job cancels job and releases long-polls', async () => {
    harness = await createHarness({
      defaultResponse: {
        status: 200,
        delayMs: 800,
        json: buildRoboflowResponse({ predictions: [], imageSize: { width: 640, height: 480 } })
      }
    });

    const sendPromise = harness.strategy.send({ device: 'light', method: 'turn_on' });

    await waitFor(() => harness.device.history.captures.length > 0, 3000);

    const res = await fetch(`${harness.appServer.baseUrl}/iot/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: 'device-1' })
    });
    expect(res.status).toBe(200);

    const result = await withTimeout(sendPromise, 8000, 'send timeout');
    expect(result).toEqual({ ok: false });

    expect(
      harness.device.history.pulls.some((pull) => pull.status === 409 || pull.status === 204)
    ).toBe(true);

    harness.mockServer.setDefaultResponse(centeredResponse());
    const next = await withTimeout(
      harness.strategy.send({ device: 'light', method: 'turn_on' }),
      8000,
      'send timeout'
    );
    expect(next).toEqual({ ok: true });
  });

  test('duplicate upload replaces file and still resolves waiter', async () => {
    harness = await createHarness({
      defaultResponse: centeredResponse(),
      uploadBehavior: { type: 'duplicate', gapMs: 5 }
    });

    const result = await withTimeout(
      harness.strategy.send({ device: 'light', method: 'turn_on' }),
      8000,
      'send timeout'
    );

    expect(result).toEqual({ ok: true });
  });

  test('upload invalid content-type returns ok:false', async () => {
    harness = await createHarness({
      defaultResponse: centeredResponse(),
      uploadBehavior: { type: 'normal', contentType: 'text/plain' }
    });

    const result = await withTimeout(
      harness.strategy.send({ device: 'light', method: 'turn_on' }),
      12000,
      'send timeout'
    );

    expect(result).toEqual({ ok: false });
  });

  test('large Roboflow response fails safely', async () => {
    harness = await createHarness({
      inferTimeoutMs: 8000,
      roboflowMaxResponseBytes: 64 * 1024,
      defaultResponse: {
        status: 200,
        streamBytes: 1024 * 1024,
        streamChunkSize: 16 * 1024,
        streamDelayMs: 50,
        json: buildRoboflowResponse({ predictions: [] })
      }
    });

    const start = Date.now();
    const result = await withTimeout(
      harness.strategy.send({ device: 'light', method: 'turn_on' }),
      20000,
      'send timeout'
    );
    const durationMs = Date.now() - start;

    expect(result).toEqual({ ok: false });
    expect(durationMs).toBeLessThan(1500);
  });
});
