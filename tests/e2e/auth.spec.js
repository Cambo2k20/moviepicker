import { expect, test } from "@playwright/test";

test("Discord sign-in appears only when enabled and keeps approval explicit", async ({ page }) => {
  await page.route("**/auth/v1/authorize?**", (route) => route.abort());

  await page.goto("/moviepicker/?discord-auth-preview");
  await expect(page.getByRole("heading", { name: "Enter Cine-Cord." })).toBeVisible();
  const discordButton = page.getByRole("button", { name: /Continue with Discord/ });
  await expect(discordButton).toBeVisible();
  await expect(discordButton).toContainText("Approval is still required");
  await expect(page.locator(".access-note")).toContainText("Authentication alone reveals no group data");

  const oauthRequest = page.waitForRequest((request) => request.url().includes("/auth/v1/authorize") && request.url().includes("provider=discord"));
  await discordButton.click();
  const requestUrl = new URL((await oauthRequest).url());
  expect(requestUrl.searchParams.get("provider")).toBe("discord");
  expect(requestUrl.searchParams.get("redirect_to")).toBe("http://127.0.0.1:4173/moviepicker/");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
