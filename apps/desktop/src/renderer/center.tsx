// Сторінка центру керування (.claude/logic/09-ui.md, «Центр керування»).
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CenterApp } from './center/CenterApp.tsx';
import './styles.css';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <CenterApp />
    </StrictMode>,
  );
}
