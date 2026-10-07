/// <reference types="vite/client" />
import type { BcisBridge } from '../../shared/bridge';

declare global {
  interface Window {
    /** Narrow typed API exposed by the preload script. */
    bcis: BcisBridge;
  }
}

declare module '*.css';
