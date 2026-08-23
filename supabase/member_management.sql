begin;

create table public.group_join_requests (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  requester_email text not null check (char_length(requester_email) between 3 and 254),
  requested_display_name text not null check (char_length(trim(requested_display_name)) between 1 and 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, user_id)
);

create index group_join_requests_user_id_idx on public.group_join_requests(user_id);

create or replace function private.prepare_group_join_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in before requesting access.';
  end if;

  new.user_id := (select auth.uid());
  select users.email into new.requester_email
  from auth.users as users
  where users.id = (select auth.uid());

  if new.requester_email is null then
    raise exception 'The signed-in account has no email address.';
  end if;

  new.requested_display_name := trim(new.requested_display_name);
  return new;
end;
$$;

create or replace function private.lock_group_join_request_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.group_id <> old.group_id
     or new.user_id <> old.user_id
     or new.requester_email <> old.requester_email then
    raise exception 'A request identity cannot be changed.';
  end if;
  new.requested_display_name := trim(new.requested_display_name);
  return new;
end;
$$;

revoke all on function private.prepare_group_join_request() from public, anon, authenticated;
revoke all on function private.lock_group_join_request_identity() from public, anon, authenticated;

create trigger group_join_requests_prepare
before insert on public.group_join_requests
for each row execute function private.prepare_group_join_request();

create trigger group_join_requests_lock_identity
before update on public.group_join_requests
for each row execute function private.lock_group_join_request_identity();

create trigger group_join_requests_set_updated_at
before update on public.group_join_requests
for each row execute function private.set_updated_at();

create or replace function private.can_manage_profile(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.group_memberships as administrator
      join public.group_memberships as target
        on target.group_id = administrator.group_id
      where administrator.user_id = (select auth.uid())
        and administrator.role = 'admin'
        and target.user_id = target_user
    );
$$;

revoke all on function private.can_manage_profile(uuid) from public, anon, authenticated;
grant execute on function private.can_manage_profile(uuid) to authenticated;

alter table public.group_join_requests enable row level security;

drop policy if exists groups_select_member on public.groups;

create policy groups_select_authenticated
on public.groups for select
to authenticated
using ((select auth.uid()) is not null);

create policy join_requests_select_self_or_admin
on public.group_join_requests for select
to authenticated
using (
  user_id = (select auth.uid())
  or private.is_group_admin(group_id)
);

create policy join_requests_insert_self
on public.group_join_requests for insert
to authenticated
with check (user_id = (select auth.uid()));

create policy join_requests_update_self
on public.group_join_requests for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy join_requests_delete_self_or_admin
on public.group_join_requests for delete
to authenticated
using (
  user_id = (select auth.uid())
  or private.is_group_admin(group_id)
);

create policy memberships_insert_admin
on public.group_memberships for insert
to authenticated
with check (private.is_group_admin(group_id));

create policy memberships_update_admin
on public.group_memberships for update
to authenticated
using (private.is_group_admin(group_id))
with check (private.is_group_admin(group_id));

create policy memberships_delete_admin
on public.group_memberships for delete
to authenticated
using (
  private.is_group_admin(group_id)
  and user_id <> (select auth.uid())
);

drop policy if exists profiles_update_self on public.profiles;

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

create or replace function public.request_group_access(
  p_group_slug text,
  p_display_name text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_group_id uuid;
  request_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in before requesting access.';
  end if;

  select groups.id into target_group_id
  from public.groups as groups
  where groups.slug = p_group_slug;

  if target_group_id is null then
    raise exception 'That group does not exist.';
  end if;

  insert into public.group_join_requests (
    group_id,
    user_id,
    requester_email,
    requested_display_name
  ) values (
    target_group_id,
    (select auth.uid()),
    'pending@example.invalid',
    trim(p_display_name)
  )
  on conflict (group_id, user_id)
  do update set requested_display_name = excluded.requested_display_name
  returning id into request_id;

  return request_id;
end;
$$;

create or replace function public.approve_group_join_request(p_request_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  requested public.group_join_requests;
begin
  select * into requested
  from public.group_join_requests
  where id = p_request_id;

  if requested.id is null then
    raise exception 'That access request is not available.';
  end if;

  if not private.is_group_admin(requested.group_id) then
    raise exception 'Only a group administrator can approve access.';
  end if;

  insert into public.group_memberships (group_id, user_id, role)
  values (requested.group_id, requested.user_id, 'member')
  on conflict (group_id, user_id) do nothing;

  update public.profiles
  set display_name = requested.requested_display_name
  where id = requested.user_id;

  delete from public.group_join_requests
  where id = requested.id;

  return requested.user_id;
end;
$$;

create or replace function public.decline_group_join_request(p_request_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  requested public.group_join_requests;
begin
  select * into requested
  from public.group_join_requests
  where id = p_request_id;

  if requested.id is null then
    raise exception 'That access request is not available.';
  end if;

  if not private.is_group_admin(requested.group_id) then
    raise exception 'Only a group administrator can decline access.';
  end if;

  delete from public.group_join_requests
  where id = requested.id;
end;
$$;

create or replace function public.update_group_member(
  p_group_id uuid,
  p_user_id uuid,
  p_display_name text,
  p_role text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not private.is_group_admin(p_group_id) then
    raise exception 'Only a group administrator can update members.';
  end if;

  if p_role not in ('member', 'admin') then
    raise exception 'Choose a valid member role.';
  end if;

  if p_user_id = (select auth.uid()) and p_role <> 'admin' then
    raise exception 'You cannot remove your own administrator role.';
  end if;

  if not exists (
    select 1 from public.group_memberships
    where group_id = p_group_id and user_id = p_user_id
  ) then
    raise exception 'That person is not a member of this group.';
  end if;

  update public.profiles
  set display_name = trim(p_display_name)
  where id = p_user_id;

  update public.group_memberships
  set role = p_role
  where group_id = p_group_id and user_id = p_user_id;
end;
$$;

create or replace function public.remove_group_member(
  p_group_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not private.is_group_admin(p_group_id) then
    raise exception 'Only a group administrator can remove members.';
  end if;

  if p_user_id = (select auth.uid()) then
    raise exception 'You cannot remove your own website access.';
  end if;

  delete from public.group_memberships
  where group_id = p_group_id and user_id = p_user_id;
end;
$$;

revoke all on table public.group_join_requests from anon, authenticated;
revoke all on table public.group_memberships from anon, authenticated;
grant select, insert, update, delete on table public.group_join_requests to authenticated;
grant select, insert, update, delete on table public.group_memberships to authenticated;

revoke all on function public.request_group_access(text, text) from public, anon;
revoke all on function public.approve_group_join_request(uuid) from public, anon;
revoke all on function public.decline_group_join_request(uuid) from public, anon;
revoke all on function public.update_group_member(uuid, uuid, text, text) from public, anon;
revoke all on function public.remove_group_member(uuid, uuid) from public, anon;

grant execute on function public.request_group_access(text, text) to authenticated;
grant execute on function public.approve_group_join_request(uuid) to authenticated;
grant execute on function public.decline_group_join_request(uuid) to authenticated;
grant execute on function public.update_group_member(uuid, uuid, text, text) to authenticated;
grant execute on function public.remove_group_member(uuid, uuid) to authenticated;

commit;
