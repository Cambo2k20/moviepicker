import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/moviepicker/?design-preview");
  await expect(page.getByRole("heading", { name: "Collective Film Library" })).toBeVisible();
});

test("large desktop library scales poster columns gradually", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The stepped desktop breakpoints are covered once.");

  const grid = page.locator(".poster-grid");
  await expect(grid).toBeVisible();
  const breakpoints = [
    { width: 1326, height: 780, columns: 6 },
    { width: 1440, height: 900, columns: 7 },
    { width: 1600, height: 900, columns: 8 },
  ];

  for (const viewport of breakpoints) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    const columns = await grid.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length);
    expect(columns).toBe(viewport.columns);
    const viewportOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(viewportOverflow).toBeLessThanOrEqual(1);
  }
});

test("list actions and desktop film artwork remain clear", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop detail-drawer artwork is covered once.");

  await page.setViewportSize({ width: 1590, height: 1272 });
  await expect(page.getByRole("button", { name: "Add film to library" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Watch a Film" })).toBeVisible();

  await page.locator("[data-select-film]").first().click();
  const detailPoster = page.locator(".detail-poster");
  await expect(detailPoster).toBeVisible();
  const posterMetrics = await detailPoster.evaluate((element) => {
    const image = element.querySelector("img");
    const box = element.getBoundingClientRect();
    return {
      width: Math.round(box.width),
      height: Math.round(box.height),
      imageLoaded: image.complete && image.naturalWidth > 0,
      objectFit: getComputedStyle(image).objectFit,
    };
  });
  expect(posterMetrics.imageLoaded).toBe(true);
  expect(posterMetrics.objectFit).toBe("contain");
  expect(posterMetrics.width).toBeLessThanOrEqual(280);
  expect(posterMetrics.height / posterMetrics.width).toBeCloseTo(1.5, 1);

  const viewportOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(viewportOverflow).toBeLessThanOrEqual(1);
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
  await expect(page.locator("[data-adjust-roulette]")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Adjust pool" })).toBeVisible();
  await expect(page.locator(".roulette-pool-controls")).toBeVisible();
  await expect(page.locator(".roulette-session-strip [data-spin-roulette]")).toBeVisible();
  await expect(page.locator(".roulette-session-strip .roulette-session-vetoes")).toBeVisible();
  await expect(page.locator(".roulette-session-strip .roulette-veto-token")).toHaveCount(3);
  await expect(page.locator(".roulette-session-strip .roulette-players")).toHaveCount(0);
  await expect(page.locator(".roulette-pool-odds")).toHaveCount(0);
  await expect(page.locator(".roulette-control-column [data-spin-roulette]")).toHaveCount(0);
  await expect(page.locator(".roulette-veto-panel")).toHaveCount(0);

  const sessionStripOrder = await page.locator(".roulette-session-strip").evaluate((strip) => [...strip.children].map((child) => {
    if (child.matches(".roulette-session-vetoes")) return "players";
    if (child.matches("[data-spin-roulette]")) return "spin";
    if (child.matches(".roulette-session-count")) return "details";
    return "other";
  }));
  expect(sessionStripOrder).toEqual(["players", "spin", "details"]);

  const readyGeometry = await page.evaluate(() => {
    const strip = document.querySelector(".roulette-session-strip")?.getBoundingClientRect();
    const wheel = document.querySelector(".roulette-wheel-stage")?.getBoundingClientRect();
    const controls = document.querySelector(".roulette-control-column")?.getBoundingClientRect();
    const overlaps = (one, two) => one.left < two.right && one.right > two.left && one.top < two.bottom && one.bottom > two.top;
    return {
      wheelBelowHeader: Boolean(strip && wheel && wheel.top >= strip.bottom - 1),
      wheelControlsOverlap: Boolean(wheel && controls && overlaps(wheel, controls)),
    };
  });
  expect(readyGeometry.wheelBelowHeader).toBe(true);
  expect(readyGeometry.wheelControlsOverlap).toBe(false);
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
  const spinKeyframeOffsets = await page.locator("[data-roulette-wheel]").evaluate((element) => (
    element.getAnimations()[0]?.effect.getKeyframes().map(({ offset }) => offset)
  ));
  expect(spinKeyframeOffsets).toEqual([0, 1]);
  const landedCallout = page.locator(".roulette-landed-callout");
  await expect(landedCallout).toContainText("Landed on", { timeout: 6_000 });
  await expect(landedCallout).toContainText("revealing shortly");
  await expect(page.locator(".roulette-wheel-track .roulette-segment.is-winner")).toHaveCount(1);
  await expect(page.locator(".roulette-chance-strip .roulette-chance-row.is-winner")).toHaveCount(1);
  await expect(page.locator(".roulette-wheel-track .roulette-segment img")).toHaveCount(0);
  await page.locator("#roulette-winner-title").waitFor({ state: "visible", timeout: 8_000 });
  const winningPoster = page.locator(".roulette-winning-poster img");
  await expect(winningPoster).toBeVisible();
  const winningPosterMetrics = await winningPoster.evaluate((element) => ({
    naturalWidth: element.naturalWidth,
    naturalHeight: element.naturalHeight,
    objectFit: getComputedStyle(element).objectFit,
  }));
  expect(winningPosterMetrics.naturalWidth).toBeGreaterThan(0);
  expect(winningPosterMetrics.naturalHeight).toBeGreaterThan(0);
  expect(winningPosterMetrics.objectFit).toBe("contain");
  const resultGeometry = await page.evaluate(() => {
    const viewportWidth = window.innerWidth;
    const layout = document.querySelector(".roulette-result-layout");
    const stage = document.querySelector(".roulette-result-stage")?.getBoundingClientRect();
    const poster = document.querySelector(".roulette-winning-poster")?.getBoundingClientRect();
    const main = document.querySelector("#view-root")?.getBoundingClientRect();
    return {
      viewportWidth,
      layoutColumns: layout ? getComputedStyle(layout).gridTemplateColumns.split(" ").length : 0,
      stageHeight: stage?.height || 0,
      posterWidth: poster?.width || 0,
      resultFitsMainWidth: Boolean(stage && main && stage.left >= main.left - 1 && stage.right <= main.right + 1),
    };
  });
  expect(resultGeometry.resultFitsMainWidth).toBe(true);
  if (resultGeometry.viewportWidth >= 1000 && resultGeometry.viewportWidth <= 1180) {
    expect(resultGeometry.layoutColumns).toBe(2);
    expect(resultGeometry.posterWidth).toBeLessThanOrEqual(216);
    expect(resultGeometry.stageHeight).toBeLessThanOrEqual(324);
  }
  await page.locator("[data-confirm-roulette]").click();
  await expect(page.getByRole("heading", { name: "Prepare the Journal post" })).toBeVisible();

  const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(pageOverflow).toBeLessThanOrEqual(1);
});
