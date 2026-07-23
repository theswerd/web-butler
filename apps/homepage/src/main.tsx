import { createRoot } from 'react-dom/client';
import './demo.css';
import { Demo } from './Demo';

createRoot(document.getElementById('demo-mount')!).render(<Demo />);
