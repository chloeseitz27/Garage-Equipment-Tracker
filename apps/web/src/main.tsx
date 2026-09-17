import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';

import { App } from './App.js';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('No #root element');
const router = createBrowserRouter([{ path: '*', element: <App /> }]);

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
