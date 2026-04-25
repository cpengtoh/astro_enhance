import { useState, useRef, useEffect } from 'react';
import { Upload, Download, Undo, SlidersHorizontal, Image as ImageIcon, Zap, HelpCircle } from 'lucide-react';
import { UserGuide } from './UserGuide';
import { parseFITS, type AstroImage } from './fitsParser';
import './index.css';

type ProcessParams = {
  blackPoint: number;
  stretch: number;
  saturation: number;
  temperature: number;
  nebulaPop: number;
  removeGradient: boolean;
  starIntensity: number;
  denoise: number;
};

const DEFAULT_PARAMS: ProcessParams = {
  blackPoint: 0,
  stretch: 1,
  saturation: 0,
  temperature: 0,
  nebulaPop: 0,
  removeGradient: false,
  starIntensity: 100,
  denoise: 0,
};

function extractStars(sourceImage: AstroImage): { starless: AstroImage, starMask: AstroImage } {
  const width = sourceImage.width;
  const height = sourceImage.height;
  const src = sourceImage.data;
  
  const stData = new Float32Array(width * height * 4);
  const mData = new Float32Array(width * height * 4);

  const radius = 3; 
  
  const tempErode = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
       let minR = Infinity, minG = Infinity, minB = Infinity;
       for (let k = -radius; k <= radius; k++) {
          let nx = x + k;
          if (nx < 0) nx = 0;
          if (nx >= width) nx = width - 1;
          const idx = (y * width + nx) * 4;
          if (src[idx] < minR) minR = src[idx];
          if (src[idx+1] < minG) minG = src[idx+1];
          if (src[idx+2] < minB) minB = src[idx+2];
       }
       const tidx = (y * width + x) * 4;
       tempErode[tidx] = minR;
       tempErode[tidx+1] = minG;
       tempErode[tidx+2] = minB;
       tempErode[tidx+3] = 255.0;
    }
  }

  const erodeOutput = new Float32Array(width * height * 4);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
       let minR = Infinity, minG = Infinity, minB = Infinity;
       for (let k = -radius; k <= radius; k++) {
          let ny = y + k;
          if (ny < 0) ny = 0;
          if (ny >= height) ny = height - 1;
          const idx = (ny * width + x) * 4;
          if (tempErode[idx] < minR) minR = tempErode[idx];
          if (tempErode[idx+1] < minG) minG = tempErode[idx+1];
          if (tempErode[idx+2] < minB) minB = tempErode[idx+2];
       }
       const tidx = (y * width + x) * 4;
       erodeOutput[tidx] = minR;
       erodeOutput[tidx+1] = minG;
       erodeOutput[tidx+2] = minB;
       erodeOutput[tidx+3] = 255.0;
    }
  }

  const tempDilate = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
       let maxR = 0, maxG = 0, maxB = 0;
       for (let k = -radius; k <= radius; k++) {
          let nx = x + k;
          if (nx < 0) nx = 0;
          if (nx >= width) nx = width - 1;
          const idx = (y * width + nx) * 4;
          if (erodeOutput[idx] > maxR) maxR = erodeOutput[idx];
          if (erodeOutput[idx+1] > maxG) maxG = erodeOutput[idx+1];
          if (erodeOutput[idx+2] > maxB) maxB = erodeOutput[idx+2];
       }
       const tidx = (y * width + x) * 4;
       tempDilate[tidx] = maxR;
       tempDilate[tidx+1] = maxG;
       tempDilate[tidx+2] = maxB;
       tempDilate[tidx+3] = 255.0;
    }
  }

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
       let maxR = 0, maxG = 0, maxB = 0;
       for (let k = -radius; k <= radius; k++) {
          let ny = y + k;
          if (ny < 0) ny = 0;
          if (ny >= height) ny = height - 1;
          const idx = (ny * width + x) * 4;
          if (tempDilate[idx] > maxR) maxR = tempDilate[idx];
          if (tempDilate[idx+1] > maxG) maxG = tempDilate[idx+1];
          if (tempDilate[idx+2] > maxB) maxB = tempDilate[idx+2];
       }
       const tidx = (y * width + x) * 4;
       
       stData[tidx] = maxR;
       stData[tidx+1] = maxG;
       stData[tidx+2] = maxB;
       stData[tidx+3] = 255.0;
       
       mData[tidx] = Math.max(0, src[tidx] - maxR);
       mData[tidx+1] = Math.max(0, src[tidx+1] - maxG);
       mData[tidx+2] = Math.max(0, src[tidx+2] - maxB);
       mData[tidx+3] = 255.0;
    }
  }

  return { 
    starless: { width, height, data: stData }, 
    starMask: { width, height, data: mData } 
  };
}

