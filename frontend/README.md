# Brightloop OS frontend

The Brightloop web interface is built with React, TypeScript, Vite, and Three.js. The landing page uses a procedural Three.js revenue engine, while the workspace connects to the FastAPI backend.

For the full product overview, role descriptions, seeded demo accounts, and repository setup, see the [project README](../README.md).

## Run locally

The repository-level `start.ps1` script is the recommended way to start both the frontend and API. From the repository root, run:

```powershell
.\start.ps1
```

The frontend is served at `http://127.0.0.1:5173`.

## Frontend commands

Run these commands from this directory:

```powershell
npm install
npm run dev
npm run build
```

`npm run build` type-checks the app and creates the production frontend in `dist/`.
