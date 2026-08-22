repo: Cambo2k20/moviepicker
branch: feature/discordians-rebrand

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

### Data boundary

The prototype is front-end only. New entries, votes and room state live in the current browser session and are not yet written to Discord or a database. The next implementation phase should preserve the existing Discord Journal format and add authenticated persistence plus a Discord webhook or bot integration.

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
