import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CanvasDemo } from './CanvasDemo';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CanvasDemo />
  </StrictMode>,
);
