const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';

function createTinyPng() {
  return Buffer.from(TINY_PNG_BASE64, 'base64');
}

function createLargeBuffer(bytes) {
  const size = Math.max(0, Number(bytes) || 0);
  return Buffer.alloc(size, 0x7a);
}

module.exports = {
  createTinyPng,
  createLargeBuffer
};
