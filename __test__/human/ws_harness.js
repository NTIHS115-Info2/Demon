const http = require('http');
const express = require('express');
const { WebSocket } = require('ws');
const { EventEmitter } = require('events');

const appChatService = require('../../src/plugins/appChatService/strategies/local');
const talker = require('../../src/core/TalkToDemon');
const PM = require('../../src/core/pluginsManager');

const DEFAULT_TIMEOUT_MS = 5000;

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function getLastUserMessage(messages) {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role === 'user' && !msg?.tool_call_id) {
      return msg;
    }
  }
  return null;
}

function createMockEmitter(sequence) {
  const emitter = new EventEmitter();
  let aborted = false;
  const timers = [];

  emitter.abort = () => {
    aborted = true;
    timers.forEach(t => clearTimeout(t));
  };

  sequence.forEach((step, idx) => {
    const delay = step.delayMs || idx * 20;
    const timer = setTimeout(() => {
      if (aborted) return;
      if (step.type === 'data') {
        emitter.emit('data', step.chunk, null, step.reasoning || '');
      } else if (step.type === 'end') {
        emitter.emit('end');
      } else if (step.type === 'error') {
        emitter.emit('error', step.error || new Error('mock error'));
      }
    }, delay);
    timers.push(timer);
  });

  return emitter;
}

function setupMockPlugins() {
  let toolCallCount = 0;

  const mockTool = {
    pluginName: 'mocktool',
    state: async () => 1,
    send: async (input) => {
      toolCallCount += 1;
      return { success: true, value: input };
    }
  };

  const mockLlama = {
    pluginName: 'llamaServer',
    state: async () => 1,
    send: (payload) => {
      const lastUser = getLastUserMessage(payload?.messages || []);
      const text = lastUser?.content || '';
      const hasToolResult = Array.isArray(payload?.messages)
        && payload.messages.some(m => m?.tool_call_id);

      if (text.includes('[t1]')) {
        return createMockEmitter([
          { type: 'data', reasoning: 'planning response...' },
          { type: 'data', chunk: 'Hello from test 1.' },
          { type: 'end' }
        ]);
      }

      if (text.includes('[t2]')) {
        if (!hasToolResult) {
          return createMockEmitter([
            { type: 'data', chunk: 'Checking tool {"toolName":"mocktool","input":{"value":1}}' },
            { type: 'end' }
          ]);
        }
        return createMockEmitter([
          { type: 'data', reasoning: 'tool complete.' },
          { type: 'data', chunk: 'Tool result applied.' },
          { type: 'end' }
        ]);
      }

      if (text.includes('[t3]')) {
        if (!hasToolResult) {
          return createMockEmitter([
            { type: 'data', chunk: '{"toolName":"mocktool","input":{"value":1}}{"toolName":"mocktool","input":{"value":2}}' },
            { type: 'end' }
          ]);
        }
        return createMockEmitter([
          { type: 'data', chunk: 'Multi-tool follow-up.' },
          { type: 'end' }
        ]);
      }

      if (text.includes('[t4]')) {
        return createMockEmitter([
          { type: 'data', chunk: '{"toolName":"mocktool","input":' },
          { type: 'end' }
        ]);
      }

      if (text.includes('[t5_long]')) {
        return createMockEmitter([
          { type: 'data', reasoning: 'long reasoning...' },
          { type: 'data', delayMs: 3000, chunk: 'late chunk' },
          { type: 'end', delayMs: 3500 }
        ]);
      }

      if (text.includes('[t6_http_long]')) {
        return createMockEmitter([
          { type: 'data', reasoning: 'http busy...' },
          { type: 'end', delayMs: 1200 }
        ]);
      }

      if (text.includes('[t7_error]')) {
        return createMockEmitter([
          { type: 'data', reasoning: 'about to fail...' },
          { type: 'error', error: new Error('mock upstream error') }
        ]);
      }

      return createMockEmitter([
        { type: 'data', chunk: 'default reply' },
        { type: 'end' }
      ]);
    }
  };

  PM.plugins.set('mocktool', mockTool);
  PM.plugins.set('llamaserver', mockLlama);

  return {
    resetToolCount: () => { toolCallCount = 0; },
    getToolCount: () => toolCallCount
  };
}

