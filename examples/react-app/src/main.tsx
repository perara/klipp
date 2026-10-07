import { registerCanvas } from 'klipp/canvas';
import type {} from 'klipp/client';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// The screenshot e2e fixture checks registration behind the same production flag as an app.
if (import.meta.env.KLIPP) Object.assign(window, { exampleRegisterCanvas: registerCanvas });
