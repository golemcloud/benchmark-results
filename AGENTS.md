# AGENTS.md - Golem Benchmark Results Visualizer

## Commands
- **Dev server**: `npm run dev` (Vite dev server)
- **Build**: `npm run build` (Vite production build)
- **Test all**: `npm test` (Vitest run)
- **Test single**: `npm test -- src/some.test.ts` (Vitest single file)
- **Lint**: `npm run lint` (ESLint check)
- **Lint fix**: `npm run lint:fix` (Auto-fix ESLint issues)
- **Format**: `npm run format` (Prettier write)
- **Format check**: `npm run format:check` (Prettier check)

## Architecture
- **Framework**: Vite + TypeScript SPA
- **Data**: Static JSON (`results/results.json`) loaded at runtime
- **Rendering**: DOM manipulation for tables/charts (Chart.js), markdown (marked)
- **Structure**: `src/` with main.ts, types.ts, style.css; no backend/subprojects
- **APIs**: None (static app)

## Code Style
- **Types**: Strict TypeScript with interfaces in `types.ts`
- **Naming**: camelCase variables/functions, PascalCase interfaces/classes
- **Imports**: ES6 imports, group external first, then internal
- **Formatting**: 2-space indentation, semicolons, single quotes
- **Error Handling**: Try/catch for async ops, basic validation
- **Conventions**: Functional components, const/let, arrow functions
- **Comments**: JSDoc for functions, inline for complex logic

## Enforcement
- Agents must run `npm run lint:fix` and `npm run format` before committing changes.
- CI should run `npm run lint` and `npm run format:check` to prevent non-compliant code.

No Cursor/Claude/Windsurf/Cline/Goose/Copilot rules found.
