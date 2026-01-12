const crypto = require('crypto');

// ───────────────────────────────────────────────
// 區段：ULID 常數定義
// 用途：提供時間與亂數編碼所需的字元表
// ───────────────────────────────────────────────
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_LENGTH = 10;
const RANDOM_LENGTH = 16;

// ───────────────────────────────────────────────
// 區段：時間編碼
// 用途：將 48-bit 毫秒時間轉換為 Crockford Base32 字串
// ───────────────────────────────────────────────
function encodeTime(time) {
  let value = Number(time);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('ULID 時間戳記無效');
  }

  let output = '';
  for (let i = 0; i < TIME_LENGTH; i += 1) {
    const mod = value % 32;
    output = ENCODING[mod] + output;
    value = Math.floor(value / 32);
  }
  return output;
}

// ───────────────────────────────────────────────
// 區段：亂數編碼
// 用途：將 80-bit 亂數轉換為 Crockford Base32 字串
// ───────────────────────────────────────────────
function encodeRandom(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length !== 10) {
    throw new Error(`ULID 亂數長度錯誤：預期 10 bytes，實際收到 ${bytes && typeof bytes.length === 'number' ? bytes.length : '未知'} bytes`);
  }

  let randomValue = 0n;
  for (const byte of bytes) {
    randomValue = (randomValue << 8n) + BigInt(byte);
  }

  let output = '';
  for (let i = RANDOM_LENGTH - 1; i >= 0; i -= 1) {
    const shift = BigInt(i * 5);
    // 使用 31n (0x1F) 遮罩擷取 5-bit 區塊以進行 base-32 編碼
    // 5 bits 可表示 0-31，對應 Crockford Base32 字元集的 32 個字元
    const index = Number((randomValue >> shift) & 31n);
    output += ENCODING[index];
  }
  return output;
}

// ───────────────────────────────────────────────
// 區段：ULID 產生器
// 用途：回傳可排序的 ULID 字串，供追蹤與請求識別使用
// ───────────────────────────────────────────────
function generateUlid() {
  try {
    const timePart = encodeTime(Date.now());
    const randomPart = encodeRandom(crypto.randomBytes(10));
    return `${timePart}${randomPart}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`ULID 產生失敗：${message}`);
  }
}

module.exports = {
  generateUlid
};
