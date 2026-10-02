import { OBJECT_KEY } from '../shared/id.js';
import type { Box, CanvasAdapter, CanvasTarget, Details, Point } from './registry.js';

/** The parts of a three.js `Vector3` Klipp uses. */
export interface Vector3Like {
  x: number;
  y: number;
  z: number;
  clone(): Vector3Like;
  set(x: number, y: number, z: number): Vector3Like;
  sub(other: Vector3Like): Vector3Like;
  normalize(): Vector3Like;
  applyMatrix4(matrix: unknown): Vector3Like;
  project(camera: unknown): Vector3Like;
  unproject(camera: unknown): Vector3Like;
}

/** The parts of a three.js camera Klipp uses. */
interface CameraLike {
  isPerspectiveCamera?: boolean;
  isOrthographicCamera?: boolean;
  projectionMatrix?: unknown;
  projectionMatrixInverse?: { copy(matrix: unknown): { invert(): unknown } };
}

interface Matrix4Like {
  clone(): Matrix4Like;
  premultiply(matrix: unknown): Matrix4Like;
}

/** The parts of a three.js `Object3D` Klipp uses. */
export interface Object3DLike {
  name: string;
  type: string;
  visible: boolean;
  parent: Object3DLike | null;
  children: Object3DLike[];
  userData: Record<string, unknown>;
  matrixWorld: unknown;
  geometry?: {
    type?: string;
    boundingBox?: { min: Vector3Like; max: Vector3Like } | null;
    computeBoundingBox?(): void;
  };
  material?: { type?: string } | Array<{ type?: string }>;
  /** An `InstancedMesh`'s per-instance matrix. */
  getMatrixAt?(index: number, matrix: unknown): void;
}

export interface Intersection {
  object: Object3DLike;
  point: Vector3Like;
  instanceId?: number;
}

/** The parts of a three.js `Raycaster` Klipp uses. */
export interface RaycasterLike {
  setFromCamera(coords: { x: number; y: number }, camera: unknown): void;
  intersectObjects(objects: Object3DLike[], recursive?: boolean): Intersection[];
  ray?: { origin: Vector3Like; direction: Vector3Like };
  camera?: unknown;
}

export interface ThreeOptions {
  /** The scene, or a function returning it when it can change. */
  scene: Object3DLike | (() => Object3DLike);
  /**
   * The camera, or a function returning it when it can change. A camera whose projection
   * matrix is set by hand, as in a MapLibre custom layer, works too.
   */
  camera: unknown;
  /** A `new THREE.Raycaster()`; a react-three-fiber app can pass its own `raycaster`. */
  raycaster: RaycasterLike;
  /** Leave objects out, such as helpers or an invisible ground plane. */
  filter?: (object: Object3DLike) => boolean;
  /** A name for people. Default: the object's type and name. */
  label?: (object: Object3DLike) => string | undefined;
  /** `userData` keys whose values the agent may see. */
  reveal?: string[];
}

const call = <T>(value: T | (() => T)): T =>
  typeof value === 'function' ? (value as () => T)() : value;

function visible(object: Object3DLike): boolean {
  for (let node: Object3DLike | null = object; node; node = node.parent) {
    if (!node.visible) return false;
  }
  return true;
}

/** The sid react-three-fiber objects carry from Klipp's build: the object's own, or its parent's. */
function sidOf(object: Object3DLike): string | undefined {
  for (let node: Object3DLike | null = object; node; node = node.parent) {
    const sid = node.userData?.[OBJECT_KEY];
    if (typeof sid === 'string') return sid;
  }
  return undefined;
}

function walk(root: Object3DLike, visit: (object: Object3DLike) => void) {
  visit(root);
  for (const child of root.children) walk(child, visit);
}

/**
 * Lets users point at what a three.js scene draws: the nearest visible object under the
 * pointer. Objects are named by the JSX that made them (react-three-fiber, stamped by Klipp's
 * build), else by their names down the scene graph.
 *
 *   registerCanvas(renderer.domElement, threeTargets({ scene, camera, raycaster: new Raycaster() }));
 */