function edgePreservingDenoise(src: Float32Array, width: number, height: number, amount: number): Float32Array {
   const dst = new Float32Array(src.length);
   const threshold = amount * 15.0; 
   const denoiseStrength = amount; 
   
   for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
         let sumR = 0, sumG = 0, sumB = 0;
         let count = 0;
         
         const idx = (y * width + x) * 4;
         const cR = src[idx];
         const cG = src[idx+1];
         const cB = src[idx+2];

         for (let ky = -1; ky <= 1; ky++) {
            const ny = y + ky;
            if (ny < 0 || ny >= height) continue;
            for (let kx = -1; kx <= 1; kx++) {
               const nx = x + kx;
               if (nx < 0 || nx >= width) continue;
               
               const nidx = (ny * width + nx) * 4;
               sumR += src[nidx];
               sumG += src[nidx+1];
               sumB += src[nidx+2];
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
         dst[idx+1] = blurG + detailG;
         dst[idx+2] = blurB + detailB;
         dst[idx+3] = src[idx+3];
      }
   }
   return dst;
}

function downscaleAstroImage(img: AstroImage, maxDim: number): AstroImage {
  if (img.width <= maxDim && img.height <= maxDim) return img;
  const ratio = Math.min(maxDim / img.width, maxDim / img.height);
  const newW = Math.floor(img.width * ratio);
  const newH = Math.floor(img.height * ratio);
  
  const newData = new Float32Array(newW * newH * 4);
  for (let y = 0; y < newH; y++) {
    const srcY = Math.floor(y / ratio);
    for (let x = 0; x < newW; x++) {
      const srcX = Math.floor(x / ratio);
      const srcIdx = (srcY * img.width + srcX) * 4;
      const dstIdx = (y * newW + x) * 4;
      newData[dstIdx] = img.data[srcIdx];
      newData[dstIdx+1] = img.data[srcIdx+1];
      newData[dstIdx+2] = img.data[srcIdx+2];
      newData[dstIdx+3] = img.data[srcIdx+3];
    }
  }
  return { width: newW, height: newH, data: newData };
}

function buildBackgroundModel(width: number, height: number, data: Float32Array): AstroImage | null {
  const gridSizeX = 32;
  const gridSizeY = 32;
  
  const cellW = width / gridSizeX;
  const cellH = height / gridSizeY;

  const tinyData = new Uint8ClampedArray(gridSizeX * gridSizeY * 4);

  for (let gy = 0; gy < gridSizeY; gy++) {
    for (let gx = 0; gx < gridSizeX; gx++) {
      let rVals: number[] = [], gVals: number[] = [], bVals: number[] = [];
      const startX = Math.floor(gx * cellW);
      const startY = Math.floor(gy * cellH);
      const endX = Math.floor((gx + 1) * cellW);
      const endY = Math.floor((gy + 1) * cellH);

      const stepX = Math.max(1, Math.floor((endX - startX) / 5));
      const stepY = Math.max(1, Math.floor((endY - startY) / 5));

      for (let y = startY; y < endY; y += stepY) {
        for (let x = startX; x < endX; x += stepX) {
          const idx = (y * width + x) * 4;
          rVals.push(data[idx]);
          gVals.push(data[idx+1]);
          bVals.push(data[idx+2]);
        }
      }

      rVals.sort((a,b)=>a-b);
      gVals.sort((a,b)=>a-b);
      bVals.sort((a,b)=>a-b);

      const p15 = Math.floor(rVals.length * 0.15);
      const cIdx = (gy * gridSizeX + gx) * 4;
      tinyData[cIdx] = rVals[p15] || 0;
      tinyData[cIdx+1] = gVals[p15] || 0;
      tinyData[cIdx+2] = bVals[p15] || 0;
      tinyData[cIdx+3] = 255;
    }
  }

  try {
    const tinyImageData = new ImageData(tinyData, gridSizeX, gridSizeY);
    const canvas1 = document.createElement('canvas');
    canvas1.width = gridSizeX;
    canvas1.height = gridSizeY;
    canvas1.getContext('2d')!.putImageData(tinyImageData, 0, 0);

    const canvas2 = document.createElement('canvas');
    canvas2.width = width;
    canvas2.height = height;
    const ctx2 = canvas2.getContext('2d')!;
    ctx2.imageSmoothingEnabled = true;
    ctx2.imageSmoothingQuality = 'high';
    ctx2.filter = 'blur(20px)';
    ctx2.drawImage(canvas1, 0, 0, width, height);

    const bgImageData = ctx2.getImageData(0, 0, width, height);
    const bgFloat = new Float32Array(bgImageData.data.length);
    for(let i=0; i<bgFloat.length; i++) bgFloat[i] = bgImageData.data[i];

    return { width, height, data: bgFloat };
  } catch(e) {
    console.error('BG extraction failed', e);
    return null;
  }
}

