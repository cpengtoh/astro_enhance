/// <reference lib="webworker" />
import type {
  WorkerRequest,
  WorkerResponse,
  ProcessParams,
} from './imageWorkerTypes';

function edgePreservingDenoise(src: Float32Array, width: number, height: number, amount: number): Float32Array {
  const dst = new Float32Array(src.length);
  const threshold = amount * 15.0;
  const denoiseStrength = amount;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let count = 0;

      const idx = (y * width + x) * 4;
      const cR = src[idx];
      const cG = src[idx + 1];
      const cB = src[idx + 2];

      for (let ky = -1; ky <= 1; ky++) {
        const ny = y + ky;
        if (ny < 0 || ny >= height) continue;
        for (let kx = -1; kx <= 1; kx++) {
          const nx = x + kx;
          if (nx < 0 || nx >= width) continue;
          const nidx = (ny * width + nx) * 4;
          sumR += src[nidx];
          sumG += src[nidx + 1];
          sumB += src[nidx + 2];
          count++;
        }
      }

      const blurR = sumR / count;
      const blurG = sumG / count;
      const blurB = sumB / count;

      let detailR = cR - blurR;
      let detailG = cG - blurG;
      let detailB = cB - blurB;

      if (Math.abs(detailR) < threshold) detailR *= (1 - denoiseStrength);
      if (Math.abs(detailG) < threshold) detailG *= (1 - denoiseStrength);
      if (Math.abs(detailB) < threshold) detailB *= (1 - denoiseStrength);

      dst[idx] = blurR + detailR;
      dst[idx + 1] = blurG + detailG;
      dst[idx + 2] = blurB + detailB;
      dst[idx + 3] = src[idx + 3];
    }
  }
  return dst;
}

function processImage(
  width: number,
  height: number,
  sourceData: Float32Array,
  bgData: Float32Array | null,
  starMaskData: Float32Array | null,
  params: ProcessParams
) {
  let data = sourceData;
  if (params.denoise > 0) {
    data = edgePreservingDenoise(data, width, height, params.denoise / 100);
  }

  const renderData = new Uint8ClampedArray(width * height * 4);
  const bp = params.blackPoint / 200;
  const stretchFactor = params.stretch;
  const sat = params.saturation / 100;
  const temp = params.temperature / 100;
  const pop = params.nebulaPop / 50;

  let bgMeanR = 0;
  let bgMeanG = 0;
  let bgMeanB = 0;
  if (params.removeGradient && bgData) {
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    for (let i = 0; i < bgData.length; i += 4) {
      sumR += bgData[i];
      sumG += bgData[i + 1];
      sumB += bgData[i + 2];
    }
    const count = bgData.length / 4;
    bgMeanR = (sumR / count) / 255;
    bgMeanG = (sumG / count) / 255;
    bgMeanB = (sumB / count) / 255;
  }

  const rHist = new Uint32Array(256);
  const gHist = new Uint32Array(256);
  const bHist = new Uint32Array(256);

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i] / 255;
    let g = data[i + 1] / 255;
    let b = data[i + 2] / 255;

    if (params.removeGradient && bgData) {
      const br = bgData[i] / 255;
      const bg = bgData[i + 1] / 255;
      const bb = bgData[i + 2] / 255;
      r = Math.max(0, r - br + bgMeanR);
      g = Math.max(0, g - bg + bgMeanG);
      b = Math.max(0, b - bb + bgMeanB);
    }

    r = Math.max(0, r - bp) / (1 - bp);
    g = Math.max(0, g - bp) / (1 - bp);
    b = Math.max(0, b - bp) / (1 - bp);

    if (stretchFactor > 1) {
      const intensity = 0.299 * r + 0.587 * g + 0.114 * b;
      if (intensity > 0) {
        const stretchMult = Math.asinh(intensity * stretchFactor) / (intensity * Math.asinh(stretchFactor));
        r = Math.min(1, r * stretchMult);
        g = Math.min(1, g * stretchMult);
        b = Math.min(1, b * stretchMult);
      }
    }

    if (pop > 0) {
      const intensity = 0.299 * r + 0.587 * g + 0.114 * b;
      const midtoneBoost = Math.sin(intensity * Math.PI) * pop;
      r = Math.min(1, r + r * midtoneBoost);
      g = Math.min(1, g + g * midtoneBoost);
      b = Math.min(1, b + b * midtoneBoost);
    }

    r = Math.min(1, Math.max(0, r + temp * 0.15));
    b = Math.min(1, Math.max(0, b - temp * 0.15));

    if (sat !== 0) {
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      r = lum + (1 + sat) * (r - lum);
      g = lum + (1 + sat) * (g - lum);
      b = lum + (1 + sat) * (b - lum);
    }

    let finalR = Math.min(255, Math.max(0, r * 255));
    let finalG = Math.min(255, Math.max(0, g * 255));
    let finalB = Math.min(255, Math.max(0, b * 255));

    if (starMaskData) {
      const starR = (starMaskData[i] / 255) * (params.starIntensity / 100);
      const starG = (starMaskData[i + 1] / 255) * (params.starIntensity / 100);
      const starB = (starMaskData[i + 2] / 255) * (params.starIntensity / 100);
      finalR = Math.min(255, finalR + Math.pow(starR, 0.8) * 255);
      finalG = Math.min(255, finalG + Math.pow(starG, 0.8) * 255);
      finalB = Math.min(255, finalB + Math.pow(starB, 0.8) * 255);
    }

    renderData[i] = finalR;
    renderData[i + 1] = finalG;
    renderData[i + 2] = finalB;
    renderData[i + 3] = 255;

    rHist[Math.floor(finalR)]++;
    gHist[Math.floor(finalG)]++;
    bHist[Math.floor(finalB)]++;
  }

  return { renderData, rHist, gHist, bHist };
}

