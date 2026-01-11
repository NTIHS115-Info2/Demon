const fs = require('fs');
const path = require('path');
const express = require('express');
const { ulid } = require('ulid');
const Logger = require('../../../../utils/logger');
const PM = require('../../../../core/pluginsManager');

// 建立記錄器，專門記錄 ttsArtifact 本地策略流程
const logger = new Logger('ttsArtifact-local');

// 設定此策略的啟動優先度
const priority = 60;

// 設定 artifact 根目錄，固定使用 data/artifacts/tts
const ARTIFACT_ROOT = path.resolve(__dirname, '../../../../..', 'data', 'artifacts', 'tts');

// 設定 HTTP 服務監聽預設值與環境變數
const DEFAULT_LISTEN_HOST = '0.0.0.0';
const DEFAULT_LISTEN_PORT = 8090;

// 設定音訊格式參數，假設 ttsEngine 輸出為 PCM s16le
const DEFAULT_BITS_PER_SAMPLE = 16;

// 保存 HTTP server 與狀態，便於線上/離線管理
let app = null;
let server = null;
let isOnline = false;
let currentHost = DEFAULT_LISTEN_HOST;
let currentPort = DEFAULT_LISTEN_PORT;
let currentPublicBaseUrl = null;

// 建立 artifact 快取索引，提升查詢速度
const artifactIndex = new Map();

// 建立錯誤訊息模板，確保錯誤可追蹤 artifact_id
const ERROR_CODES = {
  NOT_FOUND: 'ARTIFACT_NOT_FOUND',
  INVALID_STATUS: 'ARTIFACT_INVALID_STATUS',
  FILE_IO: 'ARTIFACT_FILE_IO_ERROR',
  METADATA_IO: 'ARTIFACT_METADATA_IO_ERROR',
  HEADER_PATCH: 'ARTIFACT_HEADER_PATCH_ERROR',
  TTS_ENGINE: 'ARTIFACT_TTS_ENGINE_ERROR'
};

// 將日期格式化為 YYYY/MM/DD 的資料夾結構
function buildDatePath(date = new Date()) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return { year, month, day };
}

// 建立 WAV header，供 placeholder 與最終 patch 使用
function buildWavHeader({ sampleRate, channels, bitsPerSample, dataSize }) {
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const buffer = Buffer.alloc(44);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  return buffer;
}

// 建立 artifact 的目錄與檔案路徑
function buildArtifactPaths(artifactId, date = new Date()) {
  const { year, month, day } = buildDatePath(date);
  const artifactDir = path.join(ARTIFACT_ROOT, year, month, day, artifactId);
  return {
    artifactDir,
    audioPath: path.join(artifactDir, 'audio.wav'),
    metadataPath: path.join(artifactDir, 'artifact.json')
  };
}

// 統一建立可公開存取的 URL
function buildPublicUrl(artifactId) {
  const baseUrl = currentPublicBaseUrl
    || process.env.TTS_ARTIFACT_PUBLIC_BASE_URL
    || `http://localhost:${currentPort}`;
  return `${baseUrl}/media/${artifactId}/file`;
}

// 寫入 metadata 到檔案，確保 artifact 狀態落地保存
async function writeMetadata(metadataPath, metadata) {
  const payload = JSON.stringify(metadata, null, 2);
  await fs.promises.writeFile(metadataPath, payload, 'utf8');
}

// 計算音訊長度，轉換為毫秒
function calculateDurationMs(dataBytes, sampleRate, channels, bitsPerSample) {
  const bytesPerSample = bitsPerSample / 8;
  const totalSamples = dataBytes / (bytesPerSample * channels);
  return Math.round((totalSamples / sampleRate) * 1000);
}

// 解析 Range header，支援 bytes= 起迄格式
function parseRange(rangeHeader, fileSize) {
  const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader || '');
  if (!match) return null;
  const start = match[1] ? parseInt(match[1], 10) : 0;
  const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
  if (Number.isNaN(start) || Number.isNaN(end) || start > end) return null;
  return { start, end };
}

