const OAUTH_ERROR_KEYS = ["error", "error_code", "error_description"];
export const DISCORD_SERVER_PROFILE_SCOPE = "guilds.members.read";

export function buildAuthRedirectUrl(locationLike) {
  const origin = String(locationLike?.origin || "").trim();
  const pathname = String(locationLike?.pathname || "/");
  if (!/^https?:\/\//i.test(origin)) throw new Error("A valid website origin is required for OAuth.");
  return `${origin}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

export function discordOAuthOptions(locationLike, { forceConsent = false } = {}) {
  return {
    redirectTo: buildAuthRedirectUrl(locationLike),
    scopes: DISCORD_SERVER_PROFILE_SCOPE,
    ...(forceConsent ? { queryParams: { prompt: "consent" } } : {}),
  };
}

export function discordProviderEnabled(settings) {
  return settings?.external?.discord === true;
}

export function preferredAuthDisplayName(user) {
  const metadata = user?.user_metadata || {};
  const candidates = [
    metadata.display_name,
    metadata.full_name,
    metadata.global_name,
    metadata.name,
    metadata.preferred_username,
    metadata.user_name,
    metadata.username,
    user?.email?.split("@")[0],
  ];
  const name = candidates.find((candidate) => String(candidate || "").trim());
  return String(name || "Discordian").trim().slice(0, 40);
}

export function oauthCallbackError(locationLike) {
  const search = new URLSearchParams(String(locationLike?.search || ""));
  const hash = new URLSearchParams(String(locationLike?.hash || "").replace(/^#/, ""));
  return search.get("error_description")
    || hash.get("error_description")
    || search.get("error")
    || hash.get("error")
    || "";
}

export function withoutOAuthError(urlValue) {
  const url = new URL(urlValue);
  OAUTH_ERROR_KEYS.forEach((key) => url.searchParams.delete(key));

  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
  if (OAUTH_ERROR_KEYS.some((key) => hashParams.has(key))) {
    OAUTH_ERROR_KEYS.forEach((key) => hashParams.delete(key));
    url.hash = hashParams.toString() ? `#${hashParams}` : "";
  }

  return `${url.pathname}${url.search}${url.hash}`;
}
