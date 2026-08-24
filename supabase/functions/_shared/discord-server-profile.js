export const DISCORDIANS_GUILD_ID = "272427070779293697";

const DISCORD_ID = /^\d+$/;
const DISCORD_ASSET_HASH = /^[A-Za-z0-9_]+$/;

function clipped(value, maximum) {
  return String(value || "").trim().slice(0, maximum);
}

function discordAvatarUrl({ guildId, userId, guildAvatar, userAvatar }) {
  const serverHash = clipped(guildAvatar, 200);
  if (DISCORD_ASSET_HASH.test(serverHash)) {
    const asset = serverHash.startsWith("a_")
      ? `${serverHash}.webp?size=256&animated=true`
      : `${serverHash}.png?size=256`;
    return `https://cdn.discordapp.com/guilds/${guildId}/users/${userId}/avatars/${asset}`;
  }

  // Discord itself uses the account avatar when a member has no server-specific
  // override. This remains the effective server presentation; it is not stored
  // as a separate global identity in Cine-Cord.
  const accountHash = clipped(userAvatar, 200);
  if (DISCORD_ASSET_HASH.test(accountHash)) {
    const asset = accountHash.startsWith("a_")
      ? `${accountHash}.webp?size=256&animated=true`
      : `${accountHash}.png?size=256`;
    return `https://cdn.discordapp.com/avatars/${userId}/${asset}`;
  }
  return null;
}

export function discordAuthUserId(user) {
  const identity = (Array.isArray(user?.identities) ? user.identities : [])
    .find((candidate) => candidate?.provider === "discord");
  const candidates = [
    identity?.provider_id,
    identity?.identity_data?.sub,
    identity?.identity_data?.id,
  ];
  const value = candidates.map((candidate) => clipped(candidate, 40)).find((candidate) => DISCORD_ID.test(candidate));
  return value || null;
}

export function discordServerProfile(member, guildId = DISCORDIANS_GUILD_ID) {
  const resolvedGuildId = clipped(guildId, 40);
  const userId = clipped(member?.user?.id, 40);
  if (!DISCORD_ID.test(resolvedGuildId) || !DISCORD_ID.test(userId)) return null;

  // A server nickname is the explicit server profile. When it is absent,
  // Discord's own member presentation falls through to global_name/username.
  // Cine-Cord stores only this one resolved server-facing value.
  const displayName = [member?.nick, member?.user?.global_name, member?.user?.username]
    .map((candidate) => clipped(candidate, 80))
    .find(Boolean);
  if (!displayName) return null;

  return {
    discordGuildId: resolvedGuildId,
    discordUserId: userId,
    displayName,
    avatarUrl: discordAvatarUrl({
      guildId: resolvedGuildId,
      userId,
      guildAvatar: member?.avatar,
      userAvatar: member?.user?.avatar,
    }),
  };
}
