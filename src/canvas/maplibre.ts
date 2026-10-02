import type { Box, CanvasAdapter, CanvasTarget, Details, Point } from './registry.js';

/** A rendered feature, as MapLibre GL (or Mapbox GL) returns it. */
export interface MapFeature {
  id?: string | number | undefined;
  layer: { id: string; type?: string | undefined };
  source: string;
  sourceLayer?: string | undefined;
  geometry: { type: string; coordinates?: unknown };
  properties?: Record<string, unknown> | null | undefined;
}

/** The parts of a MapLibre GL map Klipp uses. */
export interface MapLike {
  getCanvas(): HTMLCanvasElement;
  queryRenderedFeatures(
    where?: [number, number] | { layers?: string[] },
    options?: { layers?: string[] },
  ): MapFeature[];
  project(lngLat: [number, number]): { x: number; y: number };
  getLayer?(id: string): unknown;
  loaded?(): boolean;
  once?(type: 'idle', listener: () => void): unknown;
}

export interface MapLibreOptions {
  /** Only features in these layers. Default: every rendered layer, the base map's too. */
  layers?: string[] | undefined;
  /** A feature's id, for links. Default: the feature's own `id`. */
  id?: ((feature: MapFeature) => string | number | undefined) | undefined;
  /** A name for people, such as the feature's title. Default: its geometry, id and layer. */
  label?: ((feature: MapFeature) => string | undefined) | undefined;
  /**
   * Properties whose values the agent may see, such as `kind` or `status`. Every other
   * property is named without its value, since features can carry names and addresses.
   */
  reveal?: string[] | undefined;
}

/** How many coordinates go into a feature's box; enough for its extent, cheap on huge shapes. */
const MAX_COORDINATES = 5000;
/** The box drawn around a point feature, in pixels. */
const POINT_BOX = 16;

function coordinates(geometry: MapFeature['geometry']): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const visit = (value: unknown) => {
    if (out.length >= MAX_COORDINATES || !Array.isArray(value)) return;
    if (typeof value[0] === 'number' && typeof value[1] === 'number') {
      out.push([value[0], value[1]]);
    } else {
      for (const item of value) visit(item);
    }
  };
  visit(geometry.coordinates);
  return out;
}

const clip = (box: Box, frame: DOMRect): Box | undefined => {
  const left = Math.max(box.x, frame.left);
  const top = Math.max(box.y, frame.top);
  const right = Math.min(box.x + box.width, frame.right);
  const bottom = Math.min(box.y + box.height, frame.bottom);
  return right > left && bottom > top
    ? { x: left, y: top, width: right - left, height: bottom - top }
    : undefined;
};

const primitive = (value: unknown): string | number | boolean =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? value
    : value === null || value === undefined
      ? String(value)
      : '[object]';

/**
 * Lets users point at what a MapLibre GL map draws: the topmost rendered feature under the
 * pointer, named by its layer and id.
 *
 *   registerCanvas(map.getCanvas(), maplibreTargets(map, { layers: ['incidents'] }));
 */
export function maplibreTargets(map: MapLike, options: MapLibreOptions = {}): CanvasAdapter {
  const idOf = (feature: MapFeature) => options.id?.(feature) ?? feature.id;
  const layers = () => options.layers?.filter((layer) => !map.getLayer || map.getLayer(layer));

  /** The features' extent on screen, in viewport pixels. */
  function boxOf(features: MapFeature[]): Box | undefined {
    const frame = map.getCanvas().getBoundingClientRect();
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const feature of features) {
      for (const lngLat of coordinates(feature.geometry)) {
        const { x, y } = map.project(lngLat);
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
    if (!Number.isFinite(left)) return undefined;
    const pad = right - left < POINT_BOX && bottom - top < POINT_BOX ? POINT_BOX / 2 : 0;
    const box = {
      x: frame.left + left - pad,
      y: frame.top + top - pad,
      width: right - left + 2 * pad,
      height: bottom - top + 2 * pad,
    };
    return clip(box, frame);
  }

  /** Its layer and id, or its first coordinate when it has no id. */
  function keyOf(feature: MapFeature): string {
    const id = idOf(feature);
    if (id !== undefined) return `${feature.layer.id}:${id}`;
    const [first] = coordinates(feature.geometry);
    return `${feature.layer.id}:@${first ? first.map((n) => n.toFixed(6)).join(',') : ''}`;
  }

  function target(feature: MapFeature, all: MapFeature[]): CanvasTarget {
    const id = idOf(feature);
    const names = Object.keys(feature.properties ?? {});
    const details: Details = {
      layer: feature.layer.id,
      ...(feature.layer.type ? { layerType: feature.layer.type } : {}),
      source: feature.source,
      ...(feature.sourceLayer ? { sourceLayer: feature.sourceLayer } : {}),
      geometry: feature.geometry.type,
      ...(id !== undefined ? { id: primitive(id) } : {}),
      ...(names.length ? { properties: names.join(', ') } : {}),
    };
    for (const name of options.reveal ?? []) {
      if (feature.properties && name in feature.properties) {
        details[`property.${name}`] = primitive(feature.properties[name]);
      }
    }
    const fallback = `${feature.geometry.type}${id !== undefined ? ` ${id}` : ''} in layer ${feature.layer.id}`;
    // A feature split across tiles comes back once per tile: its box covers every piece.
    const key = keyOf(feature);
    const box = boxOf(all.filter((other) => keyOf(other) === key));
    return {
      key,
      label: options.label?.(feature) ?? fallback,
      details,
      ...(box ? { box } : {}),
    };
  }

  return {
    at(point: Point) {
      const frame = map.getCanvas().getBoundingClientRect();
      const local: [number, number] = [point.x - frame.left, point.y - frame.top];
      const only = layers();
      const [top] = map.queryRenderedFeatures(local, only ? { layers: only } : {});
      // Runs as the pointer moves, so only the piece under it is measured, not the whole layer.
      return top ? target(top, [top]) : undefined;
    },

    async find(key: string) {
      if (map.loaded && !map.loaded() && map.once) {
        await new Promise<void>((done) => {
          const timer = setTimeout(done, 10_000);
          map.once!('idle', () => {
            clearTimeout(timer);
            done();
          });
        });
      }
      const layer = key.slice(0, key.indexOf(':'));
      if (!layer || (map.getLayer && !map.getLayer(layer))) return undefined;
      const features = map.queryRenderedFeatures({ layers: [layer] });
      const match = features.find((feature) => keyOf(feature) === key);
      return match ? target(match, features) : undefined;
    },
  };
}
