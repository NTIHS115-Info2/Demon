#!/usr/bin/env node
// Fake runner for iotVisionTurret tests. Reads stdin JSON and returns simple JSON.
const fs = require('fs');
let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (stdin += c));
process.stdin.on('end', () => {
  try {
    const payload = stdin ? JSON.parse(stdin) : {};
    const action = payload.action || payload.op || payload.action;

    if (action === 'ping') {
      console.log(JSON.stringify({ ok: true }));
      process.exit(0);
    }

    if (action === 'infer') {
      // Try to read image_path from payload and decide found based on file contents
      const params = payload.payload || payload;
      const imagePath = params && (params.image_path || params.imagePath || params.source);
      let found = false;
      let w = 100, h = 100;
      try {
        if (imagePath && fs.existsSync(imagePath)) {
          const content = fs.readFileSync(imagePath, 'utf8');
          if (typeof content === 'string' && content.includes('person')) {
            found = true;
          }
        }
      } catch (err) {
        // ignore read errors, return not found
      }

      if (found) {
        console.log(JSON.stringify({ ok: true, found: true, image_size: { w, h }, label: 'person', conf: 0.9, center: { x: 50, y: 50 }, bbox: { x1: 10, y1: 10, x2: 90, y2: 90 } }));
        process.exit(0);
      }

      // Default: not found
      console.log(JSON.stringify({ ok: true, found: false, image_size: { w, h } }));
      process.exit(0);
    }

    console.log(JSON.stringify({ ok: true }));
    process.exit(0);
  } catch (err) {
    console.error('FAKE_RUNNER_ERROR', err && err.message);
    process.exit(1);
  }
});
