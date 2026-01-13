#!/usr/bin/env node
const path = require('path');
const http = require('http');
const express = require('express');

(async () => {
  try {
    console.log('啟動 iotVisionTurret 手動驗證腳本');

    const turret = require('../../src/plugins/iotVisionTurret');
    const app = express();

    const fakeRunnerPath = path.resolve(__dirname, 'fake_runner.js');

    console.log('呼叫 plugin.online()...');
    // create a fake weights file to satisfy existence checks
    const fakeWeightsPath = path.resolve(__dirname, 'fake.weights');
    const fs = require('fs');
    try { fs.writeFileSync(fakeWeightsPath, 'fake'); } catch (e) { /* ignore */ }

    await turret.online({
      expressApp: app,
      mode: 'local',
      pythonPath: 'node',
      runnerPath: fakeRunnerPath,
      yoloWeightsPath: fakeWeightsPath,
      yoloTarget: 'person'
    });
    console.log('plugin 已上線');

    const server = app.listen(0);
    const port = server.address().port;
    console.log('Express server 已啟動，port=', port);

    function httpRequest(method, urlPath, headers = {}, body = null) {
      return new Promise((resolve, reject) => {
        const options = {
          method,
          hostname: '127.0.0.1',
          port,
          path: urlPath,
          headers
        };
        const req = http.request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
      });
    }

    // 1) 註冊裝置
    const deviceId = 'turret-001';
    console.log('\n[STEP] POST /iot/register ->', { device_id: deviceId });
    const regRes = await httpRequest('POST', '/iot/register', { 'Content-Type': 'application/json' }, JSON.stringify({ device_id: deviceId }));
    console.log('[RESULT] /iot/register', regRes.statusCode, regRes.body);

    // 啟動裝置模擬：長輪詢 /iot/pull 並回應 capture 指令
    let captureCount = 0;
    let deviceRunning = true;
    (async function deviceLoop() {
      while (deviceRunning) {
        try {
          const res = await httpRequest('GET', '/iot/pull');
          if (res.statusCode === 200) {
            let parsed = {};
            try { parsed = JSON.parse(res.body); } catch (e) {}
            const cmds = parsed.commands || [];
            for (const cmd of cmds) {
              console.log('[DEVICE] Got command', cmd);
              if (cmd.type === 'capture') {
                captureCount += 1;
                // After 2 captures, send an image that contains 'person' to trigger detection
                const content = captureCount >= 2 ? 'this-image-has-person' : 'no-person-here';
                const buf = Buffer.from(content);
                const upload = await httpRequest('POST', `/iot/upload?image_id=${cmd.image_id}`, { 'Content-Type': 'application/octet-stream', 'Content-Length': buf.length }, buf);
                console.log('[DEVICE] upload result', upload.statusCode, upload.body);
              } else if (cmd.type === 'move') {
                console.log('[DEVICE] move ->', cmd.yaw, cmd.pitch);
              } else if (cmd.type === 'ir_send') {
                console.log('[DEVICE] ir_send ->', cmd.profile);
              }
            }
          } else if (res.statusCode === 204) {
            // no content; just loop
          } else {
            console.log('[DEVICE] pull status', res.statusCode, res.body);
          }
        } catch (err) {
          console.warn('[DEVICE] pull error', err && err.message);
        }
        // small delay to avoid tight loop
        await new Promise((r) => setTimeout(r, 200));
      }
    })();

    // 等待一點讓 deviceLoop 開始
    await new Promise((r) => setTimeout(r, 200));

    // 2) 呼叫 plugin.send() 開始掃描/追蹤流程
    console.log('\n[STEP] 呼叫 turret.send() 開始掃描/追蹤流程');
    const sendResult = await turret.send({});
    console.log('[RESULT] turret.send ->', sendResult);

    // 小等一下，讓 deviceLoop 處理完剩餘工作
    await new Promise((r) => setTimeout(r, 500));
    deviceRunning = false;

    console.log('\n關閉 plugin 與 server');
    await turret.offline();
    server.close();
    console.log('完成');
  } catch (err) {
    console.error('發生錯誤：', err && err.stack ? err.stack : err);
    process.exit(1);
  }
})();
