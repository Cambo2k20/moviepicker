import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAuthRedirectUrl,
  discordProviderEnabled,
  oauthCallbackError,
  preferredAuthDisplayName,
  withoutOAuthError,
} from "../auth-core.js";

test("Discord availability is enabled only by the public Auth provider setting", () => {
  assert.equal(discordProviderEnabled({ external: { discord: true } }), true);
  assert.equal(discordProviderEnabled({ external: { discord: false } }), false);
  assert.equal(discordProviderEnabled({}), false);
});

test("OAuth redirects preserve the GitHub Pages base path and drop query state", () => {
  assert.equal(buildAuthRedirectUrl({ origin: "https://cambo2k20.github.io", pathname: "/moviepicker/", search: "?x=1", hash: "#list" }), "https://cambo2k20.github.io/moviepicker/");
});

test("Discord metadata supplies a safe request display name", () => {
  assert.equal(preferredAuthDisplayName({ user_metadata: { full_name: "Dean" }, email: "ignored@example.com" }), "Dean");
  assert.equal(preferredAuthDisplayName({ user_metadata: {}, email: "kieran@example.com" }), "kieran");
  assert.equal(preferredAuthDisplayName({ user_metadata: { name: "x".repeat(50) } }).length, 40);
});

test("OAuth callback errors are readable and removable without losing unrelated state", () => {
  const location = { search: "?error=server_error&error_description=Provider+not+enabled&keep=1", hash: "#list" };
  assert.equal(oauthCallbackError(location), "Provider not enabled");
  assert.equal(withoutOAuthError("https://example.com/moviepicker/?error=server_error&error_description=Provider+not+enabled&keep=1#list"), "/moviepicker/?keep=1#list");
});