function drawHistogram(
  ctx: CanvasRenderingContext2D, 
  rHist: Uint32Array, 
  gHist: Uint32Array, 
  bHist: Uint32Array, 
  maxCount: number
) {
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  
  ctx.clearRect(0, 0, width, height);
  ctx.globalCompositeOperation = 'screen';

  const drawChannel = (hist: Uint32Array, color: string) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, height);
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * width;
      const val = Math.sqrt(hist[i]);
      const maxVal = Math.sqrt(maxCount);
      const y = height - (val / maxVal) * height;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(width, height);
    ctx.fill();
  };

  drawChannel(rHist, 'rgba(255, 50, 50, 0.8)');
  drawChannel(gHist, 'rgba(50, 255, 50, 0.8)');
  drawChannel(bHist, 'rgba(50, 100, 255, 0.8)');

  ctx.globalCompositeOperation = 'source-over';
}

function processImage(
  ctx: CanvasRenderingContext2D,
  sourceImage: AstroImage,
  bgImage: AstroImage | null,
  starMaskImage: AstroImage | null,
  params: ProcessParams,
  histCtx?: CanvasRenderingContext2D | null
) {
  const { width, height } = sourceImage;
  let data = sourceImage.data;
  const bgData = bgImage?.data;

  if (params.denoise > 0) {
     data = edgePreservingDenoise(data, width, height, params.denoise / 100);
  }

  const renderData = new Uint8ClampedArray(width * height * 4);

  const bp = params.blackPoint / 200; 
  const stretchFactor = params.stretch; 
  const sat = params.saturation / 100; 
  const temp = params.temperature / 100; 
  const pop = params.nebulaPop / 50; 

  let bgMeanR = 0, bgMeanG = 0, bgMeanB = 0;
  if (params.removeGradient && bgData) {
     let sumR = 0, sumG = 0, sumB = 0;
     for(let i=0; i<bgData.length; i+=4) {
        sumR += bgData[i]; sumG += bgData[i+1]; sumB += bgData[i+2];
     }
     const count = bgData.length/4;
     bgMeanR = (sumR/count)/255;
     bgMeanG = (sumG/count)/255;
     bgMeanB = (sumB/count)/255;
  }

  const rHist = new Uint32Array(256);
  const gHist = new Uint32Array(256);
  const bHist = new Uint32Array(256);

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i] / 255;
    let g = data[i + 1] / 255;
    let b = data[i + 2] / 255;

    if (params.removeGradient && bgData) {
       const br = bgData[i]/255;
       const bg = bgData[i+1]/255;
       const bb = bgData[i+2]/255;
       
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

    if (starMaskImage) {
       const starR = (starMaskImage.data[i] / 255) * (params.starIntensity / 100);
       const starG = (starMaskImage.data[i+1] / 255) * (params.starIntensity / 100);
       const starB = (starMaskImage.data[i+2] / 255) * (params.starIntensity / 100);
       
       const sR_g = Math.pow(starR, 0.8) * 255;
       const sG_g = Math.pow(starG, 0.8) * 255;
       const sB_g = Math.pow(starB, 0.8) * 255;

       finalR = Math.min(255, finalR + sR_g);
       finalG = Math.min(255, finalG + sG_g);
       finalB = Math.min(255, finalB + sB_g);
    }

    renderData[i] = finalR;
    renderData[i + 1] = finalG;
    renderData[i + 2] = finalB;
    renderData[i + 3] = 255;

    rHist[Math.floor(finalR)]++;
    gHist[Math.floor(finalG)]++;
    bHist[Math.floor(finalB)]++;
  }

  const renderImageData = new ImageData(renderData, width, height);
  ctx.putImageData(renderImageData, 0, 0);

  if (histCtx) {
    let maxCount = 1;
    for (let i = 1; i < 255; i++) {
      if (rHist[i] > maxCount) maxCount = rHist[i];
      if (gHist[i] > maxCount) maxCount = gHist[i];
      if (bHist[i] > maxCount) maxCount = bHist[i];
    }
    drawHistogram(histCtx, rHist, gHist, bHist, maxCount);
  }
}

