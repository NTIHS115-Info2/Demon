const { EventEmitter } = require('events');
const fetch = require('node-fetch');

class FakeDeviceClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this.baseUrl = options.baseUrl;
    this.deviceId = options.deviceId || 'fake-device';
    this.imageFactory = options.imageFactory;
    this.uploadBehavior = options.uploadBehavior || { type: 'normal' };
    this.history = {
      moves: [],
      captures: [],
      irSends: [],
      pulls: [],
      uploads: [],
      invalidMoves: []
    };
    this.running = false;
    this.activePulls = new Set();
    this.activeUploads = new Set();
    this.idleAbortMs = Number.isFinite(options.idleAbortMs) ? options.idleAbortMs : 2000;
  }

  async register() {
    const res = await fetch(`${this.baseUrl}/iot/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: this.deviceId })
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`register failed: ${res.status} ${text}`);
    }
    return res.json();
  }

  startPolling() {
    this.running = true;
    this.pollLoopPromise = this.pollLoop();
  }

  async pollLoop() {
    while (this.running) {
      try {
        await this.pullOnce({ abortAfterMs: this.idleAbortMs });
      } catch (err) {
        if (this.running) {
          this.emit('error', err);
        }
      }
    }
  }

  async pullOnce(options = {}) {
    const controller = new AbortController();
    const abortAfterMs = Number.isFinite(options.abortAfterMs) ? options.abortAfterMs : null;
    let timeoutId = null;

    if (abortAfterMs) {
      timeoutId = setTimeout(() => controller.abort(), abortAfterMs);
    }

    this.activePulls.add(controller);

    try {
      const res = await fetch(`${this.baseUrl}/iot/pull`, {
        method: 'GET',
        signal: controller.signal
      });

      this.history.pulls.push({ status: res.status, time: Date.now() });

      if (res.status === 200) {
        const payload = await res.json();
        const commands = Array.isArray(payload?.commands) ? payload.commands : [];
        await this.handleCommands(commands);
      }

      return res;
    } catch (err) {
      if (err && err.name === 'AbortError') {
        this.history.pulls.push({ status: 'aborted', time: Date.now() });
        return null;
      }
      throw err;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      this.activePulls.delete(controller);
    }
  }

  async handleCommands(commands) {
    for (const command of commands) {
      if (!command || !command.type) continue;
      if (command.type === 'move') {
        const yaw = Number(command.yaw);
        const pitch = Number(command.pitch);
        this.history.moves.push({ yaw, pitch, time: Date.now() });
        if (Number.isFinite(pitch) && pitch < 0) {
          this.history.invalidMoves.push({ yaw, pitch, time: Date.now() });
        }
        continue;
      }

      if (command.type === 'capture') {
        const imageId = command.image_id;
        this.history.captures.push({ imageId, time: Date.now() });
        await this.handleCapture(imageId);
        continue;
      }

      if (command.type === 'ir_send') {
        this.history.irSends.push({
          device: command.device,
          code: command.code,
          time: Date.now()
        });
      }
    }
  }

  async handleCapture(imageId) {
    if (!imageId) return;

    if (typeof this.uploadBehavior === 'function') {
      await this.uploadBehavior(imageId, this);
      return;
    }

    const behavior = this.uploadBehavior || { type: 'normal' };
    const type = String(behavior.type || 'normal').toLowerCase();

    if (type === 'drop') return;

    if (type === 'out_of_order' || type === 'out-of-order' || type === 'outoforder') {
      await this.uploadImage(imageId, behavior);
      if (behavior.duplicate) {
        const gap = Number.isFinite(behavior.gapMs) ? behavior.gapMs : 10;
        await new Promise((resolve) => setTimeout(resolve, gap));
        await this.uploadImage(imageId, behavior);
      }
      return;
    }

    if (type === 'delay') {
      const delayMs = Number.isFinite(behavior.delayMs) ? behavior.delayMs : 0;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      await this.uploadImage(imageId, behavior);
      return;
    }

    if (type === 'duplicate') {
      await this.uploadImage(imageId, behavior);
      const gap = Number.isFinite(behavior.gapMs) ? behavior.gapMs : 10;
      await new Promise((resolve) => setTimeout(resolve, gap));
      await this.uploadImage(imageId, behavior);
      return;
    }

    await this.uploadImage(imageId, behavior);
  }

  async uploadImage(imageId, behavior = {}) {
    const buffer = this.imageFactory.createTinyPng();
    const contentType = behavior.contentType || 'image/png';
    return this.upload(imageId, buffer, { contentType });
  }

  async upload(imageId, buffer, options = {}) {
    const controller = new AbortController();
    this.activeUploads.add(controller);

    try {
      const res = await fetch(`${this.baseUrl}/iot/upload?image_id=${encodeURIComponent(imageId)}`, {
        method: 'POST',
        headers: { 'Content-Type': options.contentType || 'application/octet-stream' },
        body: buffer,
        signal: controller.signal
      });

      this.history.uploads.push({
        imageId,
        status: res.status,
        contentType: options.contentType,
        time: Date.now()
      });

      return res;
    } catch (err) {
      if (err && err.name === 'AbortError') return null;
      throw err;
    } finally {
      this.activeUploads.delete(controller);
    }
  }

  async preUpload(imageId, buffer, options = {}) {
    return this.upload(imageId, buffer, options);
  }

  async stop() {
    this.running = false;

    for (const controller of this.activePulls) {
      controller.abort();
    }
    for (const controller of this.activeUploads) {
      controller.abort();
    }

    if (this.pollLoopPromise) {
      try {
        await this.pollLoopPromise;
      } catch (err) {
        if (!(err && err.name === 'AbortError')) throw err;
      }
    }
  }

  getActivePulls() {
    return this.activePulls.size;
  }
}

module.exports = {
  FakeDeviceClient
};
