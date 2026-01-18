const fetch = require('node-fetch');
const supertest = require('supertest');

const { startExpressApp } = require('./harness/startExpressApp');

jest.mock('../../src/utils/logger', () => {
  return jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }));
});

jest.setTimeout(20000);

function loadStrategy() {
  jest.resetModules();
  return require('../../src/plugins/iotVisionTurret/strategies/local');
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

describe('iotVisionTurret HTTP endpoints (unit)', () => {
  let strategy;
  let appServer;
  let request;

  afterEach(async () => {
    if (strategy && typeof strategy.offline === 'function') {
      await strategy.offline();
    }
    if (appServer) {
      await appServer.close();
    }

    strategy = null;
    appServer = null;
    request = null;
  });

  test('register rejects non-JSON content type', async () => {
    strategy = loadStrategy();
    appServer = await startExpressApp();
    request = supertest(appServer.server);

    await strategy.online({
      expressApp: appServer.app,
      roboflow: {
        baseUrl: 'http://127.0.0.1:9001',
        workspace: 'test-workspace',
        workflowId: 'test-workflow'
      }
    });

    const res = await request
      .post('/iot/register')
      .set('Content-Type', 'text/plain')
      .send('not json');

    expect(res.status).toBe(415);
  });

  test('upload rejects invalid content type', async () => {
    strategy = loadStrategy();
    appServer = await startExpressApp();
    request = supertest(appServer.server);

    await strategy.online({
      expressApp: appServer.app,
      roboflow: {
        baseUrl: 'http://127.0.0.1:9001',
        workspace: 'test-workspace',
        workflowId: 'test-workflow'
      }
    });

    await request
      .post('/iot/register')
      .set('Content-Type', 'application/json')
      .send({ device_id: 'device-1' })
      .expect(200);

    const res = await request
      .post('/iot/upload?image_id=test_image')
      .set('Content-Type', 'text/plain')
      .send('nope');

    expect(res.status).toBe(415);
  });

  test('offline during long-poll returns a terminal response', async () => {
    strategy = loadStrategy();
    appServer = await startExpressApp();
    request = supertest(appServer.server);

    await strategy.online({
      expressApp: appServer.app,
      roboflow: {
        baseUrl: 'http://127.0.0.1:9001',
        workspace: 'test-workspace',
        workflowId: 'test-workflow'
      }
    });

    await request
      .post('/iot/register')
      .set('Content-Type', 'application/json')
      .send({ device_id: 'device-1' })
      .expect(200);

    const controller = new AbortController();
    const pullPromise = fetch(`${appServer.baseUrl}/iot/pull`, {
      method: 'GET',
      signal: controller.signal
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    await strategy.offline();

    let response = null;
    try {
      response = await withTimeout(pullPromise, 1000, 'pull did not resolve');
    } catch (err) {
      controller.abort();
      throw err;
    }

    expect([204, 409]).toContain(response.status);
  });
});
