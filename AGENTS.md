<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Project Guidelines

## Build And Verify

- Install dependencies with `npm install`.
- Run `npm run lint` before proposing completion.
- Run `npm run build` for changes that can affect routing, rendering mode, or compile-time behavior.
- Use `npm run dev` for local iteration.

## Architecture

- `app/page.tsx` is the primary analyzer UI: CSV ingest, question detection, scoring, ranking, and stage launch.
- `app/stage/page.tsx` is the presentation view for podium reveal and session-driven rendering.
- `app/stage/session.ts` owns stage session persistence and retrieval in `localStorage`.
- `app/globals.css` defines shared design tokens and global visual language.
- `data/` stores exported sample input files and should be treated as source data, not app logic.

## Conventions

- Preserve Spanish user-facing copy unless the task explicitly asks for translation.
- Keep ranking behavior aligned with `NON_QUESTION_COLUMNS` and `DEFAULT_ANSWER_PATTERNS` in `app/page.tsx`.
- Prefer normalized matching and deterministic scoring updates over heuristic rewrites.
- For hydration-sensitive client state, prefer `useSyncExternalStore` snapshots over hydration flags set in `useEffect`.

## Next.js And Rendering Pitfalls

- In this project, routes using `useSearchParams()` must keep the consumer wrapped in a `Suspense` boundary (see `app/stage/page.tsx`).
- Do not mix server-only APIs into client components that start with `"use client"`.
- If adding or changing framework APIs, consult `node_modules/next/dist/docs/` first due to version-specific breaking changes.

## Key References

- See `package.json` for authoritative scripts.
- See `app/page.tsx` for parsing/scoring patterns.
- See `app/stage/page.tsx` and `app/stage/session.ts` for stage session flow.
- See `README.md` only for baseline Next.js scaffold commands; treat source files above as project truth.
