# ADR-001 — Platform: Vite + vanilla JS PWA, phone-first

**Status:** ACCEPTED
**Date:** 2026-08-09
**Supersedes:** nothing
**Related:** ADR-004 (storage), ADR-005 (scaffolding)

---

## Decision

The app is a web PWA built with Vite and vanilla JavaScript, deployed to GitHub Pages via
GitHub Actions. There is **no desktop lane**. The primary design target is a phone held in one
hand, in a gym, with no network.

---

## Context

The usage context decides this and nothing else does. The app is consulted standing between
sets. That rules out PySide6 (the Econ-App lane) and Electron (the Script-Launcher lane)
regardless of how comfortable those stacks are, because neither runs on the device that is
actually present at the moment of use.

Vanilla JS over a framework: the project has an open-ended lifetime (ADR-007). Framework
churn is the dominant maintenance cost in long-lived side projects, and nothing here needs a
virtual DOM — the heaviest render is a list of sets.

---

## Consequences

**Positive**

- Zero install friction; the app is a URL that can be added to the home screen.
- Same deploy lane already proven twice in this portfolio.

**Negative / accepted**

- **Fully offline-capable is now a hard requirement, not a feature.** The service worker
  caches the app shell cache-first. A network-dependent design is inadmissible — this is the
  constraint that later kills the public-API options in ADR-006.
- No server means no cross-device sync in MVP. Mitigated by JSON export/import (ADR-004).
- **iOS Safari is the binding constraint for PWA capability testing.** Chrome desktop passing
  proves nothing. Storage eviction behaviour in particular differs, which is why ADR-011
  exists.

**Review condition**

Revisit only if a use case appears that genuinely cannot happen on a phone. Wanting a bigger
screen is not such a use case.
