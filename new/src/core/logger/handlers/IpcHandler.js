class IpcHandler {
  constructor(options = {}) {
    this.options = options;
  }

  emit() {
    // Reserved for future IPC logging hooks.
  }
}

module.exports = IpcHandler;
