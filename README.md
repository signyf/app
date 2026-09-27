# app

A modern React + TypeScript single-page application scaffolded with [Vite](https://vite.dev/).

## Requirements

- Node.js 22+
- npm 10+

## Getting started

Install dependencies:

```bash
npm install
```

Start the development server (defaults to http://localhost:5173):

```bash
npm run dev
```

## Available scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server with HMR. |
| `npm run build` | Type-check and build the production bundle to `dist/`. |
| `npm run preview` | Preview the production build locally. |
| `npm run lint` | Lint the codebase with [oxlint](https://oxc.rs/docs/guide/usage/linter). |
| `npm run typecheck` | Run the TypeScript compiler in no-emit mode. |
| `npm run test` | Run the unit tests once with [Vitest](https://vitest.dev/). |
| `npm run test:watch` | Run Vitest in watch mode. |

## Project structure

```
.
├── index.html          # App entry HTML
├── src/
│   ├── App.tsx         # Root React component
│   ├── App.test.tsx    # Component tests
│   ├── main.tsx        # React entry point
│   └── test/setup.ts   # Test environment setup
├── vite.config.ts      # Vite + Vitest configuration
└── package.json
```

## Testing

Unit and component tests use Vitest with Testing Library and a jsdom environment. Run them with:

```bash
npm run test
```
