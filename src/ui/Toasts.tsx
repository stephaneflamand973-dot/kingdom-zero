import { useEffect } from 'react';
import type { Toast } from './useGame';

function ToastItem({ t, onDone }: { t: Toast; onDone: (id: number) => void }) {
  useEffect(() => {
    const h = window.setTimeout(() => onDone(t.id), t.tone === 'major' || t.tone === 'bad' ? 9000 : 6500);
    return () => window.clearTimeout(h);
  }, [t, onDone]);
  return (
    <li className={`toast ${t.tone}`}>
      <div className="toast-title">{t.title}</div>
      <div className="toast-text">{t.text}</div>
      <button className="toast-x" onClick={() => onDone(t.id)} aria-label="Masquer la notification">×</button>
    </li>
  );
}

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <ol className="toasts" aria-live="polite" aria-label="Notifications">
      {toasts.map(t => <ToastItem key={t.id} t={t} onDone={onDismiss} />)}
    </ol>
  );
}
