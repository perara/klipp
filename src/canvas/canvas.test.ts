import { findTarget } from '../client/canvas-targets.js';
// @vitest-environment happy-dom
import {
  BoxGeometry,
  Camera,
  Vector3,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
} from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  canvasAdapterFor,
  maplibreTargets,
  registerCanvas,
  threeTargets,
  type MapFeature,
  type MapLike,
} from './index.js';

/** An element whose box is 400×300 at 100,50 on the page. */
function canvasAt(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.getBoundingClientRect = () =>
    ({
      left: 100,
      top: 50,
      right: 500,
      bottom: 350,
      width: 400,
      height: 300,
      x: 100,
      y: 50,
    }) as DOMRect;
  document.body.append(canvas);
  return canvas;
}

describe('registerCanvas', () => {
  it('finds the adapter of a canvas, or of an element around it, and lets it go', () => {
    const map = document.createElement('div');
    const canvas = document.createElement('canvas');
    map.append(canvas);
    const adapter = { at: () => undefined };
    const unregister = registerCanvas(map, adapter);
    expect(canvasAdapterFor(canvas)).toEqual({ canvas: map, adapter });
    unregister();
    expect(canvasAdapterFor(canvas)).toBeUndefined();
  });

  it('keeps one registry for every copy of the module', () => {
    const canvas = document.createElement('canvas');
    registerCanvas(canvas, { at: () => undefined });
    const shared = (globalThis as Record<symbol, WeakMap<Element, unknown>>)[
      Symbol.for('klipp.canvases')
    ];
    expect(shared?.has(canvas)).toBe(true);
  });

  it('asks the layer registered last first, as a 3D layer drawn over a map', async () => {
    const canvas = canvasAt();
    const target = (key: string) => ({ key, label: key });
    registerCanvas(canvas, {
      at: () => target('map'),
      find: (key) => (key === 'roads:1' ? target(key) : undefined),
    });
    const undo = registerCanvas(canvas, {
      at: (point) => (point.x < 200 ? target('tree') : undefined),
      find: (key) => (key === 'trees:i3' ? target(key) : undefined),
    });
    const { adapter } = canvasAdapterFor(canvas)!;
    expect(adapter.at({ x: 150, y: 100 }, canvas)?.key).toBe('tree');
    expect(adapter.at({ x: 300, y: 100 }, canvas)?.key).toBe('map');
    expect((await adapter.find!('roads:1', canvas))?.key).toBe('roads:1');
    expect((await adapter.find!('trees:i3', canvas))?.key).toBe('trees:i3');
    undo();
    expect(canvasAdapterFor(canvas)!.adapter.at({ x: 150, y: 100 }, canvas)?.key).toBe('map');
  });
});

