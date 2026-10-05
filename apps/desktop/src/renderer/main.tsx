// Сторінка центру керування (.claude/logic/09-ui.md). Крок 1.1 — каркас: з'єднання з core, стан ШІ,
// поле команди й відповіді; розділи центру керування — крок 1.7.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles.css';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
