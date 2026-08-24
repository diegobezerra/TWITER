// generate-icons.js — Creates minimal PNG icons without external dependencies
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const outputDir = path.join(__dirname, 'icons');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}

// CRC32 implementation
function crc32(buf) {
  let c, table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c;
  }
  c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c = table[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function createPNG(size, r, g, b) {
  // Create raw image data (RGBA)
  const rawData = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Circle mask
      const dx = x - size / 2;
      const dy = y - size / 2;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const radius = size / 2 - 1;
      const idx = (y * size + x) * 4;

      if (dist <= radius) {
        // Rounded square with slight corners
        const cornerRadius = size * 0.2;
        let inCorner = false;
        const corners = [
          [cornerRadius, cornerRadius],
          [size - cornerRadius, cornerRadius],
          [cornerRadius, size - cornerRadius],
          [size - cornerRadius, size - cornerRadius]
        ];
        for (const [cx, cy] of corners) {
          const cdx = x - cx;
          const cdy = y - cy;
          if (cdx * cdx + cdy * cdy > cornerRadius * cornerRadius) {
            inCorner = true;
          }
        }

        if (!inCorner || dist <= radius * 0.95) {
          // Draw "X" letter
          const nx = (x / size - 0.5) * 2;
          const ny = (y / size - 0.5) * 2;
          const stroke = 0.25;
          const onX = (
            Math.abs(nx - ny) < stroke ||
            Math.abs(nx + ny) < stroke
          );

          if (onX) {
            rawData[idx] = 255;
            rawData[idx + 1] = 255;
            rawData[idx + 2] = 255;
            rawData[idx + 3] = 255;
          } else {
            rawData[idx] = r;
            rawData[idx + 1] = g;
            rawData[idx + 2] = b;
            rawData[idx + 3] = 255;
          }
        } else {
          rawData[idx + 3] = 0; // transparent
        }
      } else {
        rawData[idx + 3] = 0; // transparent
      }
    }
  }

  // Add filter bytes (0 = no filter for each row)
  const filteredData = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    filteredData[y * (size * 4 + 1)] = 0; // filter byte
    rawData.copy(filteredData, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  const compressedData = zlib.deflateSync(filteredData);

  // Build PNG
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeBuffer = Buffer.from(type, 'ascii');
    const crcData = Buffer.concat([typeBuffer, data]);
    const crcValue = crc32(crcData);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crcValue);
    return Buffer.concat([len, typeBuffer, data, crcBuf]);
  }

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const ihdrChunk = makeChunk('IHDR', ihdr);
  const idatChunk = makeChunk('IDAT', compressedData);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

// Blue Twitter/X blue: #1d9bf0
const sizes = [16, 48, 128];
for (const size of sizes) {
  const png = createPNG(size, 0x1d, 0x9b, 0xf0);
  const filePath = path.join(outputDir, `icon${size}.png`);
  fs.writeFileSync(filePath, png);
  console.log(`Created icon${size}.png (${png.length} bytes)`);
}

console.log('All icons generated!');
