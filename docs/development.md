# Development

The app uses React 18, TypeScript, Vite, and a Node.js HTTP server. It runs on Windows, macOS, and Linux with Node.js 22 or later.

## Run locally

```sh
git clone https://github.com/GhaffariZ/maktabkhooneh-downloader.git
cd maktabkhooneh-downloader
npm ci
npm run build
npm start -- --demo --no-open
```

Open `http://127.0.0.1:3210/` directly in your browser. Demo mode serves synthetic course data and video from disk. To use Vite hot reload, run `npm run dev:server -- --demo` in one terminal and `npm run dev` in another, then open `http://127.0.0.1:5173/`. Keep the development API on port 3210 because the Vite proxy uses that port.

## Project map

| Path | Responsibility |
| --- | --- |
| `client/` | Persian RTL dashboard, Video.js controls, browser-managed progress and preferences |
| `server/` | Loopback-only API, upstream account and course integration, HTTP range streaming, persistent download queue |
| `shared/` | Types used by the dashboard and API |
| `server/demo/` | Synthetic course fixtures and a short test video |
| `scripts/start.mjs` | Cross-platform launcher for the production build |
| `tests/` | Frontend and backend tests, including isolated HTTP fixtures |

The server binds to `127.0.0.1`. Keep that boundary when working on authentication, local-file access, and the download API. Exercise media paths with demo assets or content you have permission to access. Keep `data/`, downloads, credentials, and account-specific logs out of commits and issues.

## Checks and release

```sh
npm run typecheck
npm test
npm run build
```

GitHub Actions runs these checks on Windows, macOS, and Linux with Node.js 22. `npm run build` writes the bundled client and compiled server under `dist/`. GitHub release archives contain the tagged source. Build and run them with the same npm commands.
