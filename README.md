# AstroEnhance v1.0.0

A professional-grade, browser-based astrophotography processing tool. AstroEnhance allows you to upload linear images directly from smart telescopes (like Seestar, Vaonis, Unistellar) and process them with extreme mathematical precision using a 32-bit floating-point engine entirely in your browser.

## Features

- **Native FITS Support**: Fully decodes 16-bit, 32-bit int, and 32-bit float FITS files locally, bypassing any server uploads.
- **32-Bit Floating Point Engine**: Manipulates image data using extreme precision floats to completely eliminate color banding or clipping during heavy non-linear stretching.
- **Background Extraction**: Automatically mathematically detects and subtracts light pollution gradients from your sky background.
- **Non-Linear Arcsinh Stretch**: A sophisticated hyperbolic arcsine stretch curve that reveals ultra-faint deep sky details without blowing out the bright cores of your stars.
- **Morphological Star Extraction**: Extracts stars from the nebula using mathematical morphology, allowing you to stretch the nebula independently without bloating the stars.
- **Edge-Preserving Wavelet Denoising**: Strips high-frequency grain and color noise from your image prior to stretching, while perfectly preserving sharp star points and intricate nebula structures.
- **Lossless Export**: Generates and downloads pure lossless PNG files to preserve every ounce of detail you extracted.

## How to Run Locally

1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the development server:
   ```bash
   npm run dev
   ```

## Progressive Web App (PWA)
AstroEnhance is a fully configured Progressive Web App. You can build the production bundle (`npm run build`) and host the `dist` folder on Netlify, Vercel, or GitHub Pages. Once hosted, users can open the URL on their iOS/Android devices and select "Add to Home Screen" to install it as a fully native, offline-capable application.

## Tech Stack
- React 18
- Vite
- TypeScript
- CSS3 (Custom Glassmorphic Styling)
- HTML5 Canvas & Web Workers