function extractStars(width: number, height: number, src: Float32Array) {
  const stData = new Float32Array(width * height * 4);
  const mData = new Float32Array(width * height * 4);
  const radius = 3;

  const tempErode = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let minR = Infinity;
      let minG = Infinity;
      let minB = Infinity;
      for (let k = -radius; k <= radius; k++) {
        let nx = x + k;
        if (nx < 0) nx = 0;
        if (nx >= width) nx = width - 1;
        const idx = (y * width + nx) * 4;
        if (src[idx] < minR) minR = src[idx];
        if (src[idx + 1] < minG) minG = src[idx + 1];
        if (src[idx + 2] < minB) minB = src[idx + 2];
      }
      const tidx = (y * width + x) * 4;
      tempErode[tidx] = minR;
      tempErode[tidx + 1] = minG;
      tempErode[tidx + 2] = minB;
      tempErode[tidx + 3] = 255;
    }
  }

  const erodeOutput = new Float32Array(width * height * 4);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let minR = Infinity;
      let minG = Infinity;
      let minB = Infinity;
      for (let k = -radius; k <= radius; k++) {
        let ny = y + k;
        if (ny < 0) ny = 0;
        if (ny >= height) ny = height - 1;
        const idx = (ny * width + x) * 4;
        if (tempErode[idx] < minR) minR = tempErode[idx];
        if (tempErode[idx + 1] < minG) minG = tempErode[idx + 1];
        if (tempErode[idx + 2] < minB) minB = tempErode[idx + 2];
      }
      const tidx = (y * width + x) * 4;
      erodeOutput[tidx] = minR;
      erodeOutput[tidx + 1] = minG;
      erodeOutput[tidx + 2] = minB;
      erodeOutput[tidx + 3] = 255;
    }
  }

  const tempDilate = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let maxR = 0;
      let maxG = 0;
      let maxB = 0;
      for (let k = -radius; k <= radius; k++) {
        let nx = x + k;
        if (nx < 0) nx = 0;
        if (nx >= width) nx = width - 1;
        const idx = (y * width + nx) * 4;
        if (erodeOutput[idx] > maxR) maxR = erodeOutput[idx];
        if (erodeOutput[idx + 1] > maxG) maxG = erodeOutput[idx + 1];
        if (erodeOutput[idx + 2] > maxB) maxB = erodeOutput[idx + 2];
      }
      const tidx = (y * width + x) * 4;
      tempDilate[tidx] = maxR;
      tempDilate[tidx + 1] = maxG;
      tempDilate[tidx + 2] = maxB;
      tempDilate[tidx + 3] = 255;
    }
  }

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let maxR = 0;
      let maxG = 0;
      let maxB = 0;
      for (let k = -radius; k <= radius; k++) {
        let ny = y + k;
        if (ny < 0) ny = 0;
        if (ny >= height) ny = height - 1;
        const idx = (ny * width + x) * 4;
        if (tempDilate[idx] > maxR) maxR = tempDilate[idx];
        if (tempDilate[idx + 1] > maxG) maxG = tempDilate[idx + 1];
        if (tempDilate[idx + 2] > maxB) maxB = tempDilate[idx + 2];
      }
      const tidx = (y * width + x) * 4;
      stData[tidx] = maxR;
      stData[tidx + 1] = maxG;
      stData[tidx + 2] = maxB;
      stData[tidx + 3] = 255;
      mData[tidx] = Math.max(0, src[tidx] - maxR);
      mData[tidx + 1] = Math.max(0, src[tidx + 1] - maxG);
      mData[tidx + 2] = Math.max(0, src[tidx + 2] - maxB);
      mData[tidx + 3] = 255;
    }
  }

  return { starlessData: stData, starMaskData: mData };
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  try {
    if (message.type === 'process') {
      const { renderData, rHist, gHist, bHist } = processImage(
        message.width,
        message.height,
        message.sourceData,
        message.bgData,
        message.starMaskData,
        message.params
      );
      const response: WorkerResponse = {
        type: 'processResult',
        id: message.id,
        width: message.width,
        height: message.height,
        renderData,
        rHist,
        gHist,
        bHist,
      };
      self.postMessage(response, [
        renderData.buffer,
        rHist.buffer,
        gHist.buffer,
        bHist.buffer,
      ]);
      return;
    }

    const { starlessData, starMaskData } = extractStars(
      message.width,
      message.height,
      message.sourceData
    );
    const response: WorkerResponse = {
      type: 'extractStarsResult',
      id: message.id,
      width: message.width,
      height: message.height,
      starlessData,
      starMaskData,
    };
    self.postMessage(response, [starlessData.buffer, starMaskData.buffer]);
  } catch (error) {
    const response: WorkerResponse = {
      type: 'error',
      id: message.id,
      message: error instanceof Error ? error.message : 'Worker processing failed',
    };
    self.postMessage(response);
  }
};
