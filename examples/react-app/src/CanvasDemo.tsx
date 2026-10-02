import { Canvas, useThree } from '@react-three/fiber';
import { maplibreTargets, registerCanvas, threeTargets } from 'klipp/canvas';
import { Map as MapLibreMap, setWorkerUrl, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { useEffect, useRef, useState, type DetailedHTMLProps, type HTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import './rating';

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'star-rating': DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}

declare global {
  interface Window {
    /** For the end-to-end tests: the map, to find where its features are drawn. */
    exampleMap?: MapLibreMap;
  }
}

/** An incident map with no tiles to fetch: a search area and a command post. */
const STYLE: StyleSpecification = {
  version: 8,
  sources: {
    incident: {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            id: 1,
            properties: { name: 'North sector', kind: 'search-area' },
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [8.58, 58.24],
                  [8.61, 58.24],
                  [8.61, 58.26],
                  [8.58, 58.26],
                  [8.58, 58.24],
                ],
              ],
            },
          },
          {
            type: 'Feature',
            id: 2,
            properties: { name: 'Command post', kind: 'post' },
            geometry: { type: 'Point', coordinates: [8.635, 58.25] },
          },
        ],
      },
    },
  },
  layers: [
    { id: 'land', type: 'background', paint: { 'background-color': '#e8efe4' } },
    {
      id: 'search-areas',
      type: 'fill',
      source: 'incident',
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': '#d4a72c', 'fill-opacity': 0.55 },
    },
    {
      id: 'posts',
      type: 'circle',
      source: 'incident',
      filter: ['==', ['geometry-type'], 'Point'],
      paint: { 'circle-radius': 12, 'circle-color': '#cf222e' },
    },
  ],
};

// Bundled by Vite, so the map's worker loads under the dev server and from a build alike.
setWorkerUrl(workerUrl);

function IncidentMap() {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const map = new MapLibreMap({
      container: container.current!,
      style: STYLE,
      center: [8.61, 58.25],
      zoom: 12,
      attributionControl: false,
      fadeDuration: 0,
    });
    window.exampleMap = map;
    // What Klipp needs to tell the map's features apart. `kind` is safe to show; names aren't.
    const unregister = registerCanvas(
      map.getCanvas(),
      maplibreTargets(map, { layers: ['search-areas', 'posts'], reveal: ['kind'] }),
    );
    return () => {
      unregister();
      map.remove();
    };
  }, []);
  return <div ref={container} className="map" data-testid="map" />;
}

/** Tells Klipp what the react-three-fiber scene draws. */
function KlippTargets() {
  const { gl, scene, camera, raycaster } = useThree();
  useEffect(
    () => registerCanvas(gl.domElement, threeTargets({ scene, camera, raycaster })),
    [gl, scene, camera, raycaster],
  );
  return null;
}

function Scene() {
  return (
    <div className="scene" data-testid="scene">
      <Canvas camera={{ position: [0, 0, 6], fov: 50 }} frameloop="demand">
        <ambientLight intensity={1.2} />
        <directionalLight position={[2, 3, 4]} intensity={1.5} />
        <mesh name="Crate" position={[-1.4, 0, 0]}>
          <boxGeometry args={[1.6, 1.6, 1.6]} />
          <meshStandardMaterial color="#d4a72c" />
        </mesh>
        <mesh name="Beacon" position={[1.5, 0, 0]}>
          <sphereGeometry args={[0.9, 32, 16]} />
          <meshStandardMaterial color="#0969da" />
        </mesh>
        <KlippTargets />
      </Canvas>
    </div>
  );
}

/** The app's own JSX, rendered into a shadow root. */
function ShadowCard() {
  const host = useRef<HTMLDivElement>(null);
  const [root, setRoot] = useState<ShadowRoot | null>(null);
  useEffect(() => {
    const element = host.current!;
    setRoot(element.shadowRoot ?? element.attachShadow({ mode: 'open' }));
  }, []);
  return (
    <div ref={host} className="shadow-card">
      {root && createPortal(<button type="button">Inside a shadow root</button>, root)}
    </div>
  );
}

export function CanvasDemo() {
  return (
    <main className="page">
      <h1>Maps, 3D and web components</h1>
      <p>Point at a map feature, a 3D object, or a star in the rating.</p>
      <section className="card">
        <h2>Incident map</h2>
        <IncidentMap />
      </section>
      <section className="card">
        <h2>Equipment</h2>
        <Scene />
      </section>
      <section className="card">
        <h2>Rating</h2>
        <star-rating />
        <ShadowCard />
      </section>
    </main>
  );
}
