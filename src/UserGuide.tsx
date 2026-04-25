import { X } from 'lucide-react';

export function UserGuide({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <header className="modal-header">
          <h2>User Guide</h2>
          <button className="close-btn" onClick={onClose}><X size={24} /></button>
        </header>
        <div className="modal-body">
          <h3>Welcome to AstroEnhance</h3>
          <p>This tool is specifically designed for processing linear astrophotography images from smart telescopes like Vaonis, Unistellar, or ZWO Seestar.</p>
          
          <h4>1. Uploading an Image</h4>
          <p>Export a linear image (<strong>FITS</strong>/TIFF/PNG/JPEG) from your telescope and upload it. FITS files are processed in true 32-bit float precision to eliminate color banding! Linear images will appear almost completely black initially—this is normal!</p>

          <h4>2. Light Tab & Starless Workflow</h4>
          <ul>
            <li><strong>Remove Light Pollution Gradient:</strong> Automatically detects and mathematically subtracts light pollution gradients. Keep this checked if your background sky looks unnaturally bright or uneven.</li>
            <li><strong>Black Point:</strong> Slowly increase this until the background sky becomes dark, but stop before you clip the faint edges of the nebula. <em>Use the Live Histogram to ensure the left-most curve doesn't crash into the edge!</em></li>
            <li><strong>Arcsinh Stretch:</strong> Unlike standard contrast sliders, this strictly non-linear stretch reveals faint deep-sky details without blowing out the bright cores of stars or destroying their color.</li>
            <li><strong>Star Extraction (Morphological):</strong> Extracts the stars from the nebula so they are processed independently! Once extracted, your Arcsinh stretch will only affect the faint dust, preventing stars from becoming bloated. You can then use the <strong>Star Intensity</strong> slider to dial down the brightness of the stars.</li>
          </ul>

          <h4>3. Color & Detail Tab</h4>
          <ul>
            <li><strong>Saturation:</strong> Boosts overall color.</li>
            <li><strong>Nebula Pop:</strong> Targets the mid-tones dynamically to bring out the color of faint dust and gas without over-saturating the dark sky background.</li>
            <li><strong>Temperature:</strong> Adjusts the white balance from cool (blue) to warm (orange).</li>
            <li><strong>Wavelet Denoise:</strong> Employs an edge-preserving filter to mathematically strip high-frequency grain and color noise from your image *before* stretching, while perfectly preserving sharp star points and nebula structures.</li>
          </ul>

          <h4>4. Pro Tips</h4>
          <ul>
            <li><strong>Before/After:</strong> Tap and hold the "Undo" arrow at the top right to instantly see your original unprocessed image.</li>
            <li><strong>Live Histogram:</strong> The graph above the sliders shows the distribution of Red, Green, and Blue pixels. A well-processed image usually has the main peak sitting slightly to the right of the left edge (not touching the left wall).</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
