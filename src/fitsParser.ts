export type AstroImage = {
  width: number;
  height: number;
  data: Float32Array;
};

export function parseFITS(buffer: ArrayBuffer): AstroImage {
  const view = new DataView(buffer);
  let offset = 0;
  
  let bitpix = 8;
  let naxis1 = 0;
  let naxis2 = 0;
  let naxis3 = 1;
  let bzero = 0;
  let bscale = 1;

  let endFound = false;

  while (!endFound && offset < buffer.byteLength) {
    for (let i = 0; i < 36; i++) {
      const lineChars: string[] = [];
      for (let j = 0; j < 80; j++) {
        lineChars.push(String.fromCharCode(view.getUint8(offset + j)));
      }
      const line = lineChars.join('');
      offset += 80;

      if (line.startsWith('END       ')) {
        endFound = true;
      } else if (line.startsWith('BITPIX  =')) {
        bitpix = parseInt(line.substring(10, 30));
      } else if (line.startsWith('NAXIS1  =')) {
        naxis1 = parseInt(line.substring(10, 30));
      } else if (line.startsWith('NAXIS2  =')) {
        naxis2 = parseInt(line.substring(10, 30));
      } else if (line.startsWith('NAXIS3  =')) {
        naxis3 = parseInt(line.substring(10, 30));
      } else if (line.startsWith('BZERO   =')) {
        bzero = parseFloat(line.substring(10, 30));
      } else if (line.startsWith('BSCALE  =')) {
        bscale = parseFloat(line.substring(10, 30));
      }
    }
  }

  const width = naxis1;
  const height = naxis2;
  const channels = naxis3;

  const numPixels = width * height;
  const totalValues = numPixels * channels;
  const rawData = new Float32Array(totalValues);

  for (let i = 0; i < totalValues; i++) {
    let val = 0;
    if (bitpix === 16) {
      val = view.getInt16(offset, false); 
      offset += 2;
      val = (val * bscale) + bzero;
      val = (val / 65535) * 255.0; // Normalize to 0-255
    } else if (bitpix === 32) {
      val = view.getInt32(offset, false);
      offset += 4;
      val = (val * bscale) + bzero;
      val = (val / 4294967295) * 255.0;
    } else if (bitpix === -32) {
      val = view.getFloat32(offset, false);
      offset += 4;
      val = (val * bscale) + bzero;
      val = val * 255.0;
    } else if (bitpix === 8) {
      val = view.getUint8(offset); // Already 0-255
      offset += 1;
    }
    rawData[i] = val;
  }

  const rgbaData = new Float32Array(width * height * 4);

  // FITS files store data starting from bottom-left, and planar (RRRR GGGG BBBB)
  for (let y = 0; y < height; y++) {
    const flipY = height - 1 - y;
    for (let x = 0; x < width; x++) {
      const srcIdx = y * width + x;
      const dstIdx = (flipY * width + x) * 4;

      if (channels === 3) {
        rgbaData[dstIdx] = rawData[srcIdx];
        rgbaData[dstIdx + 1] = rawData[numPixels + srcIdx];
        rgbaData[dstIdx + 2] = rawData[numPixels * 2 + srcIdx];
        rgbaData[dstIdx + 3] = 1.0;
      } else {
        rgbaData[dstIdx] = rawData[srcIdx];
        rgbaData[dstIdx + 1] = rawData[srcIdx];
        rgbaData[dstIdx + 2] = rawData[srcIdx];
        rgbaData[dstIdx + 3] = 1.0;
      }
    }
  }

  return { width, height, data: rgbaData };
}
