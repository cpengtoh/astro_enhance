export type ProcessParams = {
  blackPoint: number;
  stretch: number;
  saturation: number;
  temperature: number;
  nebulaPop: number;
  removeGradient: boolean;
  starIntensity: number;
  denoise: number;
};

export type ProcessWorkerRequest = {
  type: 'process';
  id: number;
  width: number;
  height: number;
  sourceData: Float32Array;
  bgData: Float32Array | null;
  starMaskData: Float32Array | null;
  params: ProcessParams;
};

export type ExtractWorkerRequest = {
  type: 'extractStars';
  id: number;
  width: number;
  height: number;
  sourceData: Float32Array;
};

export type WorkerRequest = ProcessWorkerRequest | ExtractWorkerRequest;

export type ProcessWorkerResponse = {
  type: 'processResult';
  id: number;
  width: number;
  height: number;
  renderData: Uint8ClampedArray;
  rHist: Uint32Array;
  gHist: Uint32Array;
  bHist: Uint32Array;
};

export type ExtractWorkerResponse = {
  type: 'extractStarsResult';
  id: number;
  width: number;
  height: number;
  starlessData: Float32Array;
  starMaskData: Float32Array;
};

export type WorkerErrorResponse = {
  type: 'error';
  id: number;
  message: string;
};

export type WorkerResponse =
  | ProcessWorkerResponse
  | ExtractWorkerResponse
  | WorkerErrorResponse;
