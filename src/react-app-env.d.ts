/// <reference types="react-scripts" />

import type { RePitchAPI } from './electron/preload';

declare global {
  interface Window {
    repitch?: RePitchAPI;
  }
}

export {};
