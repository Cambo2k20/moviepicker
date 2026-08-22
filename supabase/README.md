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

## Current persistence boundary

Journal entries and entry viewers are persistent. Queue voting, watch-party room state and Wrapped calculations remain prototype-only for now.
