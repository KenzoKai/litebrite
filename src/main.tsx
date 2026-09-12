import { createRoot } from 'react-dom/client';
import Home from '../app/page';
import '../app/globals.css';

// Keep a single root for the active room lifecycle.
createRoot(document.getElementById('root')!).render(<Home />);
