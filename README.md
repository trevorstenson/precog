# navbandit

LinUCB contextual bandit that learns which pages to prefetch from a user's navigation patterns. It runs in a Service Worker, watches navigations, and sends predictions to the [Speculation Rules API](https://developer.chrome.com/docs/web-platform/prerender-pages). 100% client-side.

## Install

```bash
npm install navbandit
```

## Usage

**Service Worker** (`sw.ts`):

```typescript
import { createBanditSW } from 'navbandit/sw'

const bandit = createBanditSW({ discount: 0.95, alpha: 1.0 })
self.addEventListener('fetch', (e) => bandit.handleFetch(e))
self.addEventListener('message', (e) => bandit.handleMessage(e))
```

`handleFetch` never calls `respondWith()`. It only observes navigations via `waitUntil()`, so it works alongside your existing fetch handlers.

**Main thread** (`main.ts`):

```typescript
import { createBanditClient } from 'navbandit/client'

const cleanup = createBanditClient()
```

The client finds same-origin links on each page, listens for predictions from the service worker, and inserts `<script type="speculationrules">` rules. In browsers without Speculation Rules support, it falls back to `<link rel="prefetch">`. If the user later navigates to a predicted URL, the service worker records that reward automatically.

## Config

| Option | Default | Description |
|--------|---------|-------------|
| `alpha` | `1.0` | Exploration weight; higher values try more uncertain options |
| `discount` | `0.95` | DUCB discount factor; lower values adapt faster |
| `dimensions` | `8` | Context vector size |
| `topK` | `3` | URLs to prefetch per navigation |
| `pruneAfter` | `50` | Drop arms not seen in this many navigations |

## How it works

On each navigation, the service worker builds an 8-dimensional context vector from things like route hash, time of day, session depth, and connection type. It scores the known URLs with LinUCB and sends the top `K` predictions to the main thread with `postMessage()`. The main thread then inserts Speculation Rules using confidence levels like `eager`, `moderate`, and `conservative`.

When a user navigates to a predicted URL, the bandit records a reward of `1` and updates that arm with a Sherman-Morrison rank-1 update, so it does not need to invert a matrix on every step. DUCB discounting helps it adapt as navigation patterns change. State is stored in IndexedDB across sessions.

## Browser support

- **Chrome/Edge 121+**: Speculation Rules API with eagerness levels
- **Other browsers**: falls back to `<link rel="prefetch">`

## License

MIT
