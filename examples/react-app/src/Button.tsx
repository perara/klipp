import type { ReactNode } from 'react';

export function Button({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className="btn" onClick={onClick}>
      {children}
    </button>
  );
}