// 嘗試在檔案系統中尋找指定 artifact_id 的路徑
async function resolveArtifactPath(artifactId) {
  // 優先從記憶體快取查詢，減少磁碟掃描
  const cached = artifactIndex.get(artifactId);
  if (cached) {
    return cached;
  }

  // 若快取不存在，掃描日期層級目錄尋找目標
  try {
    if (!fs.existsSync(ARTIFACT_ROOT)) {
      return null;
    }
    const years = await fs.promises.readdir(ARTIFACT_ROOT, { withFileTypes: true });
    for (const year of years) {
      if (!year.isDirectory()) continue;
      const yearPath = path.join(ARTIFACT_ROOT, year.name);
      const months = await fs.promises.readdir(yearPath, { withFileTypes: true });
      for (const month of months) {
        if (!month.isDirectory()) continue;
        const monthPath = path.join(yearPath, month.name);
        const days = await fs.promises.readdir(monthPath, { withFileTypes: true });
        for (const day of days) {
          if (!day.isDirectory()) continue;
          const artifactDir = path.join(monthPath, day.name, artifactId);
          if (fs.existsSync(artifactDir)) {
            const result = {
              artifactDir,
              audioPath: path.join(artifactDir, 'audio.wav'),
              metadataPath: path.join(artifactDir, 'artifact.json')
            };
            artifactIndex.set(artifactId, result);
            return result;
          }
        }
      }
    }
  } catch (err) {
    logger.error(`[ttsArtifact] 掃描 artifact 失敗: ${err.message || err}`);
  }
  return null;
}

// 讀取並解析 metadata，供 HTTP route 與狀態判斷使用
async function readMetadata(metadataPath) {
  const raw = await fs.promises.readFile(metadataPath, 'utf8');
  return JSON.parse(raw);
}

// 建立並寫入 WAV header placeholder，確保檔案即時存在
async function createAudioFile(audioPath, sampleRate, channels) {
  const header = buildWavHeader({
    sampleRate,
    channels,
    bitsPerSample: DEFAULT_BITS_PER_SAMPLE,
    dataSize: 0
  });
  await fs.promises.writeFile(audioPath, header);
}

// 回頭 patch WAV header，更新正確的資料長度
async function patchWavHeader(audioPath, sampleRate, channels, dataSize) {
  const header = buildWavHeader({
    sampleRate,
    channels,
    bitsPerSample: DEFAULT_BITS_PER_SAMPLE,
    dataSize
  });
  const handle = await fs.promises.open(audioPath, 'r+');
  try {
    await handle.write(header, 0, header.length, 0);
  } finally {
    await handle.close();
  }
}

