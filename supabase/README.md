# Discordians Supabase setup

Project: `tbmxxdodprmynyiiaofj`

The schema in `schema.sql` backs the private Journal. It deliberately contains no Discord integration, webhooks, bot tokens or OAuth permissions.

## Access model

- The frontend uses only the project's publishable key.
- Anonymous roles have no table or Journal-function privileges.
- Every exposed table has Row Level Security enabled.
- Signing in is not enough to read data: a user must also have a row in `group_memberships`.
- Signed-in non-members may only see the group name and their own access request. Journal data remains hidden by RLS.
- Journal entries may be edited or deleted only by their creator or a group administrator.
- New Journal entries and their viewers are written atomically by `create_journal_entry`.
- Member approvals, role changes and removals are restricted to group administrators.
- Movie-night sessions, participants, selected-film snapshots and resumable game state are stored separately from the Journal.
- Only the session host or a website administrator may change or end a session.
- The Discord Journal template is generated in the browser for manual copying; no Discord API, webhook or Journal-table write is involved.

## Approving the first administrator

1. In the Supabase Dashboard, open **Authentication → Users**.
2. Invite or create the user's email/password account.
3. Sign in once through the website so the `profiles` trigger creates their profile.
4. Add that profile to `The Discordians` in `group_memberships` with role `admin`.

## Member onboarding

Apply `member_management.sql` after the base schema. It adds the access-request table, secure member-management functions and the policies used by the Members screen.

1. A friend creates an account on the website and confirms their email if email confirmation is enabled.
2. They request access with the display name they use in the Journal.
3. An administrator opens **Members** and approves or declines the request.
4. Approval creates the profile/membership and removes the pending request in one database transaction.

Creating an account does not grant Journal access. A removed member immediately loses access through RLS. The flow does not contact Discord and requires no Discord permissions.

In **Authentication → URL Configuration**, set the Site URL and an allowed redirect URL to:

`https://cambo2k20.github.io/moviepicker/`

For stronger password screening, enable **Leaked password protection** in the Supabase Auth password settings.

## Movie-night sessions

Apply `movie_sessions.sql` to add the persistent Sessions feature. One session may remain open per group. Starting a session records its host and approved participants; Queue Roulette saves its filters, veto use and result so the room can be resumed after a refresh.

Confirming a film stores a snapshot of its title, year, artwork and metadata. This keeps the session history understandable even if the corresponding list item is removed later. Ending a session moves it to website session history without marking the film watched.

The optional **Copy for Discord** form is deliberately client-side. The entry number, viewers, status and comment are editable, and the resulting text is placed on the clipboard only after the user presses the copy button.

## Current persistence boundary

Journal entries, entry viewers, the movie list, voting and movie-night sessions are persistent. Discord posting, live multiplayer presence and Wrapped calculations remain outside this phase.
