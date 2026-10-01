import { useState } from 'react';
import { Button } from './Button';

const UNITS = [
  { id: 'alpha', name: 'Alpha' },
  { id: 'beta', name: 'Beta' },
  { id: 'gamma', name: 'Gamma' },
];

export function App() {
  const [clicks, setClicks] = useState(0);
  const [units, setUnits] = useState(UNITS);
  return (
    <main className="page">
      <h1>Klipp example</h1>
      <p>
        Press <kbd>Alt+Shift+K</kbd> or click the paperclip, then point at something.
      </p>
      <section className="card">
        <p data-testid="clicks">Clicks: {clicks}</p>
        <div className="row">
          <Button onClick={() => setClicks((n) => n + 1)}>Count</Button>
          <Button onClick={() => setUnits((list) => [...list].reverse())}>Reverse</Button>
        </div>
      </section>
      <section className="card">
        <h2>Units</h2>
        <ul className="units">
          {units.map((unit) => (
            <li key={unit.id}>
              <span>{unit.name}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="card">
        <h2>A button nobody can press</h2>
        <div className="stack">
          <button type="button" disabled>
            Save
          </button>
          <div className="veil" />
        </div>
      </section>
    </main>
  );
}