export function threeTargets(options: ThreeOptions): CanvasAdapter {
  const scene = () => call(options.scene);
  const camera = () => call(options.camera);

  /** Points the raycaster through a spot on the canvas, given in normalised device coordinates. */
  function aim(ndc: { x: number; y: number }) {
    const view = camera() as CameraLike;
    const { raycaster } = options;
    const custom = !view.isPerspectiveCamera && !view.isOrthographicCamera;
    if (!custom || !raycaster.ray || !view.projectionMatrixInverse) {
      raycaster.setFromCamera(ndc, view);
      return;
    }
    // `setFromCamera` knows only perspective and orthographic cameras. Any other has its
    // projection set by hand, often without its inverse: unproject the spot at the near and
    // far planes instead.
    view.projectionMatrixInverse.copy(view.projectionMatrix).invert();
    const { origin, direction } = raycaster.ray;
    origin.set(ndc.x, ndc.y, -1).unproject(view);
    direction.set(ndc.x, ndc.y, 1).unproject(view).sub(origin).normalize();
    raycaster.camera = view;
  }

  /** A stable name: `sid:n` for stamped objects, else names (or `#index`) down from the scene. */
  function keyOf(object: Object3DLike): string {
    const sid =
      typeof object.userData?.[OBJECT_KEY] === 'string' ? object.userData[OBJECT_KEY] : '';
    if (sid) {
      let ordinal = 0;
      let found = 0;
      walk(scene(), (other) => {
        if (other.userData?.[OBJECT_KEY] === sid) {
          ordinal++;
          if (other === object) found = ordinal;
        }
      });
      return `${sid}:${found || 1}`;
    }
    // Down from the root Klipp was given, which may be a group inside the scene.
    const root = scene();
    const steps: string[] = [];
    for (let node = object; node !== root && node.parent; node = node.parent) {
      steps.unshift(node.name || `#${node.parent.children.indexOf(node)}`);
    }
    return steps.join('/');
  }

  function byKey(key: string): Object3DLike | undefined {
    const stamped = /^([0-9a-z]{8}):([1-9]\d*)$/.exec(key);
    let found: Object3DLike | undefined;
    if (stamped) {
      let ordinal = 0;
      walk(scene(), (object) => {
        if (object.userData?.[OBJECT_KEY] === stamped[1] && ++ordinal === Number(stamped[2])) {
          found ??= object;
        }
      });
      return found;
    }
    let node: Object3DLike | undefined = scene();
    for (const step of key.split('/')) {
      const index = /^#(\d+)$/.exec(step);
      node = index ? node?.children[Number(index[1])] : node?.children.find((c) => c.name === step);
    }
    return node;
  }

  /** The object's extent on screen: its bounding box's corners, projected. */
  function boxOf(object: Object3DLike, canvas: Element, instance?: number): Box | undefined {
    const geometry = object.geometry;
    if (!geometry) return undefined;
    if (!geometry.boundingBox) geometry.computeBoundingBox?.();
    const bounds = geometry.boundingBox;
    if (!bounds) return undefined;
    let matrix: unknown = object.matrixWorld;
    if (instance !== undefined && object.getMatrixAt) {
      const own = (object.matrixWorld as Matrix4Like).clone();
      object.getMatrixAt(instance, own);
      matrix = own.premultiply(object.matrixWorld);
    }
    const frame = canvas.getBoundingClientRect();
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const x of [bounds.min.x, bounds.max.x]) {
      for (const y of [bounds.min.y, bounds.max.y]) {
        for (const z of [bounds.min.z, bounds.max.z]) {
          const p = bounds.min.clone().set(x, y, z).applyMatrix4(matrix).project(camera());
          if (p.z > 1) continue; // behind the camera
          const sx = frame.left + ((p.x + 1) / 2) * frame.width;
          const sy = frame.top + ((1 - p.y) / 2) * frame.height;
          left = Math.min(left, sx);
          top = Math.min(top, sy);
          right = Math.max(right, sx);
          bottom = Math.max(bottom, sy);
        }
      }
    }
    left = Math.max(left, frame.left);
    top = Math.max(top, frame.top);
    right = Math.min(right, frame.right);
    bottom = Math.min(bottom, frame.bottom);
    return right > left && bottom > top
      ? { x: left, y: top, width: right - left, height: bottom - top }
      : undefined;
  }

  function target(object: Object3DLike, canvas: Element, instance?: number): CanvasTarget {
    const materials = [object.material ?? []].flat().map((m) => m.type ?? '?');
    const details: Details = {
      type: object.type,
      ...(object.name ? { name: object.name } : {}),
      ...(object.geometry?.type ? { geometry: object.geometry.type } : {}),
      ...(materials.length ? { material: materials.join(', ') } : {}),
      ...(instance !== undefined ? { instance } : {}),
    };
    for (const name of options.reveal ?? []) {
      const value = object.userData?.[name];
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        details[`userData.${name}`] = value;
      }
    }
    const sid = sidOf(object);
    const box = boxOf(object, canvas, instance);
    const name = `${object.type}${object.name ? ` "${object.name}"` : ''}`;
    const suffix = instance !== undefined ? `:i${instance}` : '';
    return {
      key: `${keyOf(object)}${suffix}`,
      label: `${options.label?.(object) ?? name}${instance !== undefined ? `, instance ${instance}` : ''}`,
      details,
      ...(sid ? { sid } : {}),
      ...(box ? { box } : {}),
    };
  }

  return {
    at(point: Point, canvas: Element) {
      const frame = canvas.getBoundingClientRect();
      if (!frame.width || !frame.height) return undefined;
      const ndc = {
        x: ((point.x - frame.left) / frame.width) * 2 - 1,
        y: -((point.y - frame.top) / frame.height) * 2 + 1,
      };
      aim(ndc);
      const hit = options.raycaster
        .intersectObjects(scene().children, true)
        .find((h) => visible(h.object) && (options.filter?.(h.object) ?? true));
      return hit ? target(hit.object, canvas, hit.instanceId) : undefined;
    },

    find(key: string, canvas: Element) {
      const instance = /:i(\d+)$/.exec(key);
      const object = byKey(instance ? key.slice(0, instance.index) : key);
      return object && visible(object)
        ? target(object, canvas, instance ? Number(instance[1]) : undefined)
        : undefined;
    },
  };
}
