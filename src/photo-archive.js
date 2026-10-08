// Store JPEGs without recompression; UTF-8 filenames and CRC-32 for ZIP readers.
export async function createPhotoArchive(files, filename) {
  if (!files.length || files.length > 65535) throw new Error("相片數量超出 ZIP 限制。");
  const parts = [], directory = [];
  let offset = 0, directorySize = 0;
  for (const file of files) {
    const name = new TextEncoder().encode(file.name.replace(/[\\/]/g, "_"));
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (name.length > 65535 || offset + bytes.length + name.length + 30 > 0xffffffff) throw new Error("相片總容量超出 ZIP 限制。");
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const local = new Uint8Array(30), central = new Uint8Array(46);
    const l = new DataView(local.buffer), c = new DataView(central.buffer);
    l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(6, 0x800, true);
    l.setUint16(12, 33, true); l.setUint32(14, crc, true);
    l.setUint32(18, bytes.length, true); l.setUint32(22, bytes.length, true); l.setUint16(26, name.length, true);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true);
    c.setUint16(8, 0x800, true); c.setUint16(14, 33, true); c.setUint32(16, crc, true);
    c.setUint32(20, bytes.length, true); c.setUint32(24, bytes.length, true); c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    parts.push(local, name, bytes); directory.push(central, name);
    offset += local.length + name.length + bytes.length;
    directorySize += central.length + name.length;
  }
  if (offset + directorySize > 0xffffffff) throw new Error("相片總容量超出 ZIP 限制。");
  const end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, directorySize, true); e.setUint32(16, offset, true);
  return new File([...parts, ...directory, end], filename, { type: "application/zip" });
}
