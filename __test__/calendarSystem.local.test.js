// === 段落說明：引入測試所需模組 ===
const { LocalCalendarServer } = require('../Server/calendar/server');
const LocalCalendarCache = require('../Server/calendar/localCache');
const SyncWorker = require('../Server/calendar/syncWorker');
const CalendarPlugin = require('../src/plugins/calendarSystem');

// === 段落說明：建立假 CalDAV 客戶端供測試使用 ===
class MockCalDavClient {
  constructor() {
    this.mode = 'mock';
    this.created = [];
    this.updated = [];
    this.deleted = [];
    this.failNextUpsert = false;
  }
  // === 段落說明：模擬遠端建立或更新事件 ===
  async upsertRemoteEvent(record) {
    if (this.failNextUpsert) {
      this.failNextUpsert = false;
      throw new Error('mock upsert failure');
    }
    this.created.push(record.event.uid);
    this.updated.push(record.event.uid);
    return record;
  }
  // === 段落說明：模擬遠端刪除事件 ===
  async deleteRemoteEvent(uid) {
    this.deleted.push(uid);
    return { uid };
  }
  // === 段落說明：模擬遠端列出事件 ===
  async listRemoteEvents() {
    return [];
  }
}

// === 段落說明：建立不會啟動計時器的同步工作者 ===
class ImmediateSyncWorker extends SyncWorker {
  constructor(deps) {
    super({ ...deps, scheduler: { setInterval: () => null, clearInterval: () => {}, setTimeout: () => null, clearTimeout: () => {} } });
  }
  // === 段落說明：覆寫啟動流程避免計時器啟動 ===
  start() {}
}

// === 段落說明：封裝建立伺服器的便利函式 ===
function createServer() {
  const mockClient = new MockCalDavClient();
  const cache = new LocalCalendarCache({ logger: null });
  const worker = new ImmediateSyncWorker({ cache, caldavClient: mockClient, logger: null });
  const server = new LocalCalendarServer({
    cache,
    caldavClient: mockClient,
    syncWorker: worker,
    logger: null,
    secrets: {
      ICLOUD_USER: 'test@example.com',
      ICLOUD_APP_PASSWORD: 'xxxx-xxxx-xxxx-xxxx',
      ICLOUD_CAL_NAME: '測試行事曆',
      TIMEZONE: 'UTC',
      SYNC_INTERVAL_MINUTES: 1,
    },
  });
  return { server, mockClient };
}

// === 段落說明：測試建立與更新事件流程 ===
describe('LocalCalendarServer', () => {
  test('create and update event flow', async () => {
    const { server, mockClient } = createServer();
    await server.start();

    const created = await server.createEvent({
      calendarName: '測試行事曆',
      summary: '建立事件',
      startISO: new Date().toISOString(),
      endISO: new Date(Date.now() + 3600000).toISOString(),
    });

    expect(created.event.summary).toBe('建立事件');
    expect(mockClient.created).toContain(created.event.uid);

    const updated = await server.updateEvent(created.event.uid, { summary: '更新事件' });
    expect(updated.event.summary).toBe('更新事件');

    const listed = await server.listEvents();
    expect(listed).toHaveLength(1);

    await server.stop();
  });

  test('rollback cache when remote create fails', async () => {
    const { server, mockClient } = createServer();
    await server.start();

    mockClient.failNextUpsert = true;
    await expect(
      server.createEvent({
        calendarName: '測試行事曆',
        summary: '失敗事件',
        startISO: new Date().toISOString(),
        endISO: new Date(Date.now() + 3600000).toISOString(),
      })
    ).rejects.toThrow('mock upsert failure');

    const events = await server.listEvents();
    expect(events).toHaveLength(0);

    await server.stop();
  });

  test('restore previous record when remote update fails', async () => {
    const { server, mockClient } = createServer();
    await server.start();

    const created = await server.createEvent({
      calendarName: '測試行事曆',
      summary: '原始事件',
      startISO: new Date().toISOString(),
      endISO: new Date(Date.now() + 3600000).toISOString(),
    });

    mockClient.failNextUpsert = true;
    await expect(server.updateEvent(created.event.uid, { summary: '失敗更新' })).rejects.toThrow('mock upsert failure');

    const current = await server.readEvent(created.event.uid);
    expect(current.event.summary).toBe('原始事件');

    await server.stop();
  });

  test('delete event flow', async () => {
    const { server, mockClient } = createServer();
    await server.start();

    const created = await server.createEvent({
      calendarName: '測試行事曆',
      summary: '待刪除事件',
      startISO: new Date().toISOString(),
      endISO: new Date(Date.now() + 3600000).toISOString(),
    });

    await server.deleteEvent(created.event.uid);
    expect(mockClient.deleted).toContain(created.event.uid);

    await server.stop();
  });
});

