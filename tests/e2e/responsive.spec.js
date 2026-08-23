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
  const detailPosterImage = detailPoster.locator("img");
  await expect(detailPosterImage).toBeVisible();
  await expect.poll(
    () => detailPosterImage.evaluate((image) => image.complete && image.naturalWidth > 0),
    { message: "detail poster image should finish loading" },
  ).toBe(true);
  const posterMetrics = await detailPoster.evaluate((element) => {
    const image = element.querySelector("img");
    const box = element.getBoundingClientRect();
    return {
      width: Math.round(box.width),
      height: Math.round(box.height),
      objectFit: getComputedStyle(image).objectFit,
    };
  });
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

test("a confirmed Queue Roulette result and Discord form stay in-bounds", async ({ page }, testInfo) => {
  await page.locator('[data-view="pick"]').click();
  await page.getByRole("button", { name: /Start a Session/ }).click();
  await page.getByRole("button", { name: /Create Watch Party/ }).click();
  await expect(page.locator("#roulette-runtime")).toHaveValue("any");

  if (testInfo.project.name === "desktop") {
    await page.setViewportSize({ width: 1430, height: 804 });
    const titleFontSize = await page.locator("#roulette-title").evaluate((title) => parseFloat(getComputedStyle(title).fontSize));
    expect(titleFontSize).toBe(65);
  }

  const chanceRows = page.locator(".roulette-chance-strip .roulette-chance-row");
  const initialCandidateCount = await chanceRows.count();
  await expect(page.locator("[data-adjust-roulette]")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Adjust pool" })).toBeVisible();
  await expect(page.locator(".roulette-pool-controls")).toBeVisible();
  await expect(page.locator(".roulette-session-strip")).toHaveCount(0);
  await expect(page.locator(".roulette-wheel-stage [data-spin-roulette]")).toBeVisible();
  await expect(page.locator(".roulette-wheel-stage [data-spin-roulette]")).toHaveText("Spin");
  await expect(page.locator(".roulette-wheel-stage [data-spin-roulette]")).toHaveAttribute("aria-label", "Spin the list");
  await expect(page.locator(".roulette-pool .roulette-session-vetoes")).toBeVisible();
  await expect(page.locator(".roulette-pool .roulette-veto-token")).toHaveCount(3);
  await expect(page.locator(".roulette-pool .roulette-veto-player")).toContainText(["Cameron", "Dean", "Kieran"]);
  await expect(page.locator(".roulette-pool-odds")).toHaveCount(0);
  await expect(page.locator(".roulette-control-column [data-spin-roulette]")).toHaveCount(0);
  await expect(page.locator(".roulette-veto-panel")).toHaveCount(0);

  const readyGeometry = await page.evaluate(() => {
    const header = document.querySelector(".roulette-header")?.getBoundingClientRect();
    const main = document.querySelector("#view-root")?.getBoundingClientRect();
    const stage = document.querySelector(".roulette-stage-column")?.getBoundingClientRect();
    const wheel = document.querySelector(".roulette-wheel-stage")?.getBoundingClientRect();
    const track = document.querySelector(".roulette-wheel-track")?.getBoundingClientRect();
    const hub = document.querySelector(".roulette-wheel-stage [data-spin-roulette]")?.getBoundingClientRect();
    const rail = document.querySelector(".roulette-chance-strip")?.getBoundingClientRect();
    const controls = document.querySelector(".roulette-control-column")?.getBoundingClientRect();
    const pool = document.querySelector(".roulette-pool")?.getBoundingClientRect();
    const players = document.querySelector(".roulette-session-vetoes")?.getBoundingClientRect();
    const overlaps = (one, two) => one.left < two.right && one.right > two.left && one.top < two.bottom && one.bottom > two.top;
    return {
      wheelBelowHeader: Boolean(header && wheel && wheel.top >= header.bottom - 1),
      wheelControlsOverlap: Boolean(wheel && controls && overlaps(wheel, controls)),
      hubInsideWheel: Boolean(track && hub && hub.left >= track.left - 1 && hub.right <= track.right + 1 && hub.top >= track.top - 1 && hub.bottom <= track.bottom + 1),
      hubCentered: Boolean(track && hub && Math.abs((hub.left + hub.right) / 2 - (track.left + track.right) / 2) <= 1 && Math.abs((hub.top + hub.bottom) / 2 - (track.top + track.bottom) / 2) <= 1),
      railBelowWheel: Boolean(wheel && rail && rail.top >= wheel.bottom - 1),
      playersInsidePool: Boolean(pool && players && players.left >= pool.left - 1 && players.right <= pool.right + 1 && players.top >= pool.top - 1 && players.bottom <= pool.bottom + 1),
      stageInsideMain: Boolean(main && stage && stage.left >= main.left - 1 && stage.right <= main.right + 1),
    };
  });
  expect(readyGeometry.wheelBelowHeader).toBe(true);
  expect(readyGeometry.wheelControlsOverlap).toBe(false);
  expect(readyGeometry.hubInsideWheel).toBe(true);
  expect(readyGeometry.hubCentered).toBe(true);
  expect(readyGeometry.railBelowWheel).toBe(true);
  expect(readyGeometry.playersInsidePool).toBe(true);
  expect(readyGeometry.stageInsideMain).toBe(true);

  if (testInfo.project.name === "desktop") {
    await page.setViewportSize({ width: 1969, height: 1107 });
    const annotatedViewportFit = await page.evaluate(() => {
      const stage = document.querySelector(".roulette-stage-column")?.getBoundingClientRect();
      const controls = document.querySelector(".roulette-control-column")?.getBoundingClientRect();
      return {
        stageBottom: stage?.bottom || Number.POSITIVE_INFINITY,
        columnsOverlap: Boolean(stage && controls && stage.right > controls.left),
        viewportHeight: window.innerHeight,
        viewportOverflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    expect(annotatedViewportFit.stageBottom).toBeLessThanOrEqual(annotatedViewportFit.viewportHeight + 1);
    expect(annotatedViewportFit.columnsOverlap).toBe(false);
    expect(annotatedViewportFit.viewportOverflow).toBeLessThanOrEqual(1);
  }
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

  if (testInfo.project.name === "desktop") {
    await page.setViewportSize({ width: 1790, height: 1007 });
  }

  await page.locator("[data-spin-roulette]").click();
  await expect(page.locator("[data-spin-roulette]")).toHaveText("Spinning");
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
  if (testInfo.project.name === "desktop") {
    const wideResultGeometry = await page.evaluate(() => {
      const header = document.querySelector(".roulette-header > div");
      const wheel = document.querySelector(".roulette-result-wheel .roulette-wheel-stage");
      const callout = document.querySelector(".roulette-result-wheel .roulette-landed-callout.is-summary");
      const poster = document.querySelector(".roulette-winning-poster");
      const reroll = document.querySelector("[data-request-reroll]");
      const rerollIcon = reroll?.querySelector(".material-symbols-outlined");
      const wheelBox = wheel?.getBoundingClientRect();
      const posterBox = poster?.getBoundingClientRect();
      const headerStyle = header ? getComputedStyle(header) : null;
      const wheelStyle = wheel ? getComputedStyle(wheel) : null;
      const calloutStyle = callout ? getComputedStyle(callout) : null;
      const posterStyle = poster ? getComputedStyle(poster) : null;
      const rerollStyle = reroll ? getComputedStyle(reroll) : null;
      const rerollIconStyle = rerollIcon ? getComputedStyle(rerollIcon) : null;
      return {
        headerMarginLeft: parseFloat(headerStyle?.marginLeft || "0"),
        wheelWidth: wheelBox?.width || 0,
        wheelHeight: wheelBox?.height || 0,
        wheelMarginTop: parseFloat(wheelStyle?.marginTop || "0"),
        wheelMarginRight: parseFloat(wheelStyle?.marginRight || "0"),
        wheelMarginLeft: parseFloat(wheelStyle?.marginLeft || "0"),
        posterMarginTop: parseFloat(posterStyle?.marginTop || "0"),
        posterMarginLeft: parseFloat(posterStyle?.marginLeft || "0"),
        calloutMarginRight: parseFloat(calloutStyle?.marginRight || "0"),
        calloutMarginLeft: parseFloat(calloutStyle?.marginLeft || "0"),
        wheelClearsPoster: Boolean(wheelBox && posterBox && wheelBox.right <= posterBox.left),
        rerollDisplay: rerollStyle?.display || "",
        rerollGap: parseFloat(rerollStyle?.gap || "0"),
        rerollPaddingRight: parseFloat(rerollStyle?.paddingRight || "0"),
        rerollPaddingLeft: parseFloat(rerollStyle?.paddingLeft || "0"),
        rerollIconMarginLeft: parseFloat(rerollIconStyle?.marginLeft || "0"),
        viewportOverflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    expect(wideResultGeometry.headerMarginLeft).toBe(-86);
    expect(wideResultGeometry.wheelWidth).toBeCloseTo(437, 0);
    expect(wideResultGeometry.wheelHeight).toBeCloseTo(437, 0);
    expect(wideResultGeometry.wheelMarginTop).toBe(80);
    expect(wideResultGeometry.wheelMarginRight).toBe(-100);
    expect(wideResultGeometry.wheelMarginLeft).toBe(-90);
    expect(wideResultGeometry.posterMarginTop).toBe(30);
    expect(wideResultGeometry.posterMarginLeft).toBe(70);
    expect(wideResultGeometry.calloutMarginRight).toBe(21);
    expect(wideResultGeometry.calloutMarginLeft).toBe(21);
    expect(wideResultGeometry.wheelClearsPoster).toBe(true);
    expect(wideResultGeometry.rerollDisplay).toBe("flex");
    expect(wideResultGeometry.rerollGap).toBe(8);
    expect(wideResultGeometry.rerollPaddingRight).toBe(0);
    expect(wideResultGeometry.rerollPaddingLeft).toBe(0);
    expect(wideResultGeometry.rerollIconMarginLeft).toBe(0);
    expect(wideResultGeometry.viewportOverflow).toBeLessThanOrEqual(1);
  }
  if (resultGeometry.viewportWidth >= 1000 && resultGeometry.viewportWidth <= 1180) {
    expect(resultGeometry.layoutColumns).toBe(2);
    expect(resultGeometry.posterWidth).toBeLessThanOrEqual(216);
    expect(resultGeometry.stageHeight).toBeLessThanOrEqual(324);
  }
  await page.locator("[data-confirm-roulette]").click();
  await expect(page.getByRole("heading", { name: "Prepare the Journal post" })).toBeVisible();
  await expect(page.locator(".roulette-result-copy .discord-copy-card")).toHaveCount(0);
  await expect(page.locator(".roulette-result-handoff .discord-copy-card")).toBeVisible();

  if (testInfo.project.name === "desktop") {
    await page.setViewportSize({ width: 1553, height: 938 });
    const confirmedGeometry = await page.evaluate(() => {
      const layout = document.querySelector(".roulette-result-layout")?.getBoundingClientRect();
      const stage = document.querySelector(".roulette-result-stage")?.getBoundingClientRect();
      const copy = document.querySelector(".roulette-result-copy")?.getBoundingClientRect();
      const handoff = document.querySelector(".roulette-result-handoff")?.getBoundingClientRect();
      const card = document.querySelector(".roulette-result-handoff .discord-copy-card");
      return {
        layoutHeight: layout?.height || Number.POSITIVE_INFINITY,
        paddingTop: layout ? parseFloat(getComputedStyle(document.querySelector(".roulette-result-layout")).paddingTop) : Number.NaN,
        stageWidth: stage?.width || 0,
        handoffSpansLayout: Boolean(layout && handoff && Math.abs(handoff.left - layout.left) <= 1 && Math.abs(handoff.right - layout.right) <= 1),
        handoffBelowResult: Boolean(stage && copy && handoff && handoff.top >= Math.max(stage.bottom, copy.bottom) - 1),
        handoffColumns: card ? getComputedStyle(card).gridTemplateColumns.split(" ").length : 0,
      };
    });
    expect(confirmedGeometry.paddingTop).toBe(0);
    expect(confirmedGeometry.layoutHeight).toBeLessThanOrEqual(810);
    expect(confirmedGeometry.stageWidth).toBeGreaterThanOrEqual(840);
    expect(confirmedGeometry.stageWidth).toBeLessThanOrEqual(846);
    expect(confirmedGeometry.handoffSpansLayout).toBe(true);
    expect(confirmedGeometry.handoffBelowResult).toBe(true);
    expect(confirmedGeometry.handoffColumns).toBe(2);
  }

  const overflowState = await page.evaluate(() => ({
    pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
    overflowingElements: [...document.querySelectorAll("body *")]
      .map((element) => {
        const box = element.getBoundingClientRect();
        return {
          selector: element.id ? `#${element.id}` : `.${[...element.classList].join(".")}`,
          left: Math.round(box.left),
          right: Math.round(box.right),
          width: Math.round(box.width),
        };
      })
      .filter(({ left, right }) => left < -1 || right > window.innerWidth + 1)
      .slice(0, 12),
  }));
  expect(overflowState.pageOverflow, JSON.stringify(overflowState.overflowingElements)).toBeLessThanOrEqual(1);
});
