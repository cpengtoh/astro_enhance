import { useMemo, useState, useRef, useEffect } from 'react';
import { Upload, Download, Undo, SlidersHorizontal, Image as ImageIcon, Zap, HelpCircle } from 'lucide-react';
import { UserGuide } from './UserGuide';
import { parseFITS, type AstroImage } from './fitsParser';
import type {
  WorkerRequest,
  WorkerResponse,
  ProcessParams,
} from './imageWorkerTypes';
import './index.css';

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

function App() {
  const [sourceLoaded, setSourceLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState<'light' | 'color'>('light');
  const [params, setParams] = useState<ProcessParams>(DEFAULT_PARAMS);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [showOriginalPinned, setShowOriginalPinned] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [fileName, setFileName] = useState('astro_enhanced');
  const [errorMessage, setErrorMessage] = useState('');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const histCanvasRef = useRef<HTMLCanvasElement>(null);
  const originalImageRef = useRef<AstroImage | null>(null);
  const bgImageRef = useRef<AstroImage | null>(null);
  const starlessImageRef = useRef<AstroImage | null>(null);
  const starMaskRef = useRef<AstroImage | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const processRequestIdRef = useRef(0);
  const extractRequestIdRef = useRef(0);

  const [starsExtracted, setStarsExtracted] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [debouncedParams, setDebouncedParams] = useState<ProcessParams>(DEFAULT_PARAMS);
  const effectiveShowOriginal = useMemo(
    () => showOriginal || showOriginalPinned,
    [showOriginal, showOriginalPinned]
  );

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedParams(params), 120);
    return () => clearTimeout(timer);
  }, [params]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'o') {
        event.preventDefault();
        setShowOriginalPinned((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const worker = new Worker(new URL('./imageProcessingWorker.ts', import.meta.url), {
      type: 'module',
    });
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.type === 'error') {
        if (message.id === processRequestIdRef.current) {
          setIsProcessing(false);
        }
        if (message.id === extractRequestIdRef.current) {
          setIsExtracting(false);
        }
        setErrorMessage(message.message);
        return;
      }

      if (message.type === 'processResult') {
        if (message.id !== processRequestIdRef.current) return;
        const ctx = canvasRef.current?.getContext('2d');
        const histCtx = histCanvasRef.current?.getContext('2d');
        if (ctx) {
          const safeRenderData = new Uint8ClampedArray(message.renderData.length);
          safeRenderData.set(message.renderData);
          ctx.putImageData(new ImageData(safeRenderData, message.width, message.height), 0, 0);
        }
        if (histCtx) {
          let maxCount = 1;
          for (let i = 1; i < 255; i++) {
            if (message.rHist[i] > maxCount) maxCount = message.rHist[i];
            if (message.gHist[i] > maxCount) maxCount = message.gHist[i];
            if (message.bHist[i] > maxCount) maxCount = message.bHist[i];
          }
          drawHistogram(histCtx, message.rHist, message.gHist, message.bHist, maxCount);
        }
        setIsProcessing(false);
        return;
      }

      if (message.id !== extractRequestIdRef.current) return;
      starlessImageRef.current = {
        width: message.width,
        height: message.height,
        data: message.starlessData,
      };
      starMaskRef.current = {
        width: message.width,
        height: message.height,
        data: message.starMaskData,
      };
      setStarsExtracted(true);
      setIsExtracting(false);
      setParams((p) => ({ ...p }));
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const handleExtractStars = () => {
     if (!originalImageRef.current || !workerRef.current) return;
     const requestId = extractRequestIdRef.current + 1;
     extractRequestIdRef.current = requestId;
     setIsExtracting(true);
     setErrorMessage('');
     const sourceData = new Float32Array(originalImageRef.current.data);
     const request: WorkerRequest = {
       type: 'extractStars',
       id: requestId,
       width: originalImageRef.current.width,
       height: originalImageRef.current.height,
       sourceData,
     };
     workerRef.current.postMessage(request, [sourceData.buffer]);
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
      setErrorMessage('');
      const baseName = file.name.replace(/\.[^/.]+$/, "");
      setFileName(baseName + '_enhanced');
      if (file.name.toLowerCase().endsWith('.fit') || file.name.toLowerCase().endsWith('.fits')) {
         setIsProcessing(true);
         try {
           const buffer = await file.arrayBuffer();
           const astroImg = parseFITS(buffer);
           const scaledImg = downscaleAstroImage(astroImg, 2000);
           initImageSource(scaledImg);
         } catch (error) {
           const details = error instanceof Error ? error.message : 'Unknown FITS parsing failure';
           setErrorMessage(`Unable to load FITS file: ${details}`);
         } finally {
           setIsProcessing(false);
         }
      } else {
         const url = URL.createObjectURL(file);
         const img = new Image();
         img.onload = () => {
           try {
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
           } finally {
             URL.revokeObjectURL(url);
           }
         };
         img.onerror = () => {
           URL.revokeObjectURL(url);
           setErrorMessage('Unable to decode this image. Try another file format.');
         };
         img.src = url;
      }
    }
  };

  useEffect(() => {
    if (!canvasRef.current || !originalImageRef.current || !workerRef.current) return;
    
    if (effectiveShowOriginal) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
         const { width, height, data } = originalImageRef.current;
         const renderData = new Uint8ClampedArray(data.length);
         for(let i=0; i<data.length; i++) renderData[i] = data[i];
         ctx.putImageData(new ImageData(renderData, width, height), 0, 0);
      }
      return;
    }

    const sourceImage = starsExtracted && starlessImageRef.current ? starlessImageRef.current : originalImageRef.current;
    if (!sourceImage) return;

    const requestId = processRequestIdRef.current + 1;
    processRequestIdRef.current = requestId;
    setIsProcessing(true);
    setErrorMessage('');

    const sourceData = new Float32Array(sourceImage.data);
    const bgData = bgImageRef.current ? new Float32Array(bgImageRef.current.data) : null;
    const starMaskData =
      starsExtracted && starMaskRef.current
        ? new Float32Array(starMaskRef.current.data)
        : null;

    const request: WorkerRequest = {
      type: 'process',
      id: requestId,
      width: sourceImage.width,
      height: sourceImage.height,
      sourceData,
      bgData,
      starMaskData,
      params: debouncedParams,
    };

    const transfer: Transferable[] = [sourceData.buffer];
    if (bgData) transfer.push(bgData.buffer);
    if (starMaskData) transfer.push(starMaskData.buffer);
    workerRef.current.postMessage(request, transfer);
  }, [debouncedParams, effectiveShowOriginal, sourceLoaded, starsExtracted]);

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
                aria-label="Hold to view original image"
              >
                <Undo size={20} />
              </button>
              <button
                className={`action-btn ${showOriginalPinned ? 'primary' : ''}`}
                onClick={() => setShowOriginalPinned((prev) => !prev)}
                title="Toggle original preview (keyboard shortcut: O)"
                aria-label="Toggle original preview"
              >
                <ImageIcon size={20} />
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
        {errorMessage && (
          <p style={{ position: 'absolute', bottom: 16, left: 16, right: 16, color: '#ff7f7f', textAlign: 'center' }} role="alert">
            {errorMessage}
          </p>
        )}
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
                        onChange={(e) => setParams((prev) => ({ ...prev, removeGradient: e.target.checked }))}
                        aria-label="Toggle remove gradient"
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
                    onChange={(e) => setParams((prev) => ({ ...prev, blackPoint: Number(e.target.value) }))}
                    aria-label="Black point"
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
                    onChange={(e) => setParams((prev) => ({ ...prev, stretch: Number(e.target.value) }))}
                    aria-label="Arcsinh stretch"
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
                          onChange={(e) => setParams((prev) => ({ ...prev, starIntensity: Number(e.target.value) }))}
                          aria-label="Star intensity"
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
                    onChange={(e) => setParams((prev) => ({ ...prev, saturation: Number(e.target.value) }))}
                    aria-label="Saturation"
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
                    onChange={(e) => setParams((prev) => ({ ...prev, nebulaPop: Number(e.target.value) }))}
                    aria-label="Nebula pop"
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
                    onChange={(e) => setParams((prev) => ({ ...prev, temperature: Number(e.target.value) }))}
                    aria-label="Temperature"
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
                    onChange={(e) => setParams((prev) => ({ ...prev, denoise: Number(e.target.value) }))}
                    aria-label="Denoise"
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