function wsRequest(url, payload, { closeAfterMs, onEvent } = {}) {
  return new Promise((resolve, reject) => {
    const events = [];
    let done = false;
    const ws = new WebSocket(url);
    const timeout = setTimeout(() => {
      if (done) return;
      done = true;
      try { ws.close(); } catch {}
      reject(new Error('ws timeout'));
    }, DEFAULT_TIMEOUT_MS);

    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      resolve(result);
    };

    ws.on('open', () => {
      ws.send(JSON.stringify(payload));
      if (closeAfterMs) {
        setTimeout(() => {
          try { ws.close(); } catch {}
        }, closeAfterMs);
      }
    });

    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(String(data || ''));
      } catch {
        msg = { type: 'invalid', raw: String(data || '') };
      }
      events.push(msg);
      if (typeof onEvent === 'function') {
        try { onEvent(msg); } catch {}
      }
      if (msg.type === 'end' || msg.type === 'error') {
        try { ws.close(); } catch {}
        finish({ events, terminal: msg.type });
      }
    });

    ws.on('close', () => {
      if (!done) finish({ events, terminal: 'close' });
    });
    ws.on('error', (err) => {
      if (!done) {
        done = true;
        clearTimeout(timeout);
        reject(err);
      }
    });
  });
}

function postJson(port, path, body) {
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      let buffer = '';
      res.on('data', chunk => { buffer += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: buffer }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function run() {
  const { resetToolCount, getToolCount } = setupMockPlugins();

  const app = express();
  const server = http.createServer(app);
  await appChatService.online({ expressApp: app, httpServer: server });

  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const wsUrl = `ws://127.0.0.1:${port}/ios-app/chat/ws`;

  console.log(`Mock server listening on ${port}`);

  // Test 1
  console.log('Test 1: normal WS conversation');
  resetToolCount();
  const t1 = await wsRequest(wsUrl, { requestId: 't1', username: 'u', message: '[t1] hello' });
  assert(t1.events.some(e => e.type === 'ack'), 't1 missing ack');
  assert(t1.events.some(e => e.type === 'status' && e.state === 'thinking'), 't1 missing thinking status');
  assert(t1.events.some(e => e.type === 'delta'), 't1 missing delta');
  assert(t1.events.some(e => e.type === 'end'), 't1 missing end');
  assert(!t1.events.some(e => e.type === 'round_end'), 't1 unexpected round_end');
  assert(!t1.events.some(e => e.type === 'delta' && /toolName/.test(e.content || '')), 't1 leaked tool JSON');

  // Test 2
  console.log('Test 2: tool-triggered conversation');
  resetToolCount();
  let lockCheckDone = false;
  let lockCheckPromiseResolve;
  const lockCheckPromise = new Promise(resolve => { lockCheckPromiseResolve = resolve; });
  const t2 = await wsRequest(wsUrl, { requestId: 't2', username: 'u', message: '[t2] tool' }, {
    onEvent: (msg) => {
      if (lockCheckDone) return;
      if (msg.type !== 'round_end') return;
      lockCheckDone = true;
      wsRequest(wsUrl, { requestId: 't2b', username: 'u', message: '[t1] should-block' })
        .then(result => {
          assert(result.events.some(e => e.type === 'error'), 't2b expected error while round active');
          lockCheckPromiseResolve();
        })
        .catch(err => {
          lockCheckPromiseResolve();
          throw err;
        });
    }
  });
  if (!lockCheckDone) {
    lockCheckPromiseResolve();
  }
  await lockCheckPromise;
  const roundEndIndex = t2.events.findIndex(e => e.type === 'round_end');
  const endIndex = t2.events.findIndex(e => e.type === 'end');
  assert(roundEndIndex >= 0, 't2 missing round_end');
  assert(endIndex > roundEndIndex, 't2 end should occur after round_end');
  assert(t2.events.some((e, idx) => e.type === 'delta' && idx > roundEndIndex && idx < endIndex), 't2 missing delta after round_end');
  const roundEndEvent = t2.events[roundEndIndex];
  const endEvent = t2.events[endIndex];
  assert(roundEndEvent.toolTriggered === true, 't2 round_end toolTriggered should be true');
  assert(endEvent.final === true, 't2 end final should be true');
  assert(endEvent.toolTriggered === false, 't2 end toolTriggered should be false');
  assert(endEvent.round >= 2, `t2 expected end round >=2, got ${endEvent.round}`);
  assert(t2.events.some(e => e.type === 'status' && e.state === 'using_tool'), 't2 missing using_tool status');
  assert(t2.events.some(e => e.type === 'status' && e.state === 'thinking'), 't2 missing thinking status');
  assert(getToolCount() === 1, `t2 expected 1 tool call, got ${getToolCount()}`);
  assert(!t2.events.some(e => e.type === 'delta' && /toolName/.test(e.content || '')), 't2 leaked tool JSON');

  // Test 3
  console.log('Test 3: multi-tool output');
  resetToolCount();
  const t3 = await wsRequest(wsUrl, { requestId: 't3', username: 'u', message: '[t3] multi' });
  assert(t3.events.some(e => e.type === 'round_end'), 't3 missing round_end');
  assert(t3.events.some(e => e.type === 'end' && e.final === true), 't3 missing final end');
  assert(getToolCount() === 1, `t3 expected 1 tool call, got ${getToolCount()}`);
  assert(!t3.events.some(e => e.type === 'delta' && /toolName/.test(e.content || '')), 't3 leaked tool JSON');

  // Test 4
  console.log('Test 4: partial tool JSON');
  resetToolCount();
  const t4 = await wsRequest(wsUrl, { requestId: 't4', username: 'u', message: '[t4] partial' });
  assert(!t4.events.some(e => e.type === 'round_end'), 't4 unexpected round_end');
  assert(!t4.events.some(e => e.type === 'delta' && /toolName/.test(e.content || '')), 't4 leaked tool JSON');

  // Test 5
  console.log('Test 5: WS close mid-reasoning');
  resetToolCount();
  await wsRequest(wsUrl, { requestId: 't5', username: 'u', message: '[t5_long] close' }, { closeAfterMs: 100 });
  await wait(100);
  assert(talker.getState() === 'idle', 't5 talker did not reset to idle');
  const t5b = await wsRequest(wsUrl, { requestId: 't5b', username: 'u', message: '[t1] after-close' });
  assert(t5b.events.some(e => e.type === 'ack'), 't5b missing ack after close');

  // Test 6
  console.log('Test 6: HTTP vs WS mutual exclusion');
  const wsLong = wsRequest(wsUrl, { requestId: 't6ws', username: 'u', message: '[t5_long] ws-active' });
  await wait(50);
  const httpWhileWs = await postJson(port, '/ios-app/chat', { username: 'u', message: '[t1] http-during-ws' });
  assert(httpWhileWs.status === 409, `t6 expected HTTP 409, got ${httpWhileWs.status}`);
  await wait(50);
  await wsLong;

  const httpLong = postJson(port, '/ios-app/chat', { username: 'u', message: '[t6_http_long] http-active' });
  await wait(50);
  const wsDuringHttp = await wsRequest(wsUrl, { requestId: 't6ws2', username: 'u', message: '[t1] ws-during-http' });
  assert(wsDuringHttp.events.some(e => e.type === 'error'), 't6 expected WS error during HTTP');
  await httpLong;

  // Test 7
  console.log('Test 7: error termination');
  const t7 = await wsRequest(wsUrl, { requestId: 't7', username: 'u', message: '[t7_error] err' });
  assert(t7.events.some(e => e.type === 'error'), 't7 missing error event');
  await wait(50);
  assert(talker.getState() === 'idle', 't7 talker did not reset to idle');

  console.log('All tests passed.');
  server.close();
}

run().catch(err => {
  console.error('Harness failed:', err);
  process.exitCode = 1;
});
