import { createRoot } from 'react-dom/client';
import Home from '../app/page';
import '../app/globals.css';

// Invitations are consumed once on mount. Keep a single root for the room lifecycle.
createRoot(document.getElementById('root')!).render(<Home />);
