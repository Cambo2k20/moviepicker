import test from "node:test";
import assert from "node:assert/strict";

import {
  DISCORDIANS_GUILD_ID,
  discordAuthUserId,
  discordServerProfile,
} from "../supabase/functions/_shared/discord-server-profile.js";

test("uses The Discordians nickname and animated server avatar", () => {
  const profile = discordServerProfile({
    nick: "Basil Brush",
    avatar: "a_serveravatarhash",
    user: {
      id: "123456789012345678",
      username: "throbbinhood7942",
      global_name: "Global Cameron",
      avatar: "globalavatarhash",
    },
  });

  assert.deepEqual(profile, {
    discordGuildId: DISCORDIANS_GUILD_ID,
    discordUserId: "123456789012345678",
    displayName: "Basil Brush",
    avatarUrl: `https://cdn.discordapp.com/guilds/${DISCORDIANS_GUILD_ID}/users/123456789012345678/avatars/a_serveravatarhash.gif?size=256`,
  });
});

test("stores one effective server presentation when no server overrides exist", () => {
  const profile = discordServerProfile({
    nick: null,
    avatar: null,
    user: {
      id: "123456789012345678",
      username: "accountname",
      global_name: "Visible in server",
      avatar: "accountavatarhash",
    },
  });

  assert.equal(profile.displayName, "Visible in server");
  assert.equal(profile.avatarUrl, "https://cdn.discordapp.com/avatars/123456789012345678/accountavatarhash.png?size=256");
  assert.equal("globalDisplayName" in profile, false);
  assert.equal("globalAvatarUrl" in profile, false);
});

test("reads the Discord account ID only from the trusted Auth identity", () => {
  const user = {
    identities: [{ provider: "discord", identity_data: { sub: "123456789012345678" } }],
    user_metadata: { sub: "999999999999999999" },
  };
  assert.equal(discordAuthUserId(user), "123456789012345678");
  assert.equal(discordAuthUserId({ identities: [], user_metadata: { sub: "999999999999999999" } }), null);
});

test("rejects malformed guild-member profiles and unsafe asset hashes", () => {
  assert.equal(discordServerProfile({ user: { id: "not-a-discord-id", username: "Cameron" } }), null);
  const profile = discordServerProfile({
    nick: "Cameron",
    avatar: "../../secret",
    user: { id: "123456789012345678", username: "Cameron", avatar: "also/not/safe" },
  });
  assert.equal(profile.avatarUrl, null);
});