describe('maplibreTargets', () => {
  const area: MapFeature = {
    id: 7,
    layer: { id: 'search-areas', type: 'fill' },
    source: 'incident',
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [10, 10],
          [20, 10],
          [20, 20],
          [10, 20],
          [10, 10],
        ],
      ],
    },
    properties: { name: 'Kari Nordmann', kind: 'search' },
  };
  const post: MapFeature = {
    layer: { id: 'posts', type: 'circle' },
    source: 'incident',
    geometry: { type: 'Point', coordinates: [30, 30] },
    properties: {},
  };

  /** A map whose pixels are lng/lat × 10. */
  function fakeMap(
    canvas: HTMLCanvasElement,
    features: MapFeature[],
  ): MapLike & { asked: unknown[] } {
    const asked: unknown[] = [];
    return {
      asked,
      getCanvas: () => canvas,
      getLayer: (id) => (['search-areas', 'posts'].includes(id) ? {} : undefined),
      project: ([lng, lat]) => ({ x: lng * 10, y: lat * 10 }),
      queryRenderedFeatures(where, options) {
        asked.push([where, options]);
        if (Array.isArray(where)) {
          const [x, y] = where;
          return x >= 100 && x <= 200 && y >= 100 && y <= 200 ? [area] : [];
        }
        return features.filter((f) => !where?.layers || where.layers.includes(f.layer.id));
      },
    };
  }

  it('names the topmost feature by layer and id, and says which properties it has, not their values', () => {
    const canvas = canvasAt();
    const map = fakeMap(canvas, [area, post]);
    const adapter = maplibreTargets(map, { reveal: ['kind'] });
    const target = adapter.at({ x: 250, y: 200 }, canvas)!;
    expect(map.asked[0]).toEqual([[150, 150], {}]);
    expect(target).toEqual({
      key: 'search-areas:7',
      label: 'Polygon 7 in layer search-areas',
      details: {
        layer: 'search-areas',
        layerType: 'fill',
        source: 'incident',
        geometry: 'Polygon',
        id: 7,
        properties: 'name, kind',
        'property.kind': 'search',
      },
      box: { x: 200, y: 150, width: 100, height: 100 },
    });
    expect(JSON.stringify(target)).not.toContain('Kari');
    expect(adapter.at({ x: 120, y: 60 }, canvas)).toBeUndefined();
  });

  it('asks only the layers it is given that exist', () => {
    const canvas = canvasAt();
    const map = fakeMap(canvas, [area]);
    maplibreTargets(map, { layers: ['search-areas', 'gone'] }).at({ x: 250, y: 200 }, canvas);
    expect(map.asked[0]).toEqual([[150, 150], { layers: ['search-areas'] }]);
  });

  it('finds a feature again by its key, by its first point when it has no id', async () => {
    const canvas = canvasAt();
    const adapter = maplibreTargets(fakeMap(canvas, [area, post]), {
      label: (f) => (f.layer.id === 'posts' ? 'Command post' : undefined),
    });
    expect((await adapter.find!('search-areas:7', canvas))?.box).toEqual({
      x: 200,
      y: 150,
      width: 100,
      height: 100,
    });
    const found = await adapter.find!('posts:@30.000000,30.000000', canvas);
    // A 16-pixel box around the point, cut at the canvas's bottom edge.
    expect(found).toMatchObject({
      label: 'Command post',
      box: { x: 392, y: 342, width: 16, height: 8 },
    });
    expect(await adapter.find!('posts:@1,1', canvas)).toBeUndefined();
    expect(await adapter.find!('nowhere:1', canvas)).toBeUndefined();
  });
});

