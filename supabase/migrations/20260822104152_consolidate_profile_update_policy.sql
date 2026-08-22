begin;
drop policy if exists profiles_update_self on public.profiles;
drop policy if exists profiles_update_group_admin on public.profiles;
create policy profiles_update_self_or_group_admin
on public.profiles for update
to authenticated
using (
  id = (select auth.uid())
  or private.can_manage_profile(id)
)
with check (
  id = (select auth.uid())
  or private.can_manage_profile(id)
);
commit;
