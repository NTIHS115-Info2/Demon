const http = require('http');
const { URL } = require('url');

function buildRoboflowResponse({ predictions = [], imageSize = { width: 640, height: 480 } } = {}) {
  return {
    outputs: [
      {
        predictions: {
          predictions,
          image: { width: imageSize.width, height: imageSize.height }
        }
      }
    ]
  };
}

function makePrediction({
  x,
  y,
  width = 80,
  height = 80,
  confidence = 0.9,
  klass = 'target'
} = {}) {
  return {
    x,
    y,
    width,
    height,
    confidence,
    class: klass
  };
}

function buildYoloLikeResponse() {
  return {
    boxes: [
      { x1: 10, y1: 10, x2: 100, y2: 120, confidence: 0.9, class: 'target' }
    ],
    image_size: { width: 640, height: 480 }
  };
}

function createMockRoboflowServer() {
  const responseQueue = [];
  const requests = [];
  const responses = [];
  let defaultResponse = {
    status: 200,
    json: buildRoboflowResponse({ predictions: [] })
  };
  let callCount = 0;
  let baseUrl = '';

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (req.method !== 'POST' || !url.pathname.startsWith('/infer/workflows/')) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }

    callCount += 1;

    const bodySize = await consumeBody(req);
    requests.push({ method: req.method, path: url.pathname, size: bodySize, time: Date.now() });

    const next = responseQueue.length > 0 ? responseQueue.shift() : defaultResponse;
    const status = Number.isFinite(next.status) ? next.status : 200;
    const delayMs = Number.isFinite(next.delayMs) ? next.delayMs : 0;

    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    res.statusCode = status;
    const responseInfo = {
      status,
      bytesPlanned: 0,
      bytesWritten: 0,
      closedEarly: false,
      time: Date.now()
    };
    responses.push(responseInfo);
    res.on('close', () => {
      if (responseInfo.bytesPlanned > 0 && responseInfo.bytesWritten < responseInfo.bytesPlanned) {
        responseInfo.closedEarly = true;
      }
    });

    if (next.headers && typeof next.headers === 'object') {
      for (const [key, value] of Object.entries(next.headers)) {
        res.setHeader(key, value);
      }
    }

    if (next.malformedJson === true) {
      res.setHeader('Content-Type', 'application/json');
      res.end('{"oops":');
      return;
    }

    if (typeof next.text === 'string') {
      res.setHeader('Content-Type', next.contentType || 'text/plain');
      res.end(next.text);
      return;
    }

    if (next.streamBytes) {
      const totalBytes = Math.max(0, Number(next.streamBytes));
      const chunkSize = Number.isFinite(next.streamChunkSize) ? next.streamChunkSize : 16384;
      const delayMs = Number.isFinite(next.streamDelayMs) ? next.streamDelayMs : 0;
      res.setHeader('Content-Type', 'application/json');
      res.on('error', () => {});
      await streamJsonResponse(res, totalBytes, { chunkSize, delayMs }, responseInfo);
      return;
    }

    let payload = next.json;
    if (next.hugeJsonBytes) {
      const size = Math.max(0, Number(next.hugeJsonBytes));
      const blob = 'a'.repeat(size);
      payload = buildRoboflowResponse({ predictions: [] });
      payload.outputs[0].predictions.blob = blob;
    }

    res.setHeader('Content-Type', 'application/json');
    const body = JSON.stringify(payload || {});
    responseInfo.bytesPlanned = Buffer.byteLength(body);
    responseInfo.bytesWritten = responseInfo.bytesPlanned;
    res.end(body);
  });

  async function start(port = 0) {
    await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
    const address = server.address();
    baseUrl = `http://${address.address}:${address.port}`;
    return baseUrl;
  }

  function close() {
    return new Promise((resolve) => server.close(resolve));
  }

  function enqueueResponse(response) {
    responseQueue.push(response);
  }

  function setDefaultResponse(response) {
    defaultResponse = response;
  }

  function reset() {
    responseQueue.length = 0;
    callCount = 0;
    requests.length = 0;
    responses.length = 0;
  }

  function getCallCount() {
    return callCount;
  }

  function getBaseUrl() {
    return baseUrl;
  }

  return {
    server,
    start,
    close,
    enqueueResponse,
    setDefaultResponse,
    reset,
    getCallCount,
    getBaseUrl,
    getRequests: () => requests.slice(),
    getResponses: () => responses.slice()
  };
}

function consumeBody(req) {
  return new Promise((resolve) => {
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
    });
    req.on('end', () => resolve(size));
    req.on('error', () => resolve(size));
  });
}

async function streamJsonResponse(res, totalBytes, options = {}, responseInfo) {
  const prefix = '{"outputs":[{"predictions":{"predictions":[],"image":{"width":640,"height":480},"blob":"';
  const suffix = '"}}]}';
  const prefixBytes = Buffer.byteLength(prefix);
  const suffixBytes = Buffer.byteLength(suffix);
  const payloadBytes = Math.max(0, totalBytes - prefixBytes - suffixBytes);
  const chunkSize = Math.max(1, Number(options.chunkSize) || 16384);
  const delayMs = Math.max(0, Number(options.delayMs) || 0);
  if (responseInfo) {
    responseInfo.bytesPlanned = totalBytes;
  }

  try {
    res.write(prefix);
    if (responseInfo) responseInfo.bytesWritten += prefixBytes;
    let remaining = payloadBytes;
    while (remaining > 0) {
      const size = Math.min(remaining, chunkSize);
      res.write('a'.repeat(size));
      if (responseInfo) responseInfo.bytesWritten += size;
      remaining -= size;
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      if (res.destroyed) return;
    }
    res.end(suffix);
    if (responseInfo) responseInfo.bytesWritten += suffixBytes;
  } catch (err) {
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end('stream error');
    }
  }
}

module.exports = {
  createMockRoboflowServer,
  buildRoboflowResponse,
  makePrediction,
  buildYoloLikeResponse
};