describe('threeTargets', () => {
  function world() {
    const scene = new Scene();
    const camera = new PerspectiveCamera(50, 400 / 300, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const yard = new Group();
    yard.name = 'yard';
    const crate = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial());
    crate.name = 'Crate';
    crate.userData = { klipp: 'aaaaaaaa', owner: 'Kari', state: 'open' };
    const unnamed = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    unnamed.position.set(3, 0, 0);
    yard.add(crate, unnamed);
    const trees = new InstancedMesh(new BoxGeometry(0.5, 0.5, 0.5), new MeshBasicMaterial(), 2);
    trees.name = 'trees';
    trees.setMatrixAt(0, new Matrix4().makeTranslation(-3, 0, 0));
    trees.setMatrixAt(1, new Matrix4().makeTranslation(-3, 2, 0));
    scene.add(yard, trees);
    scene.updateMatrixWorld(true);
    const adapter = threeTargets({
      scene,
      camera: () => camera,
      raycaster: new Raycaster(),
      reveal: ['state'],
    });
    /** Where a world position lands on the 400×300 canvas at 100,50. */
    const screen = (x: number, y: number, z = 0) => {
      const p = new Vector3(x, y, z).project(camera);
      return { x: 100 + ((p.x + 1) / 2) * 400, y: 50 + ((1 - p.y) / 2) * 300 };
    };
    return { scene, camera, crate, unnamed, adapter, screen, canvas: canvasAt() };
  }

  /** The viewport point where a world position lands on the 400×300 canvas at 100,50. */
  const centre = { x: 300, y: 200 };

  it('names the nearest object by the JSX that made it, with its type and the userData it may tell', () => {
    const { adapter, canvas } = world();
    const target = adapter.at(centre, canvas)!;
    expect(target).toMatchObject({
      key: 'aaaaaaaa:1',
      label: 'Mesh "Crate"',
      sid: 'aaaaaaaa',
      details: {
        type: 'Mesh',
        name: 'Crate',
        geometry: 'BoxGeometry',
        material: 'MeshBasicMaterial',
        'userData.state': 'open',
      },
    });
    expect(JSON.stringify(target)).not.toContain('Kari');
    expect(target.box!.x + target.box!.width / 2).toBeCloseTo(300, 0);
    expect(target.box!.y + target.box!.height / 2).toBeCloseTo(200, 0);
    expect(adapter.at({ x: 110, y: 60 }, canvas)).toBeUndefined();
  });

  it('names an unstamped object by its path, and an instance by its index', () => {
    const { adapter, canvas, screen } = world();
    expect(adapter.at(screen(3, 0, 0.5), canvas)).toMatchObject({ key: 'yard/#1', label: 'Mesh' });
    expect(adapter.at(screen(-3, 2), canvas)).toMatchObject({
      key: 'trees:i1',
      label: 'Mesh "trees", instance 1',
      details: { instance: 1 },
    });
  });

  it('aims through a camera whose projection is set by hand, as a MapLibre layer does', () => {
    const { scene, screen, canvas } = world();
    const perspective = new PerspectiveCamera(50, 400 / 300, 0.1, 100);
    perspective.position.set(0, 0, 10);
    perspective.lookAt(0, 0, 0);
    perspective.updateMatrixWorld();
    // One matrix for projection and view, and an identity world matrix: the custom-layer way.
    const handSet = new Camera();
    handSet.projectionMatrix.multiplyMatrices(
      perspective.projectionMatrix,
      perspective.matrixWorldInverse,
    );
    const adapter = threeTargets({ scene, camera: handSet, raycaster: new Raycaster() });
    const target = adapter.at(screen(0, 0), canvas)!;
    expect(target.key).toBe('aaaaaaaa:1');
    expect(target.box!.x + target.box!.width / 2).toBeCloseTo(300, 0);
    expect(adapter.at(screen(-3, 2), canvas)?.key).toBe('trees:i1');
  });

  it('names objects from the root it is given, such as a content group inside the scene', async () => {
    const { scene, screen, canvas, camera } = world();
    const yard = scene.getObjectByName('yard')!;
    const adapter = threeTargets({ scene: yard, camera, raycaster: new Raycaster() });
    const side = adapter.at(screen(3, 0, 0.5), canvas)!;
    expect(side.key).toBe('#1');
    expect((await adapter.find!('#1', canvas))?.label).toBe('Mesh');
    // Outside that root, nothing is seen.
    expect(adapter.at(screen(-3, 2), canvas)).toBeUndefined();
  });

  it('finds objects again by their keys, and not hidden ones', async () => {
    const { adapter, canvas, crate } = world();
    expect(await adapter.find!('aaaaaaaa:1', canvas)).toMatchObject({ label: 'Mesh "Crate"' });
    expect(await adapter.find!('yard/#1', canvas)).toMatchObject({ key: 'yard/#1' });
    expect((await adapter.find!('trees:i1', canvas))?.box).toBeDefined();
    expect(await adapter.find!('aaaaaaaa:2', canvas)).toBeUndefined();
    crate.visible = false;
    expect(await adapter.find!('aaaaaaaa:1', canvas)).toBeUndefined();
    expect(adapter.at(centre, canvas)?.key).not.toBe('aaaaaaaa:1');
  });
});

it('cancels an old session’s pending canvas lookup without polling again', async () => {
  const canvas = canvasAt();
  let finish!: (target: undefined) => void;
  const find = vi.fn(
    () =>
      new Promise<undefined>((done) => {
        finish = done;
      }),
  );
  const stop = registerCanvas(canvas, { at: () => undefined, find });
  const abort = new AbortController();
  const finding = findTarget(canvas, 'old-target', 10_000, abort.signal);
  abort.abort();
  await expect(finding).rejects.toMatchObject({ name: 'AbortError' });
  finish(undefined);
  await Promise.resolve();
  expect(find).toHaveBeenCalledOnce();
  stop();
  canvas.remove();
});
