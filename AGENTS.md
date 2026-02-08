# Repository Guidelines

## Project Structure & Module Organization
- `src/`: Core TypeScript logic (scraping orchestration, transforms, CSV writer, config, reconciliation).
- `src/server/`: Express API server for scrape workflows.
- `src/**/*.test.ts`: Vitest unit tests.
- `gui/`: Vite + React frontend (separate `package.json`, tests, and configs).
- `output/` and `logs/`: Generated CSVs and runtime logs.
- `.env` / `.env.example`: Runtime configuration templates.

## Build, Test, and Development Commands
- `npm run dev`: Run CLI locally via `tsx`.
- `npm run scrape`: Execute a scrape from the CLI.
- `npm run dev:server`: Start the API server.
- `npm run dev:gui`: Start the GUI (`gui/`).
- `npm run dev:all`: Run server + GUI concurrently.
- `npm run build`: TypeScript build to `dist/`.
- `npm start`: Run built output.
- `npm test`: Run Vitest tests (root).
- `npm run lint` / `npm run format`: ESLint and Prettier (root).
- `npm --prefix gui run dev|test|lint|build`: GUI commands.

## Coding Style & Naming Conventions
- TypeScript, ES modules, 2-space indentation, semicolons, double quotes.
- Prettier settings: `printWidth: 100`, `singleQuote: false`.
- ESLint with `@typescript-eslint` rules; unused args should be prefixed with `_`.
- Follow existing patterns: kebab-case file names in `src/`, tests named `*.test.ts`.

## Testing Guidelines
- Framework: Vitest (Node environment).
- Test files live in `src/**/*.test.ts` and `gui/src/**` as needed.
- Coverage: `npm run test:coverage` (root) uses V8 coverage and excludes `src/index.ts`.

## Commit & Pull Request Guidelines
- Commit messages use short, imperative, sentence-case summaries (e.g., "Add server-side scrape cancel and filtering").
- PRs should include a concise summary, testing notes (commands run), and screenshots for GUI changes.
- Link related issues or TODOs when applicable.

## Configuration & Security Tips
- Create `.env` from `.env.example` if you don’t already have one, and keep secrets out of source control.
- The scraper dependency expects a sibling repo at `../israeli-bank-scrapers` for some workflows.