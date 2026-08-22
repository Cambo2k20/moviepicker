repo: Cambo2k20/moviepicker
branch: feature/persistent-journal

## Discordians companion prototype

This branch turns the original movie picker into a broader private server companion. Cine-Cord remains the movie section, while the navigation establishes room for the Journal, watch-party decisions, Wrapped statistics and the shared queue.

### Included in this prototype

- Rebranded purple, grey and white Discordians visual system
- Responsive home screen based on the selected design direction
- Watch-party setup with member selection and three decision modes
- Mini-game concepts: Consensus Sprint, Queue Roulette and Journal Recall
- End-of-watch Journal form with the familiar Discord bullet-format preview
- Searchable Journal entries using realistic sample data
- Wrapped awards and Cine-Cord totals
- Shared queue with local prototype voting

### Persistent Journal phase

- Supabase email/password authentication with no public sign-up interface
- Membership-gated private group access
- Persistent Journal reads and atomic entry creation
- Viewer validation against approved website members
- Explicit database grants and Row Level Security on every exposed table
- No Discord API, webhook, bot token, OAuth scope or server connection

Queue voting, watch-party rooms and Wrapped calculations remain prototype-only until their later persistence phases.

### Local development

```bash
npm install
npm run dev
```

Production check:

```bash
npm run build
```

The legacy prototype files remain in the repository for reference.
