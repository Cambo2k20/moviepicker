# GitHub and deployment notes

`main` is the authoritative integration branch. Historical handoff branches are not required as starting points; fetch first, compare the active branch with `main`, and create a focused working branch before editing.

## Required checks

The validation workflow runs on pull requests and non-`main` branch pushes:

```bash
npm ci
npm run test:unit
npm run build
npm run test:e2e
```

The Pages workflow repeats those checks on `main`, uploads the generated `dist/` artifact and deploys only after validation succeeds. Repository Pages settings must select **GitHub Actions** as the source.

## Product boundary

- Queue Roulette is the only implemented decision game.
- Consensus Sprint and Reel Bracket are disabled placeholders.
- Journal storage exists in Supabase, but no active Journal frontend exists yet.
- Discord output is manual clipboard text; there is no Discord integration.

Never commit credentials, merge automatically or bypass the build/browser checks.
