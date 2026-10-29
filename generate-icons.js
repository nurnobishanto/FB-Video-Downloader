const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// CRC32 calculation table
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[i] = c >>> 0;
}

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c = (crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8)) >>> 0;
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function createChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = data.length;
  const chunk = Buffer.alloc(4 + 4 + len + 4);
  chunk.writeUInt32BE(len, 0);
  typeBuf.copy(chunk, 4);
  data.copy(chunk, 8);
  const crc = crc32(Buffer.concat([typeBuf, data]));
  chunk.writeUInt32BE(crc, 8 + len);
  return chunk;
}

function generatePng(size) {
  // RGBA buffer for image
  const rowSize = 1 + size * 4; // 1 filter byte (0) + 4 bytes per pixel
  const rawData = Buffer.alloc(rowSize * size);

  const radius = size * 0.22;
  const center = size / 2;

  for (let y = 0; y < size; y++) {
    const rowOffset = y * rowSize;
    rawData[rowOffset] = 0; // Filter type 0 (None)

    for (let x = 0; x < size; x++) {
      const pxOffset = rowOffset + 1 + x * 4;

      // Rounded rectangle test
      const dx = Math.abs(x - center + 0.5) - (center - radius);
      const dy = Math.abs(y - center + 0.5) - (center - radius);
      const insideBox = dx <= 0 && dy <= 0;
      const insideCorner = dx > 0 && dy > 0 && (dx * dx + dy * dy <= radius * radius);
      const isInside = insideBox || insideCorner || (dx <= 0 && dy > 0 && dy <= radius) || (dy <= 0 && dx > 0 && dx <= radius);

      if (!isInside) {
        // Transparent
        rawData[pxOffset] = 0;
        rawData[pxOffset + 1] = 0;
        rawData[pxOffset + 2] = 0;
        rawData[pxOffset + 3] = 0;
        continue;
      }

      // Base gradient: Facebook Blue to Vivid Cyan
      const t = y / size;
      let r = Math.round(24 + (0 - 24) * t);
      let g = Math.round(119 + (166 - 119) * t);
      let b = Math.round(242 + (255 - 242) * t);
      let a = 255;

      // Draw Icon in center: Download arrow + base bar
      // Scale coordinates relative to size:
      const nx = (x - center) / (size * 0.5); // -1 to 1
      const ny = (y - center) / (size * 0.5); // -1 to 1

      // 1. Arrow stem: width = 0.24, y from -0.55 to 0.15
      const inStem = Math.abs(nx) <= 0.18 && ny >= -0.55 && ny <= 0.15;

      // 2. Arrow head: triangle from ny = 0.0 to 0.45, width expands
      const inHead = ny >= 0.05 && ny <= 0.45 && Math.abs(nx) <= (0.45 - ny) * 1.35;

      // 3. Bottom tray: ny = 0.6 to 0.75, nx from -0.6 to 0.6
      const inTrayBottom = ny >= 0.58 && ny <= 0.74 && Math.abs(nx) <= 0.65;
      const inTrayLeft = ny >= 0.38 && ny <= 0.74 && nx >= -0.65 && nx <= -0.50;
      const inTrayRight = ny >= 0.38 && ny <= 0.74 && nx >= 0.50 && nx <= 0.65;
      const inTray = inTrayBottom || inTrayLeft || inTrayRight;

      if (inStem || inHead || inTray) {
        // Crisp White icon
        r = 255;
        g = 255;
        b = 255;
        a = 255;
      }

      rawData[pxOffset] = r;
      rawData[pxOffset + 1] = g;
      rawData[pxOffset + 2] = b;
      rawData[pxOffset + 3] = a;
    }
  }

  // Header chunk IHDR
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData[8] = 8; // Bit depth: 8
  ihdrData[9] = 6; // Color type: 6 (RGBA)
  ihdrData[10] = 0; // Compression
  ihdrData[11] = 0; // Filter
  ihdrData[12] = 0; // Interlace

  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdrChunk = createChunk('IHDR', ihdrData);
  const compressedData = zlib.deflateSync(rawData);
  const idatChunk = createChunk('IDAT', compressedData);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

[16, 32, 48, 128].forEach(size => {
  const pngBuf = generatePng(size);
  const filePath = path.join(iconsDir, `icon${size}.png`);
  fs.writeFileSync(filePath, pngBuf);
  console.log(`Generated icon${size}.png (${pngBuf.length} bytes)`);
});
