# Graph Report - .  (2026-08-10)

## Corpus Check
- Corpus is ~3,399 words - fits in a single context window. You may not need a graph.

## Summary
- 123 nodes · 119 edges · 29 communities (10 shown, 19 thin omitted)
- Extraction: 92% EXTRACTED · 7% INFERRED · 2% AMBIGUOUS · INFERRED: 8 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Product Docs & Packaging
- npm Script Pipeline
- Renderer TypeScript Config
- Package Manifest & Runtime Deps
- Main Process TypeScript Config
- React Renderer UI
- Shared TS Types & Base Config
- Root TSConfig References
- Electron Runtime Dependency
- electron-builder Packaging Dep
- ESLint Prettier Config Dep
- ESLint TypeScript Config Dep
- electron-vite Build Dep
- ESLint Core Dependency
- eslint-plugin-react Dep
- React Hooks Lint Dep
- React Refresh Lint Dep
- Prettier Formatter Dep
- React Library Dep
- React DOM Dep
- Node Type Definitions
- TypeScript Compiler Dep
- Vite Bundler Dep
- Vite React Plugin Dep
- Preload Context Bridge API
- Preload Window Type Declarations

## God Nodes (most connected - your core abstractions)
1. `scripts` - 14 edges
2. `include` - 5 edges
3. `compilerOptions` - 5 edges
4. `include` - 4 edges
5. `compilerOptions` - 3 edges
6. `README (jarvis)` - 3 edges
7. `Electron + React + TypeScript app` - 3 edges
8. `npm scripts (dev/build:win/build:mac/build:linux)` - 3 edges
9. `VSCode + ESLint + Prettier setup` - 3 edges
10. `renderer index.html` - 3 edges

## Surprising Connections (you probably didn't know these)
- `Electron logo asset` --branding_for--> `Electron + React + TypeScript app`  [AMBIGUOUS]
  src/renderer/src/assets/electron.svg → README.md
- `App icon (resources/icon.png)` --identifies--> `appId com.electron.app / productName jarvis`  [INFERRED]
  resources/icon.png → electron-builder.yml
- `Content-Security-Policy (default-src 'self')` --hardens--> `Electron + React + TypeScript app`  [INFERRED]
  src/renderer/index.html → README.md
- `Build targets (nsis, dmg, AppImage/snap/deb)` --invoked_by--> `npm scripts (dev/build:win/build:mac/build:linux)`  [INFERRED]
  electron-builder.yml → README.md
- `Wavy-lines background asset` --co_located_with--> `Electron logo asset`  [AMBIGUOUS]
  src/renderer/src/assets/wavy-lines.svg → src/renderer/src/assets/electron.svg

## Import Cycles
- None detected.

## Communities (29 total, 19 thin omitted)

### Community 0 - "Product Docs & Packaging"
Cohesion: 0.15
Nodes (11): App icon (resources/icon.png), appId com.electron.app / productName jarvis, Generic auto-update publish provider, Build targets (nsis, dmg, AppImage/snap/deb), Electron + React + TypeScript app, macOS entitlements (camera, microphone, Documents, Downloads), npm scripts (dev/build:win/build:mac/build:linux), README (jarvis) (+3 more)

### Community 1 - "npm Script Pipeline"
Cohesion: 0.14
Nodes (14): scripts, build, build:linux, build:mac, build:unpack, build:win, dev, format (+6 more)

### Community 2 - "Renderer TypeScript Config"
Cohesion: 0.15
Nodes (13): @electron-toolkit/tsconfig/tsconfig.web.json, src/preload/*.d.ts, src/renderer/src/**/*, src/renderer/src/env.d.ts, src/renderer/src/**/*.tsx, compilerOptions, baseUrl, composite (+5 more)

### Community 3 - "Package Manifest & Runtime Deps"
Cohesion: 0.17
Nodes (11): @electron-toolkit/preload, @electron-toolkit/utils, author, dependencies, @electron-toolkit/preload, @electron-toolkit/utils, description, homepage (+3 more)

### Community 4 - "Main Process TypeScript Config"
Cohesion: 0.18
Nodes (10): @electron-toolkit/tsconfig/tsconfig.node.json, electron.vite.config.*, electron-vite/node, src/main/**/*, src/preload/**/*, compilerOptions, composite, types (+2 more)

### Community 5 - "React Renderer UI"
Cohesion: 0.36
Nodes (5): Content-Security-Policy (default-src 'self'), #root mount point, renderer index.html, App(), Versions()

### Community 6 - "Shared TS Types & Base Config"
Cohesion: 0.29
Nodes (7): @electron-toolkit/tsconfig, devDependencies, @electron-toolkit/tsconfig, @types/react, @types/react-dom, @types/react, @types/react-dom

## Ambiguous Edges - Review These
- `Electron + React + TypeScript app` → `Electron logo asset`  [AMBIGUOUS]
  src/renderer/src/assets/electron.svg · relation: branding_for
- `Electron logo asset` → `Wavy-lines background asset`  [AMBIGUOUS]
  src/renderer/src/assets/wavy-lines.svg · relation: co_located_with

## Knowledge Gaps
- **62 isolated node(s):** `name`, `version`, `description`, `main`, `author` (+57 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **19 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Electron + React + TypeScript app` and `Electron logo asset`?**
  _Edge tagged AMBIGUOUS (relation: branding_for) - confidence is low._
- **What is the exact relationship between `Electron logo asset` and `Wavy-lines background asset`?**
  _Edge tagged AMBIGUOUS (relation: co_located_with) - confidence is low._
- **Why does `devDependencies` connect `Shared TS Types & Base Config` to `Package Manifest & Runtime Deps`, `Electron Runtime Dependency`, `electron-builder Packaging Dep`, `ESLint Prettier Config Dep`, `ESLint TypeScript Config Dep`, `electron-vite Build Dep`, `ESLint Core Dependency`, `eslint-plugin-react Dep`, `React Hooks Lint Dep`, `React Refresh Lint Dep`, `Prettier Formatter Dep`, `React Library Dep`, `React DOM Dep`, `Node Type Definitions`, `TypeScript Compiler Dep`, `Vite Bundler Dep`, `Vite React Plugin Dep`?**
  _High betweenness centrality (0.340) - this node is a cross-community bridge._
- **Why does `npm scripts (dev/build:win/build:mac/build:linux)` connect `Product Docs & Packaging` to `Package Manifest & Runtime Deps`?**
  _High betweenness centrality (0.197) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _62 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `npm Script Pipeline` be split into smaller, more focused modules?**
  _Cohesion score 0.14285714285714285 - nodes in this community are weakly interconnected._