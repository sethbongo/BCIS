import { crc32, deflateSync } from 'node:zlib';

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body) >>> 0, body.length + 4);
  return out;
}

/**
 * Draws a synthetic placeholder that resembles a phone screenshot of a payment confirmation
 * (coloured header, light body, grey "text" bars). It contains no real payment information.
 */
export function placeholderProofPng(seed = 1): Buffer {
  const width = 270;
  const height = 480;
  const header: [number, number, number] = [0, 92 + (seed % 5) * 8, 255 - (seed % 4) * 20];
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 3 + 1);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      let color: [number, number, number] = [246, 248, 251];
      if (y < 96) color = header;
      else if (x > 20 && x < width - 20 && y > 120 && y < 440) {
        color = [255, 255, 255];
        const line = Math.floor((y - 140) / 34);
        const inLine = y > 140 && (y - 140) % 34 < 10 && line < 8;
        const lineWidth = 90 + ((line * 37 + seed * 53) % 110);
        if (inLine && x > 36 && x < 36 + lineWidth) color = line === 1 ? [15, 39, 71] : [203, 213, 225];
      }
      raw.set(color, rowStart + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
