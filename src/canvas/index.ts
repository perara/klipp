/**
 * Pointing at what a canvas draws. A canvas has no elements inside it, so the app tells Klipp
 * what is where: register the canvas with an adapter, such as the ones here for MapLibre GL
 * and three.js, or your own. Safe to ship: without Klipp running, registering does nothing.
 */
export {
  registerCanvas,
  canvasAdapterFor,
  type Box,
  type CanvasAdapter,
  type CanvasTarget,
  type Details,
  type Point,
} from './registry.js';
export {
  maplibreTargets,
  type MapFeature,
  type MapLike,
  type MapLibreOptions,
} from './maplibre.js';
export {
  threeTargets,
  type Intersection,
  type Object3DLike,
  type RaycasterLike,
  type ThreeOptions,
  type Vector3Like,
} from './three.js';
