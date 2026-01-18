# IoT Vision Turret E2E Tests

## Run

- Full suite: `npm test -- __test__/iotVisionTurret`
- Single file: `npm test -- __test__/iotVisionTurret/e2e.spec.js`

The repo test script already runs Jest with `--detectOpenHandles` and `--runInBand`.

## Structure

```
__test__/iotVisionTurret/
  harness/
    startExpressApp.js
    mockRoboflowServer.js
    fakeDeviceClient.js
    imageFactory.js
  e2e.spec.js
  unit.spec.js
  README.md
```

## Mock Roboflow scenarios

`mockRoboflowServer.js` exposes helpers:

- `buildRoboflowResponse({ predictions, imageSize })`
- `makePrediction({ x, y, confidence, klass })`
- `buildYoloLikeResponse()`

Use `enqueueResponse()` to script per-request responses and `setDefaultResponse()` for the fallback.

## Environment

Tests inject Roboflow settings via:

```js
await strategy.online({
  expressApp,
  roboflow: {
    baseUrl,
    apiKey,
    workspace,
    workflowId,
    targetClass,
    timeoutMs,
    maxResponseBytes
  }
});
```

Precedence: `online({ roboflow })` overrides env vars; env vars are fallback defaults.
No external services or environment variables are required.

## Route idempotency

Calling `online()` again with the same Express app does not re-install routes.
If you pass a new app instance after `offline()`, routes will be registered on the new app.

## Expectations

Each test asserts:

- `send()` resolves within a bounded time
- no move command has `pitch < 0`
- no hung long-poll requests after stop/offline
- device commands are not replayed after a job finishes

Run with `--detectOpenHandles` (already in `npm test`) to catch leaks.

## Limitations

- Single-device behavior only (plugin global state is not multi-device safe).
- Upload cleanup and long-poll reset behavior are enforced by tests; current implementation may fail those assertions.
