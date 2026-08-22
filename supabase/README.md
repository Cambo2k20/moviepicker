# Discordians Supabase setup

Project: `tbmxxdodprmynyiiaofj`

The schema in `schema.sql` backs the private Journal. It deliberately contains no Discord integration, webhooks, bot tokens or OAuth permissions.

## Access model

- The frontend uses only the project's publishable key.
- Anonymous roles have no table or Journal-function privileges.
- Every exposed table has Row Level Security enabled.
- Signing in is not enough to read data: a user must also have a row in `group_memberships`.
- Journal entries may be edited or deleted only by their creator or a group administrator.
- New Journal entries and their viewers are written atomically by `create_journal_entry`.

## Approving the first administrator

1. In the Supabase Dashboard, open **Authentication → Users**.
2. Invite or create the user's email/password account.
3. Sign in once through the website so the `profiles` trigger creates their profile.
4. Add that profile to `The Discordians` in `group_memberships` with role `admin`.

Do not add a public sign-up control to the website. Users without a membership remain on the waiting-for-approval screen even if an account exists.

## Current persistence boundary

Journal entries and entry viewers are persistent. Queue voting, watch-party room state and Wrapped calculations remain prototype-only for now.