// 建立可讀取的 HTTP 服務與路由
function buildExpressApp() {
  const _app = express();

  // HTTP route：支援 streaming / Range 讀取的音檔下載
  _app.get('/media/:artifact_id/file', async (req, res) => {
    const artifactId = req.params.artifact_id;

    // 檢查 artifact 是否存在，避免無效請求
    let paths;
    try {
      paths = await resolveArtifactPath(artifactId);
      if (!paths) {
        logger.warn(`[ttsArtifact] 找不到 artifact: ${artifactId}`);
        return res.status(404).json({
          error: ERROR_CODES.NOT_FOUND,
          message: `找不到 artifact (${artifactId})`
        });
      }
    } catch (err) {
      logger.error(`[ttsArtifact] 查詢 artifact 失敗 (${artifactId}): ${err.message || err}`);
      return res.status(500).json({
        error: ERROR_CODES.FILE_IO,
        message: `讀取 artifact 失敗 (${artifactId})`
      });
    }

    // 讀取 metadata 以確認狀態
    let metadata;
    try {
      metadata = await readMetadata(paths.metadataPath);
    } catch (err) {
      logger.error(`[ttsArtifact] 讀取 metadata 失敗 (${artifactId}): ${err.message || err}`);
      return res.status(500).json({
        error: ERROR_CODES.METADATA_IO,
        message: `讀取 metadata 失敗 (${artifactId})`
      });
    }

    // 若狀態異常則拒絕讀取
    if (!['creating', 'ready'].includes(metadata.status)) {
      logger.warn(`[ttsArtifact] artifact 狀態異常 (${artifactId}): ${metadata.status}`);
      return res.status(409).json({
        error: ERROR_CODES.INVALID_STATUS,
        message: `artifact 狀態異常 (${artifactId})`
      });
    }

    // 檢查音檔是否存在，避免串流失敗
    if (!fs.existsSync(paths.audioPath)) {
      logger.warn(`[ttsArtifact] 音檔不存在 (${artifactId})`);
      return res.status(404).json({
        error: ERROR_CODES.NOT_FOUND,
        message: `音檔不存在 (${artifactId})`
      });
    }

    // 計算當前檔案大小，支援增量內容讀取
    let stat;
    try {
      stat = await fs.promises.stat(paths.audioPath);
    } catch (err) {
      logger.error(`[ttsArtifact] 取得檔案資訊失敗 (${artifactId}): ${err.message || err}`);
      return res.status(500).json({
        error: ERROR_CODES.FILE_IO,
        message: `取得檔案資訊失敗 (${artifactId})`
      });
    }

    const fileSize = stat.size;
    const range = req.headers.range;

    // Range 支援：依目前檔案大小回應部分內容
    if (range) {
      const parsed = parseRange(range, fileSize);
      if (!parsed || parsed.start >= fileSize) {
        res.status(416);
        res.setHeader('Content-Range', `bytes */${fileSize}`);
        return res.end();
      }

      const start = parsed.start;
      const end = Math.min(parsed.end, fileSize - 1);
      const chunkSize = end - start + 1;

      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', chunkSize);
      res.setHeader('Content-Type', 'audio/wav');

      const stream = fs.createReadStream(paths.audioPath, { start, end });
      stream.on('error', (err) => {
        logger.error(`[ttsArtifact] Range 讀取失敗 (${artifactId}): ${err.message || err}`);
        if (!res.headersSent) {
          res.status(500).json({
            error: ERROR_CODES.FILE_IO,
            message: `Range 讀取失敗 (${artifactId})`
          });
        } else {
          res.end();
        }
      });
      return stream.pipe(res);
    }

    // 未指定 Range 時，回傳目前完整檔案內容
    res.status(200);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', fileSize);
    res.setHeader('Content-Type', 'audio/wav');

    const stream = fs.createReadStream(paths.audioPath);
    stream.on('error', (err) => {
      logger.error(`[ttsArtifact] 串流讀取失敗 (${artifactId}): ${err.message || err}`);
      if (!res.headersSent) {
        res.status(500).json({
          error: ERROR_CODES.FILE_IO,
          message: `串流讀取失敗 (${artifactId})`
        });
      } else {
        res.end();
      }
    });
    return stream.pipe(res);
  });

  return _app;
}

