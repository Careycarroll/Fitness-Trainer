import { defs } from './engine/defs.js';
import { mount } from './ui/app.js';

mount(document.getElementById('app'), defs);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