function App() {
  const [sourceLoaded, setSourceLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState<'light' | 'color'>('light');
  const [params, setParams] = useState<ProcessParams>(DEFAULT_PARAMS);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [fileName, setFileName] = useState('astro_enhanced');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const histCanvasRef = useRef<HTMLCanvasElement>(null);
  const originalImageRef = useRef<AstroImage | null>(null);
  const bgImageRef = useRef<AstroImage | null>(null);
  const starlessImageRef = useRef<AstroImage | null>(null);
  const starMaskRef = useRef<AstroImage | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [starsExtracted, setStarsExtracted] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);

  const handleExtractStars = () => {
     if (!originalImageRef.current) return;
     setIsExtracting(true);
     setTimeout(() => {
        const { starless, starMask } = extractStars(originalImageRef.current!);
        starlessImageRef.current = starless;
        starMaskRef.current = starMask;
        setStarsExtracted(true);
        setIsExtracting(false);
        setParams(p => ({...p}));
     }, 50);
  };

  const initImageSource = (img: AstroImage) => {
    originalImageRef.current = img;
    setSourceLoaded(true);
    setParams(DEFAULT_PARAMS);
    setStarsExtracted(false);
    starlessImageRef.current = null;
    starMaskRef.current = null;

    if (canvasRef.current) {
       canvasRef.current.width = img.width;
       canvasRef.current.height = img.height;
    }

    setTimeout(() => {
      bgImageRef.current = buildBackgroundModel(img.width, img.height, img.data);
      setParams(p => ({...p}));
    }, 50);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const baseName = file.name.replace(/\.[^/.]+$/, "");
      setFileName(baseName + '_enhanced');
      if (file.name.toLowerCase().endsWith('.fit') || file.name.toLowerCase().endsWith('.fits')) {
         setIsProcessing(true);
         const buffer = await file.arrayBuffer();
         const astroImg = parseFITS(buffer);
         const scaledImg = downscaleAstroImage(astroImg, 2000);
         initImageSource(scaledImg);
         setIsProcessing(false);
      } else {
         const url = URL.createObjectURL(file);
         const img = new Image();
         img.onload = () => {
           const canvas = document.createElement('canvas');
           let width = img.width;
           let height = img.height;
           const MAX_DIM = 2000;
           if (width > MAX_DIM || height > MAX_DIM) {
             const ratio = Math.min(MAX_DIM / width, MAX_DIM / height);
             width = Math.floor(width * ratio);
             height = Math.floor(height * ratio);
           }
           canvas.width = width;
           canvas.height = height;
           const ctx = canvas.getContext('2d')!;
           ctx.drawImage(img, 0, 0, width, height);
           const imgData = ctx.getImageData(0, 0, width, height);
           const floatData = new Float32Array(imgData.data.length);
           for(let i=0; i<floatData.length; i++) floatData[i] = imgData.data[i];
           initImageSource({ width, height, data: floatData });
         };
         img.src = url;
      }
    }
  };

  useEffect(() => {
    if (!canvasRef.current || !originalImageRef.current) return;
    
    if (showOriginal) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
         const { width, height, data } = originalImageRef.current;
         const renderData = new Uint8ClampedArray(data.length);
         for(let i=0; i<data.length; i++) renderData[i] = data[i];
         ctx.putImageData(new ImageData(renderData, width, height), 0, 0);
      }
      return;
    }

    const timer = setTimeout(() => {
      setIsProcessing(true);
      const ctx = canvasRef.current!.getContext('2d');
      const histCtx = histCanvasRef.current?.getContext('2d');
      const sourceImage = starsExtracted && starlessImageRef.current ? starlessImageRef.current : originalImageRef.current;

      if (ctx && sourceImage) {
        processImage(ctx, sourceImage, bgImageRef.current, starsExtracted ? starMaskRef.current : null, params, histCtx);
      }
      setIsProcessing(false);
    }, 50);

    return () => clearTimeout(timer);
  }, [params, showOriginal, sourceLoaded]);

  const handleDownload = () => {
    if (!canvasRef.current) return;
    canvasRef.current.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fileName}.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  };

  return (
    <div className="app-container">
      <header className="top-bar">
        <h1 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Zap size={20} color="var(--accent-color)" /> AstroEnhance 
          <span style={{ fontSize: '0.6em', color: 'var(--accent-color)', fontWeight: 'normal', border: '1px solid var(--accent-color)', padding: '2px 6px', borderRadius: '4px' }}>v1.0.0</span>
        </h1>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="action-btn" onClick={() => setShowGuide(true)} title="User Guide">
            <HelpCircle size={20} />
          </button>
          {sourceLoaded && (
            <>
              <button className="action-btn" onClick={() => fileInputRef.current?.click()} title="Open new image">
                <Upload size={20} />
              </button>
              <button 
                className="action-btn" 
                onPointerDown={() => setShowOriginal(true)}
                onPointerUp={() => setShowOriginal(false)}
                onPointerLeave={() => setShowOriginal(false)}
                title="Hold to view original"
              >
                <Undo size={20} />
              </button>
              <button className="action-btn primary" onClick={handleDownload} title="Export image">
                <Download size={20} />
              </button>
            </>
          )}
        </div>
      </header>

      <main className="canvas-container">
        {!sourceLoaded ? (
          <div className="hero-landing">
            <div className="stars"></div>
            <div className="clouds"></div>
            
            <div className="hero-content">
              <div className="icon-container">
                <Zap size={48} className="hero-icon" color="var(--accent-color)" />
              </div>
              <h2>AstroEnhance</h2>
              <p>Professional grade astrophotography processing right in your browser.<br/>Upload a FITS, PNG, or JPG file to unleash the details.</p>
              <button className="upload-btn pulse" onClick={() => fileInputRef.current?.click()} style={{ marginTop: '10px' }}>
                <Upload size={20} />
                Select Deep-Sky Photo
              </button>
            </div>
          </div>
        ) : (
          <canvas 
            ref={canvasRef} 
            className="image-canvas"
            width={originalImageRef.current?.width || 0}
            height={originalImageRef.current?.height || 0}
            style={{ opacity: isProcessing ? 0.8 : 1 }}
          />
        )}
        <input 
          type="file" 
          accept="image/*,.fit,.fits" 
          ref={fileInputRef} 
          onChange={handleFileUpload} 
          className="hidden-input" 
        />
      </main>

      {sourceLoaded && (
        <footer className="bottom-panel">
          <canvas 
            ref={histCanvasRef} 
            width={300} 
            height={80} 
            className="histogram-canvas" 
          />
          <div className="tabs">
            <button 
              className={`tab ${activeTab === 'light' ? 'active' : ''}`}
              onClick={() => setActiveTab('light')}
            >
              <SlidersHorizontal size={16} /> Light
            </button>
            <button 
              className={`tab ${activeTab === 'color' ? 'active' : ''}`}
              onClick={() => setActiveTab('color')}
            >
              <ImageIcon size={16} /> Color & Detail
            </button>
          </div>

          <div className="controls-container">
            {activeTab === 'light' ? (
              <>
                <div className="control-group">
                  <div className="control-header" style={{ marginBottom: '8px' }}>
                    <span>Remove Light Pollution Gradient</span>
                    <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                      <input 
                        type="checkbox" 
                        style={{ width: '18px', height: '18px', accentColor: 'var(--accent-color)' }}
                        checked={params.removeGradient}
                        onChange={(e) => setParams({ ...params, removeGradient: e.target.checked })}
                      />
                    </label>
                  </div>
                </div>
                <div className="control-group">
                  <div className="control-header">
                    <span>Black Point</span>
                    <span className="control-value">{params.blackPoint}</span>
                  </div>
                  <input 
                    type="range" 
                    min="0" max="100" 
                    value={params.blackPoint}
                    onChange={(e) => setParams({ ...params, blackPoint: Number(e.target.value) })}
                  />
                </div>
                <div className="control-group">
                  <div className="control-header">
                    <span>Arcsinh Stretch</span>
                    <span className="control-value">{params.stretch}</span>
                  </div>
                  <input 
                    type="range" 
                    min="1" max="50" 
                    value={params.stretch}
                    onChange={(e) => setParams({ ...params, stretch: Number(e.target.value) })}
                  />
                </div>

                <div className="control-group" style={{ borderTop: '1px solid var(--glass-border)', paddingTop: '16px', marginTop: '8px' }}>
                  {!starsExtracted ? (
                     <button 
                        className="upload-btn" 
                        style={{ width: '100%', justifySelf: 'center', display: 'flex', justifyContent: 'center' }}
                        onClick={handleExtractStars}
                        disabled={isExtracting}
                     >
                        <Zap size={16} /> {isExtracting ? 'Extracting Stars...' : 'Star Extraction (Morphological)'}
                     </button>
                  ) : (
                     <>
                        <div className="control-header">
                          <span>Star Intensity</span>
                          <span className="control-value">{params.starIntensity}%</span>
                        </div>
                        <input 
                          type="range" 
                          min="0" max="200" 
                          value={params.starIntensity}
                          onChange={(e) => setParams({ ...params, starIntensity: Number(e.target.value) })}
                        />
                     </>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="control-group">
                  <div className="control-header">
                    <span>Saturation</span>
                    <span className="control-value">{params.saturation > 0 ? '+' : ''}{params.saturation}</span>
                  </div>
                  <input 
                    type="range" 
                    min="-100" max="100" 
                    value={params.saturation}
                    onChange={(e) => setParams({ ...params, saturation: Number(e.target.value) })}
                  />
                </div>
                <div className="control-group">
                  <div className="control-header">
                    <span>Nebula Pop</span>
                    <span className="control-value">{params.nebulaPop}</span>
                  </div>
                  <input 
                    type="range" 
                    min="0" max="100" 
                    value={params.nebulaPop}
                    onChange={(e) => setParams({ ...params, nebulaPop: Number(e.target.value) })}
                  />
                </div>
                <div className="control-group">
                  <div className="control-header">
                    <span>Temperature</span>
                    <span className="control-value">{params.temperature}</span>
                  </div>
                  <input 
                    type="range" 
                    min="-100" max="100" 
                    value={params.temperature}
                    onChange={(e) => setParams({ ...params, temperature: Number(e.target.value) })}
                  />
                </div>
                <div className="control-group" style={{ borderTop: '1px solid var(--glass-border)', paddingTop: '16px', marginTop: '8px' }}>
                  <div className="control-header">
                    <span>Wavelet Denoise</span>
                    <span className="control-value">{params.denoise}%</span>
                  </div>
                  <input 
                    type="range" 
                    min="0" max="100" 
                    value={params.denoise}
                    onChange={(e) => setParams({ ...params, denoise: Number(e.target.value) })}
                  />
                </div>
              </>
            )}
          </div>
        </footer>
      )}
      {showGuide && <UserGuide onClose={() => setShowGuide(false)} />}
    </div>
  );
}

export default App;