// === 段落說明：測試插件介面行為 ===
describe('calendarSystem plugin', () => {
  test('send API should route commands', async () => {
    const { server } = createServer();

    // === 段落說明：透過啟動選項注入測試專用伺服器 ===
    await CalendarPlugin.online({ serverFactory: () => server, serverOptions: {} });

    const created = await CalendarPlugin.send({
      action: 'create',
      payload: {
        calendarName: '測試行事曆',
        summary: '插件建立',
        startISO: new Date().toISOString(),
        endISO: new Date(Date.now() + 3600000).toISOString(),
      },
    });

    expect(created.event.summary).toBe('插件建立');

    const status = await CalendarPlugin.send({ action: 'status' });
    expect(status.started).toBe(true);

    await CalendarPlugin.offline();

    // === 段落說明：重設策略設定以回復預設伺服器工廠 ===
    await CalendarPlugin.updateStrategy('local', { serverFactory: null });
    await server.stop();
  });
});

// === 段落說明：測試同步工作者在全量同步時的刪除行為 ===
describe('SyncWorker', () => {
  test('runFullSync prunes local records missing from remote snapshot', async () => {
    const cache = new LocalCalendarCache({ logger: null, nowProvider: () => new Date('2024-01-01T00:00:00.000Z') });

    const remoteEvent = uid => ({
      event: {
        uid,
        calendarName: '測試行事曆',
        summary: `Remote ${uid}`,
        startISO: '2024-01-01T00:00:00.000Z',
        endISO: '2024-01-01T01:00:00.000Z',
      },
      status: 'synced',
      etag: `etag-${uid}`,
      url: `https://example.com/${uid}.ics`,
      lastModified: '2024-01-01T00:00:00.000Z',
    });

    cache.applyRemoteSnapshot([remoteEvent('keep'), remoteEvent('remove')]);

    const localDraft = cache.createEvent({
      calendarName: '測試行事曆',
      summary: '本地草稿',
      startISO: '2024-01-03T00:00:00.000Z',
      endISO: '2024-01-03T01:00:00.000Z',
    });

    const mockClient = {
      listRemoteEvents: jest.fn().mockResolvedValue([remoteEvent('keep')]),
      syncToken: 'token-after-full',
    };

    const worker = new SyncWorker({
      cache,
      caldavClient: mockClient,
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      scheduler: { setInterval: () => null, clearInterval: () => {}, setTimeout: () => null, clearTimeout: () => {} },
    });

    await worker.runFullSync();

    expect(mockClient.listRemoteEvents).toHaveBeenCalled();
    expect(cache.getEvent('keep')).not.toBeNull();
    expect(cache.getEvent('remove')).toBeNull();

    const remaining = cache.listEvents();
    const remainingUids = remaining.map(record => record.event.uid);
    expect(remainingUids).toContain('keep');
    expect(remainingUids).toContain(localDraft.event.uid);
    expect(remainingUids).not.toContain('remove');
  });
});