module.exports = {
  priority,
  name: 'ttsArtifact',

  /**
   * 啟動插件並建立 HTTP route
   * @param {Object} options
   */
  async online(options = {}) {
    // 避免重複啟動，確保 HTTP server 單例
    if (isOnline) {
      logger.info('[ttsArtifact] 插件已經在線上，跳過重複啟動');
      return true;
    }

    // 取得監聽參數，允許透過 options 或環境變數覆蓋
    const host = options.host || process.env.TTS_ARTIFACT_HOST || DEFAULT_LISTEN_HOST;
    const port = Number(options.port || process.env.TTS_ARTIFACT_PORT || DEFAULT_LISTEN_PORT);
    const publicBaseUrl = options.publicBaseUrl || process.env.TTS_ARTIFACT_PUBLIC_BASE_URL || null;

    try {
      app = buildExpressApp();
      server = app.listen(port, host, () => {
        logger.info(`[ttsArtifact] Listening on http://${host}:${port}/media/:artifact_id/file`);
      });
      currentHost = host;
      currentPort = port;
      currentPublicBaseUrl = publicBaseUrl;
      isOnline = true;
      return true;
    } catch (err) {
      logger.error(`[ttsArtifact] HTTP 服務啟動失敗: ${err.message || err}`);
      isOnline = false;
      throw err;
    }
  },

  /**
   * 關閉插件並釋放 HTTP server
   */
  async offline() {
    // 若尚未啟動則直接回報，避免拋錯
    if (!isOnline || !server) {
      logger.info('[ttsArtifact] 插件已經離線，無需重複關閉');
      return 0;
    }

    try {
      await new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      app = null;
      server = null;
      isOnline = false;
      logger.info('[ttsArtifact] 插件已成功離線');
      return 1;
    } catch (err) {
      logger.error(`[ttsArtifact] 插件離線失敗: ${err.message || err}`);
      throw err;
    }
  },

  /**
   * 重啟插件
   * @param {Object} options
   */
  async restart(options = {}) {
    // 先關閉再啟動，以確保狀態完整清理
    await this.offline();
    await this.online(options);
  },

  /**
   * 回傳目前服務狀態
   * @returns {Promise<number>}
   */
  async state() {
    // 透過 isOnline 判斷狀態，保持介面一致
    return isOnline ? 1 : 0;
  },

  /**
   * 呼叫 ttsEngine 並建立可即時讀取的 artifact
   * @param {Object|string} data
   * @returns {Promise<Object>}
   */
  async send(data = {}) {
    // 解析輸入文字，避免傳入錯誤格式
    const text = typeof data === 'string'
      ? data
      : (data?.text || data?.message || data?.content);
    if (!text) {
      logger.error('[ttsArtifact] send 缺少 text');
      return { error: 'ttsArtifact 缺少 text' };
    }

    // 確認 ttsEngine 已上線，保持責任邊界清楚
    const ttsState = await PM.getPluginState('ttsEngine');
    if (ttsState !== 1) {
      const message = `ttsEngine 未上線 (狀態: ${ttsState})`;
      logger.warn(`[ttsArtifact] ${message}`);
      return { error: `${ERROR_CODES.TTS_ENGINE}: ${message}` };
    }

    // 確認 HTTP server 是否已上線，避免產生不可存取的 URL
    if (!isOnline) {
      logger.warn('[ttsArtifact] HTTP 服務未啟動，URL 可能無法即時存取');
    }

    // 呼叫 ttsEngine 建立 session，準備接收音訊串流
    let session;
    try {
      session = await PM.send('ttsEngine', { text });
    } catch (err) {
      logger.error(`[ttsArtifact] 呼叫 ttsEngine 失敗: ${err.message || err}`);
      return { error: `${ERROR_CODES.TTS_ENGINE}: ${err.message || err}` };
    }

    if (!session?.stream || !session?.metadataPromise) {
      logger.error('[ttsArtifact] 無法取得 ttsEngine stream 或 metadata');
      return { error: `${ERROR_CODES.TTS_ENGINE}: ttsEngine 回傳格式異常` };
    }

    // 取得 ttsEngine 的 metadata，準備建立 WAV header
    let engineMetadata;
    try {
      engineMetadata = await session.metadataPromise;
    } catch (err) {
      logger.error(`[ttsArtifact] 取得 ttsEngine metadata 失敗: ${err.message || err}`);
      return { error: `${ERROR_CODES.TTS_ENGINE}: ${err.message || err}` };
    }

    // 建立 artifact 資料夾與檔案路徑
    const artifactId = ulid();
    const paths = buildArtifactPaths(artifactId);
    const sampleRate = Number(engineMetadata.sample_rate || 0);
    const channels = Number(engineMetadata.channels || 1);

    // 驗證必要的音訊參數，避免產生不合法 WAV 檔案
    if (!sampleRate || Number.isNaN(sampleRate)) {
      const message = `ttsEngine 回傳 sample_rate 無效 (${sampleRate})`;
      logger.error(`[ttsArtifact] ${message}`);
      return { error: `${ERROR_CODES.TTS_ENGINE}: ${message}` };
    }

    // 組合 metadata 內容並落地保存
    const publicUrl = buildPublicUrl(artifactId);
    const metadata = {
      artifact_id: artifactId,
      format: 'wav',
      sample_rate: sampleRate,
      channels,
      status: 'creating',
      duration_ms: null,
      file_path: paths.audioPath,
      public_url: publicUrl
    };

    try {
      await fs.promises.mkdir(paths.artifactDir, { recursive: true });
      await createAudioFile(paths.audioPath, sampleRate, channels);
      await writeMetadata(paths.metadataPath, metadata);
      artifactIndex.set(artifactId, paths);
    } catch (err) {
      logger.error(`[ttsArtifact] 建立檔案失敗 (${artifactId}): ${err.message || err}`);
      return { error: `${ERROR_CODES.FILE_IO}: ${err.message || err}`, artifact_id: artifactId };
    }

    // 開始串流寫入 PCM chunks，並追蹤資料大小
    let dataBytes = 0;
    let writeStream = null;
    let streamError = null;

    try {
      writeStream = fs.createWriteStream(paths.audioPath, { flags: 'a' });
      writeStream.on('error', (err) => {
        streamError = err;
        logger.error(`[ttsArtifact] writeStream 錯誤 (${artifactId}): ${err.message || err}`);
        if (!session.stream.destroyed) {
          session.stream.destroy(err);
        }
      });

      for await (const chunk of session.stream) {
        if (streamError) break;
        if (!chunk) continue;
        dataBytes += chunk.length;
        if (!writeStream.write(chunk)) {
          await new Promise(resolve => writeStream.once('drain', resolve));
        }
      }
    } catch (err) {
      streamError = err;
      logger.error(`[ttsArtifact] 串流寫入失敗 (${artifactId}): ${err.message || err}`);
    } finally {
      if (writeStream) {
        await new Promise((resolve) => writeStream.end(resolve));
      }
    }

    // 嘗試 patch WAV header，確保檔案可用於播放
    let patchError = null;
    try {
      await patchWavHeader(paths.audioPath, sampleRate, channels, dataBytes);
    } catch (err) {
      patchError = err;
      logger.error(`[ttsArtifact] WAV header patch 失敗 (${artifactId}): ${err.message || err}`);
    }

    // 計算 duration 並更新 metadata 狀態
    const durationMs = calculateDurationMs(dataBytes, sampleRate, channels, DEFAULT_BITS_PER_SAMPLE);
    const finalStatus = streamError || patchError ? 'error' : 'ready';
    const finalMetadata = {
      ...metadata,
      status: finalStatus,
      duration_ms: durationMs
    };

    try {
      await writeMetadata(paths.metadataPath, finalMetadata);
    } catch (err) {
      logger.error(`[ttsArtifact] metadata 落地失敗 (${artifactId}): ${err.message || err}`);
      return { error: `${ERROR_CODES.METADATA_IO}: ${err.message || err}`, artifact_id: artifactId };
    }

    // 若發生串流或 header patch 錯誤，回傳可追蹤錯誤訊息
    if (streamError || patchError) {
      const message = streamError?.message || patchError?.message || '未知錯誤';
      const code = streamError ? ERROR_CODES.FILE_IO : ERROR_CODES.HEADER_PATCH;
      return { error: `${code}: ${message}`, artifact_id: artifactId };
    }

    // 成功回傳 artifact 資訊與下載 URL
    return {
      artifact_id: artifactId,
      url: publicUrl,
      format: 'wav',
      duration_ms: durationMs
    };
  }
};
