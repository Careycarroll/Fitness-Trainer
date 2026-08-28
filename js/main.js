import { defs } from './engine/defs.js';
import { mount } from './ui/app.js';

mount(document.getElementById('app'), defs);

// The PLUGIN's registration, not a hand-rolled one.
//
// `registerType: 'autoUpdate'` in vite.config.js is not a build flag: it
// installs a runtime helper that polls for a new worker and reloads once the
// new one takes control. Registering './sw.js' directly skipped all of that —
// the new worker activated, claimed the page, and the tab carried on running
// the bundle it had already loaded. That is why "clear the service worker and
// hard refresh" was the standing workaround for a stale build.
import { registerSW } from 'virtual:pwa-register';

if (import.meta.env.PROD) {
  registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      // Poll hourly. Without this an installed standalone PWA only checks for a
      // new worker on a cold start, which can be days.
      if (registration) {
        setInterval(() => registration.update(), 60 * 60 * 1000);
      }
    }
  });
}
