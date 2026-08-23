import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/moviepicker/?design-preview");
  await expect(page.getByRole("heading", { name: "Collective Film Library" })).toBeVisible();
});

test("the available game and watch-party dialog stay truthful and in-bounds", async ({ page }) => {
  const viewportOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(viewportOverflow).toBeLessThanOrEqual(1);

  await page.locator('[data-view="pick"]').click();
  const consensus = page.locator(".mode-row", { hasText: "Consensus Sprint" });
  const roulette = page.locator(".mode-row", { hasText: "Queue Roulette" });
  const bracket = page.locator(".mode-row", { hasText: "Reel Bracket" });
  await expect(consensus.getByRole("button")).toBeDisabled();
  await expect(consensus).toContainText("Coming soon");
  await expect(roulette.getByRole("button", { name: "Choose" })).toBeEnabled();
  await expect(bracket.getByRole("button")).toBeDisabled();

  await page.getByRole("button", { name: /Start a Session/ }).click();
  const dialog = page.getByRole("dialog", { name: "Start a watch party" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("radio", { name: /Queue Roulette/ })).toBeChecked();
  await expect(dialog.getByRole("radio", { name: /Consensus Sprint/ })).toBeDisabled();
  await expect(dialog.getByRole("radio", { name: /Reel Bracket/ })).toBeDisabled();

  const dialogOverflow = await dialog.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(dialogOverflow).toBeLessThanOrEqual(1);
});

test("local application images resolve in the browser", async ({ page }) => {
  const logo = page.locator(".brand-logo");
  await expect(logo).toBeVisible();
  expect(await logo.evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);

  await page.getByRole("button", { name: "Members" }).click();
  const memberCards = page.locator(".member-admin-row");
  await expect(memberCards).toHaveCount(5);
  const avatars = page.locator(".member-admin-identity img");
  await expect(avatars).toHaveCount(5);
  const brokenImages = await avatars.evaluateAll((images) => images.filter((image) => !image.complete || image.naturalWidth === 0).length);
  expect(brokenImages).toBe(0);

  const cardMetrics = await memberCards.evaluateAll((cards) => cards.map((card) => {
    const image = card.querySelector(".member-admin-identity img");
    const cardBox = card.getBoundingClientRect();
    const imageBox = image.getBoundingClientRect();
    const controlsStayInside = [...card.querySelectorAll("input, select, button")].every((control) => {
      const box = control.getBoundingClientRect();
      return box.left >= cardBox.left - 1 && box.right <= cardBox.right + 1;
    });
    return {
      cardWidth: Math.round(cardBox.width),
      imageWidth: Math.round(imageBox.width),
      imageHeight: Math.round(imageBox.height),
      controlsStayInside,
    };
  }));
  expect(cardMetrics.every(({ cardWidth, imageWidth, imageHeight, controlsStayInside }) => cardWidth === 256 && imageWidth === 256 && imageHeight === 256 && controlsStayInside)).toBe(true);

  const viewportOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(viewportOverflow).toBeLessThanOrEqual(1);
});

test("a confirmed Queue Roulette result and Discord form stay in-bounds", async ({ page }) => {
  await page.locator('[data-view="pick"]').click();
  await page.getByRole("button", { name: /Start a Session/ }).click();
  await page.getByRole("button", { name: /Create Watch Party/ }).click();
  await expect(page.locator("#roulette-runtime")).toHaveValue("any");

  const chanceRows = page.locator(".roulette-chance-strip .roulette-chance-row");
  const initialCandidateCount = await chanceRows.count();
  await page.locator("[data-adjust-roulette]").click();
  await page.locator("#roulette-runtime").selectOption("150");
  await page.locator("#roulette-rewatches").check();
  const filteredCandidateCount = await chanceRows.count();
  expect(filteredCandidateCount).toBeLessThan(initialCandidateCount);
  await chanceRows.first().getByRole("button", { name: /Remove .* from this Roulette pool/ }).click();
  await expect(chanceRows).toHaveCount(filteredCandidateCount - 1);
  await page.locator("[data-clear-roulette-filters]").click();
  await expect(chanceRows).toHaveCount(initialCandidateCount);
  await expect(page.locator("#roulette-runtime")).toHaveValue("any");
  await expect(page.locator("#roulette-rewatches")).not.toBeChecked();

  await page.locator("[data-spin-roulette]").click();
  await expect(page.locator("[data-spin-roulette]")).toContainText("Spinning");
  await expect(page.getByText("Wheel stopped · revealing the result…")).toBeVisible({ timeout: 6_000 });
  await page.locator("#roulette-winner-title").waitFor({ state: "visible", timeout: 8_000 });
  await page.locator("[data-confirm-roulette]").click();
  await expect(page.getByRole("heading", { name: "Prepare the Journal post" })).toBeVisible();

  const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(pageOverflow).toBeLessThanOrEqual(1);
});
