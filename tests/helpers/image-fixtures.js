// Structural fixtures for preflight tests; native decoder tests use real Canvas images.
export function jpegHeader(width = 4000, height = 3000, marker = 0xc0) {
  return new Uint8Array([0xff, 0xd8, 0xff, marker, 0, 11, 8,
    height >> 8, height & 255, width >> 8, width & 255, 1, 1, 0x11, 0,
    0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0, 0xff, 0xd9]);
}

export function pngChunk(type, data = new Uint8Array()) {
  const result = new Uint8Array(data.length + 12);
  new DataView(result.buffer).setUint32(0, data.length);
  result.set(new TextEncoder().encode(type), 4);
  result.set(data, 8);
  let crc = 0xffffffff;
  for (const byte of result.subarray(4, result.length - 4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  new DataView(result.buffer).setUint32(result.length - 4, (crc ^ 0xffffffff) >>> 0);
  return result;
}

export function pngBytes(width, height, compressed = new Uint8Array([0])) {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width); view.setUint32(4, height);
  header[8] = 1; // one-bit grayscale, to create a small genuine decompression trigger
  return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10,
    ...pngChunk("IHDR", header), ...pngChunk("IDAT", compressed), ...pngChunk("IEND")]);
}

export function webpChunk(type, data) {
  const result = new Uint8Array(8 + data.length + (data.length & 1));
  result.set(new TextEncoder().encode(type));
  new DataView(result.buffer).setUint32(4, data.length, true);
  result.set(data, 8);
  return result;
}

export function webpBytes(width, height, { lossless = false, canvas, animation = false } = {}) {
  let coded;
  if (lossless) {
    coded = new Uint8Array(5); coded[0] = 0x2f;
    new DataView(coded.buffer).setUint32(1, (width - 1) | ((height - 1) << 14), true);
  } else {
    coded = new Uint8Array([0x10, 0, 0, 0x9d, 1, 0x2a, width & 255, width >> 8, height & 255, height >> 8]);
  }
  let chunks = [...webpChunk(lossless ? "VP8L" : "VP8 ", coded)];
  if (canvas) {
    const extended = new Uint8Array(10); extended[0] = animation ? 2 : 0;
    for (let axis = 0; axis < 2; axis++) {
      const value = canvas[axis] - 1;
      for (let byte = 0; byte < 3; byte++) extended[4 + axis * 3 + byte] = value >> (8 * byte);
    }
    chunks = [...webpChunk("VP8X", extended), ...chunks];
  }
  const result = new Uint8Array(12 + chunks.length);
  result.set(new TextEncoder().encode("RIFF"));
  new DataView(result.buffer).setUint32(4, result.length - 8, true);
  result.set(new TextEncoder().encode("WEBP"), 8); result.set(chunks, 12);
  return result;
}
