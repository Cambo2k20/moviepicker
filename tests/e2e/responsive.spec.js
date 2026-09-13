import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/moviepicker/?design-preview");
  await expect(page.getByRole("heading", { name: "The List", exact: true })).toBeVisible();
});

test("a My Cinema failure stays isolated from the shared workspace", async ({ page }) => {
  await page.goto("/moviepicker/?design-preview&preview-failure=personal-films#list");
  await expect(page.getByRole("heading", { name: "The List", exact: true })).toBeVisible();
  await expect(page.locator(".poster-card")).toHaveCount(9);

  await page.goto("/moviepicker/?design-preview&preview-failure=personal-films#journal");
  await expect(page.getByRole("heading", { name: "The Journal", exact: true })).toBeVisible();
  await expect(page.locator(".journal-entry-card")).toHaveCount(3);

  await page.goto("/moviepicker/?design-preview&preview-failure=personal-films#my-films");
  await expect(page.getByRole("heading", { name: "My Films", exact: true })).toBeVisible();
  const unavailable = page.getByRole("alert");
  await expect(unavailable).toContainText("My Cinema couldn’t load.");
  await expect(unavailable.getByRole("button", { name: "Try My Cinema again" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "My Cinema is empty." })).toHaveCount(0);
});

test("large desktop library keeps poster artwork prominent as space grows", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The responsive desktop grid is covered once.");

  const grid = page.locator(".poster-grid");
  await expect(grid).toBeVisible();
  const breakpoints = [
    { width: 1326, height: 780, columns: 6 },
    { width: 1440, height: 900, columns: 6 },
    { width: 1600, height: 900, columns: 7 },
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

test("narrow desktop keeps every My Films filter visible", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The narrow desktop toolbar is covered once.");

  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto("/moviepicker/?design-preview#my-films");
  await expect(page.getByRole("heading", { name: "My Films", exact: true })).toBeVisible();

  const filters = page.locator(".my-film-filter-tabs");
  await expect(filters.locator(".filter-tab")).toHaveCount(5);
  const geometry = await filters.evaluate((element) => {
    const container = element.getBoundingClientRect();
    const tabs = [...element.querySelectorAll(".filter-tab")].map((tab) => {
      const box = tab.getBoundingClientRect();
      return {
        left: box.left,
        right: box.right,
      };
    });
    return {
      allVisible: tabs.every((tab) => tab.left >= container.left - 1 && tab.right <= container.right + 1),
      pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });

  expect(geometry.allVisible).toBe(true);
  expect(geometry.pageOverflow).toBeLessThanOrEqual(1);
  await expect(page.locator("#my-films-sort")).toBeVisible();
});

test("the unified application canvas scales to a comfortable high-resolution density", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The high-resolution canvas contract is covered once.");

  await page.setViewportSize({ width: 2560, height: 1440 });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const ultrawide = await page.evaluate(() => {
    const shell = document.querySelector(".app-shell");
    const sidebar = document.querySelector(".sidebar");
    const shellBox = shell.getBoundingClientRect();
    const sidebarBox = sidebar.getBoundingClientRect();
    return {
      rootZoom: getComputedStyle(document.documentElement).zoom,
      shellLeft: Math.round(shellBox.left),
      shellRight: Math.round(shellBox.right),
      shellWidth: Math.round(shellBox.width),
      leftGutter: Math.round(shellBox.left),
      rightGutter: Math.round(window.innerWidth - shellBox.right),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      sidebarWidth: Math.round(sidebarBox.width),
      sidebarHeight: Math.round(sidebarBox.height),
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      shellBackground: getComputedStyle(shell).backgroundColor,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  expect(ultrawide.rootZoom).toBe("1.5");
  expect(ultrawide.shellWidth).toBeGreaterThanOrEqual(ultrawide.viewportWidth - 16);
  expect(ultrawide.shellLeft).toBe(0);
  expect(ultrawide.shellRight).toBeGreaterThanOrEqual(ultrawide.viewportWidth - 16);
  expect(ultrawide.leftGutter).toBe(0);
  expect(ultrawide.rightGutter).toBeLessThanOrEqual(16);
  expect(ultrawide.sidebarWidth).toBe(402);
  expect(ultrawide.sidebarHeight).toBe(ultrawide.viewportHeight);
  expect(ultrawide.bodyBackground).toBe(ultrawide.shellBackground);
  expect(ultrawide.overflow).toBeLessThanOrEqual(1);

  await page.getByRole("button", { name: "Add film to library" }).click();
  const dialogGeometry = await page.locator("#film-modal").evaluate((element) => {
    const layer = element.getBoundingClientRect();
    const dialog = element.querySelector('[role="dialog"]').getBoundingClientRect();
    return {
      layerTop: Math.round(layer.top),
      layerRight: Math.round(layer.right),
      layerBottom: Math.round(layer.bottom),
      layerLeft: Math.round(layer.left),
      dialogFits: dialog.top >= 0 && dialog.right <= window.innerWidth && dialog.bottom <= window.innerHeight && dialog.left >= 0,
    };
  });
  expect(dialogGeometry).toEqual({
    layerTop: 0,
    layerRight: 2560,
    layerBottom: 1440,
    layerLeft: 0,
    dialogFits: true,
  });
  await page.getByRole("button", { name: "Close Add Film form" }).click();

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const standardDesktop = await page.evaluate(() => {
    const shell = document.querySelector(".app-shell").getBoundingClientRect();
    const sidebar = document.querySelector(".sidebar").getBoundingClientRect();
    return {
      rootZoom: getComputedStyle(document.documentElement).zoom,
      shellWidth: Math.round(shell.width),
      shellLeft: Math.round(shell.left),
      sidebarWidth: Math.round(sidebar.width),
      sidebarHeight: Math.round(sidebar.height),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  expect(standardDesktop).toEqual({
    rootZoom: "1",
    shellWidth: 1920,
    shellLeft: 0,
    sidebarWidth: 268,
    sidebarHeight: 1080,
    overflow: 0,
  });

  const pages = [
    ["list", "The List"],
    ["pick", "Watch a Film"],
    ["sessions", "Sessions"],
    ["journal", "The Journal"],
    ["stats", "Group Stats"],
    ["my-films", "My Films"],
    ["members", "Members"],
  ];

  for (const [route, heading] of pages) {
    await page.goto(`/moviepicker/?design-preview#${route}`);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    const header = await page.locator(".layout-page-header").evaluate((element) => {
      const box = element.getBoundingClientRect();
      const rootBox = document.querySelector("#view-root").getBoundingClientRect();
      const style = getComputedStyle(element);
      const titleStyle = getComputedStyle(element.querySelector("h1"));
      return {
        background: style.backgroundColor,
        borderTopWidth: style.borderTopWidth,
        height: Math.round(box.height),
        leftGutter: Math.round(box.left - rootBox.left),
        titleSize: titleStyle.fontSize,
      };
    });
    expect(header.background).toBe("rgba(0, 0, 0, 0)");
    expect(header.borderTopWidth).toBe("0px");
    expect(header.leftGutter).toBe(44);
    expect(header.titleSize).toBe("56px");
    expect(header.height).toBeGreaterThanOrEqual(97);
    expect(header.height).toBeLessThanOrEqual(108);
  }

  await page.goto("/moviepicker/?design-preview#list");
  const controls = await page.evaluate(() => {
    const select = document.querySelector(".list-toolbar select");
    const selectStyle = getComputedStyle(select);
    return {
      heights: [...document.querySelectorAll(".list-toolbar input, .list-toolbar select, .filter-tabs")]
        .map((element) => Math.round(element.getBoundingClientRect().height)),
      appearance: selectStyle.appearance,
      backgroundImage: selectStyle.backgroundImage,
    };
  });
  expect(controls.heights.every((height) => height === 44)).toBe(true);
  expect(controls.appearance).toBe("none");
  expect(controls.backgroundImage).not.toBe("none");

  await page.goto("/moviepicker/?design-preview#pick");
  await expect(page.locator(".page-view .primary-button")).toHaveCount(1);
  await expect(page.locator(".page-view .primary-button")).toHaveText("Start a Session");
  await expect(page.locator(".mode-row.layout-container.layout-container-shared")).toHaveCount(3);
});

test("area navigation keeps future sections truthful and available routes working", async ({ page }) => {
  const cineCordArea = page.locator('[data-nav-area="cine-cord"]');
  const myCinema = page.locator('[data-nav-area="my-cinema"] .nav-area-toggle');
  const myCinemaArea = page.locator('[data-nav-area="my-cinema"]');
  const discover = page.locator('[data-nav-area="discover"] .nav-area-toggle');
  const memberProfiles = page.getByRole("button", { name: /Member Profiles/ });

  await expect(cineCordArea).toHaveClass(/is-open/);
  await expect(page.locator('[data-view="list"]')).toHaveAttribute("aria-current", "page");
  await expect(myCinema).toBeEnabled();
  await expect(myCinema).toContainText("Private");
  await expect(discover).toBeDisabled();
  await expect(discover).toContainText(/Private.*Coming soon|Private.*Soon/);
  await expect(memberProfiles).toBeDisabled();

  await myCinema.click();
  await expect(page.getByRole("heading", { name: "My Films", exact: true })).toBeVisible();
  await expect(myCinemaArea).toHaveClass(/is-open/);
  await expect(page.locator('[data-view="my-films"]')).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("button", { name: /^Overview(?: Coming soon)?$/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: /^My Lists(?: Coming soon)?$/ })).toBeDisabled();

  await page.locator('[data-nav-area="admin"] .nav-area-toggle').click();
  await expect(page.getByRole("heading", { name: "Members", exact: true })).toBeVisible();
  await expect(page.locator('[data-nav-area="admin"]')).toHaveClass(/is-open/);
  await expect(page.locator('[data-view="members"]')).toHaveAttribute("aria-current", "page");

  await page.locator('[data-nav-area="cine-cord"] .nav-area-toggle').click();
  await expect(page.getByRole("heading", { name: "The List", exact: true })).toBeVisible();
  await expect(cineCordArea).toHaveClass(/is-open/);
});

test("phone and tablet destination row supports keyboard movement and reveals the active route", async ({ page }, testInfo) => {
  test.skip(!["phone", "tablet"].includes(testInfo.project.name), "The two-tier footer is used on phone and tablet.");

  const listDestination = page.locator('[data-view="list"]');
  await listDestination.focus();
  await listDestination.press("End");
  await expect(page.locator('[data-view="stats"]')).toBeFocused();
  await page.locator('[data-view="stats"]').press("Enter");
  await expect(page.getByRole("heading", { name: "Group Stats", exact: true })).toBeVisible();

  const bounds = await page.locator('[data-view="stats"]').evaluate((button) => {
    const buttonBox = button.getBoundingClientRect();
    const rowBox = button.closest(".nav-destinations").getBoundingClientRect();
    return { buttonLeft: buttonBox.left, buttonRight: buttonBox.right, rowLeft: rowBox.left, rowRight: rowBox.right };
  });
  expect(bounds.buttonLeft).toBeGreaterThanOrEqual(bounds.rowLeft - 1);
  expect(bounds.buttonRight).toBeLessThanOrEqual(bounds.rowRight + 1);
});

test("phone keeps the complete list filters behind the compact filter control", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "The compact filter control is phone-specific.");

  const filterTabs = page.locator(".filter-tabs");
  const filterControls = page.locator(".list-filter-controls");
  await expect(filterTabs).toBeHidden();
  await expect(filterControls).toBeHidden();

  await page.getByRole("button", { name: "Show filters and sort" }).click();
  await expect(page.getByRole("button", { name: "Hide filters and sort" })).toBeVisible();
  await expect(filterTabs).toBeVisible();
  await expect(filterControls).toBeVisible();
  await expect(page.getByRole("button", { name: "Ready", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Filter by genre" })).toBeVisible();

  await page.getByRole("button", { name: "Hide filters and sort" }).click();
  await expect(filterTabs).toBeHidden();
  await expect(filterControls).toBeHidden();
});

test("list actions and desktop film artwork remain clear", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop film-detail artwork is covered once.");

  await page.setViewportSize({ width: 1590, height: 1272 });
  await expect(page.getByRole("button", { name: "Add film to library" })).toBeVisible();
  await expect(page.locator(".page-header-actions").getByRole("button", { name: "Watch a Film" })).toBeVisible();

  await page.locator("[data-select-film]").first().click();
  await expect(page.locator(".film-detail-view")).toBeVisible();
  await expect(page.locator(".film-detail-drawer")).toHaveCount(0);
  const detailPoster = page.locator(".detail-poster");
  await expect(detailPoster).toBeVisible();
  await expect(page.locator("[data-shortlist-film]")).toHaveCount(0);
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

test("My Films stays private and the unified detail follows its entry context", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Context ordering is covered once on desktop.");

  await page.locator('[data-nav-area="my-cinema"] .nav-area-toggle').click();
  await expect(page.locator(".personal-poster-card")).toHaveCount(4);
  const matrixCard = page.locator(".personal-poster-card").filter({ has: page.getByRole("button", { name: "View details for The Matrix" }) });
  const compactReaction = matrixCard.locator(".personal-card-reaction");
  await expect(compactReaction).toContainText("Really liked it");
  await expect(compactReaction.locator("img")).toHaveAttribute("src", /reaction-face-4/);
  await expect(matrixCard.locator('.personal-card-footer img[src*="reaction-stage-"]')).toHaveCount(0);
  await expect(matrixCard.locator("[data-reaction-stage]")).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Search My Films" }).fill("matrix");
  await page.getByRole("button", { name: "View details for The Matrix" }).click();

  const panelHeadings = await page.locator(".film-context-panel .context-panel-header").evaluateAll((headers) => headers.map((header) => header.textContent.trim()));
  expect(panelHeadings[0]).toContain("My Cinema");
  expect(panelHeadings[1]).toContain("Cine-Cord");
  await expect(page.locator(".shared-panel")).toHaveClass(/is-compact/);

  await page.getByRole("button", { name: "Back to My Films" }).click();
  await expect(page.getByRole("searchbox", { name: "Search My Films" })).toHaveValue("matrix");
  await expect(page.locator(".personal-poster-card")).toHaveCount(1);
});

test("private reactions save one level and preserve an explicit Did Not Finish state", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The complete reaction keyboard contract is covered once.");

  await page.locator('[data-nav-area="my-cinema"] .nav-area-toggle').click();
  await page.getByRole("button", { name: "View details for The Matrix" }).click();
  const didNotFinishState = page.locator('[data-personal-state="DID_NOT_FINISH"]');
  await didNotFinishState.click();

  const ratingLabel = page.locator("[data-rating-label]");
  const savedReaction = page.getByRole("button", { name: "Level 4 of 5, Really liked it" });
  const firstReaction = page.getByRole("button", { name: "Level 1 of 5, Didn’t like it" });

  await expect(savedReaction).toHaveAttribute("aria-pressed", "true");
  await expect(savedReaction).toHaveText("4");
  await expect(page.locator(".reaction-control img, [data-reaction-stage]")).toHaveCount(0);
  await expect(ratingLabel).toHaveText("4 — Really liked it");

  await firstReaction.hover();
  await expect(ratingLabel).toHaveText("1 — Didn’t like it");
  await expect(savedReaction).toHaveAttribute("aria-pressed", "true");
  await expect(firstReaction).toHaveAttribute("aria-pressed", "false");

  await page.locator("#reaction-question").hover();
  await expect(ratingLabel).toHaveText("4 — Really liked it");

  await savedReaction.focus();
  await savedReaction.press("Home");
  await expect(firstReaction).toBeFocused();
  await expect(ratingLabel).toHaveText("1 — Didn’t like it");
  await expect(firstReaction).toHaveAttribute("aria-pressed", "false");
  await expect(savedReaction).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Clear rating" }).focus();
  await expect(ratingLabel).toHaveText("4 — Really liked it");

  await firstReaction.focus();
  await firstReaction.press("Enter");
  await expect(firstReaction).toHaveAttribute("aria-pressed", "true");
  await expect(ratingLabel).toHaveText("1 — Didn’t like it");
  await expect(didNotFinishState).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".reaction-control [role='status']")).toContainText("Saved, Didn’t like it");

  await page.getByRole("button", { name: "Clear rating" }).click();
  await expect(ratingLabel).toHaveText("Choose a rating");
  await expect(page.locator("[data-reaction-choice][aria-pressed='true']")).toHaveCount(0);
  await expect(didNotFinishState).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("switch", { name: /Favourite/ })).toHaveAttribute("aria-checked", "true");
});

test("compact ratings and film facts fit at every breakpoint", async ({ page }, testInfo) => {

  await page.locator('[data-nav-area="my-cinema"] .nav-area-toggle').click();
  await page.getByRole("button", { name: "View details for Pulp Fiction" }).click();
  const reactions = page.locator("[data-reaction-choice]");
  await expect(reactions).toHaveCount(5);
  await expect(reactions.first()).toBeVisible();
  const boxes = await reactions.evaluateAll((choices) => choices.map((choice) => {
    const {x,y,width,height} = choice.getBoundingClientRect();
    return {x,y,width,height};
  }));
  expect(boxes.every((box) => box.height >= 44 && box.width >= 44 && box.y === boxes[0].y)).toBe(true);
  expect(await page.locator(".reaction-control").evaluate((element) => element.getBoundingClientRect().height)).toBeLessThanOrEqual(140);
  await expect(page.locator(".film-fact-card, .reaction-control img")).toHaveCount(0);
  await expect(page.locator(".film-detail-view")).not.toContainText("Phase 2B");
  await expect(page.locator(".film-detail-view")).not.toContainText("TMDB ID");
  await expect(page.getByRole("button", {name: "Remove from My Cinema"})).toBeHidden();
  const poster = page.locator(".film-artwork img");
  await expect.poll(() => poster.evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);
  expect(await poster.evaluate((image) => getComputedStyle(image).objectFit)).toBe("contain");
  await page.screenshot({ path: testInfo.outputPath("compact-film-detail.png"), fullPage: true });

  const secondReaction = page.getByRole("button", { name: "Level 2 of 5, Not for me" });
  await secondReaction.click();
  await expect(page.locator('[data-reaction-choice][data-reaction-value="2"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-rating-label]")).toHaveText("2 — Not for me");
  await page.locator('[data-personal-state="DID_NOT_FINISH"]').click();
  await expect(page.locator('[data-personal-state="DID_NOT_FINISH"]')).toHaveAttribute("aria-pressed", "true");
  await expect(secondReaction).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("switch", {name: /Favourite/}).click();
  await expect(page.getByRole("switch", {name: /Favourite/})).toHaveAttribute("aria-checked", "false");
  await page.locator('[data-personal-state="WANT_TO_WATCH"]').click();
  await expect(page.locator('[data-reaction-choice][aria-pressed="true"]')).toHaveCount(0);
  await secondReaction.click();
  await expect(page.locator('[data-personal-state="WATCHED"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#toast")).toContainText("Marked as Watched");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
});

test("shared detail adds a private film only after choosing a state", async ({ page }) => {
  await page.getByRole("button", {name: "View details for Home Alone", exact:true}).click();
  await expect(page.locator(".film-primary-context .shared-panel")).toBeVisible();
  await expect(page.locator(".film-rating")).toHaveCount(0);
  await page.locator(".film-add-menu summary").click();
  await expect(page.locator(".private-panel")).toContainText("Not in your library yet");
  await page.locator('[data-personal-state="DID_NOT_FINISH"]').click();
  await expect(page.locator('[data-personal-state="DID_NOT_FINISH"]')).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", {name:"Level 5 of 5, Loved it"}).click();
  await expect(page.locator('[data-personal-state="DID_NOT_FINISH"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".shared-panel")).toContainText("Never watched");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
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
  const memberChoices = dialog.locator('input[name="members"]');
  await expect(memberChoices).toHaveCount(5);
  expect(await memberChoices.evaluateAll((choices) => choices.every((choice) => choice.checked))).toBe(true);

  const dialogOverflow = await dialog.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(dialogOverflow).toBeLessThanOrEqual(1);
});

test("the text brand and local application images resolve in the browser", async ({ page }) => {
  const brand = page.getByRole("link", { name: "Open The Discordians movie list" });
  await expect(brand).toBeVisible();
  await expect(brand).toContainText("The Discordians");
  await expect(brand).toContainText("Companion app");

  await page.locator('[data-nav-area="admin"] .nav-area-toggle').click();
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

test("the signed-in shell shows the Discord server profile without overflowing", async ({ page }) => {
  await expect(page.locator("#session-name")).toHaveText("Basil Brush");
  await expect(page.locator("#session-identity-source")).toHaveText("The Discordians profile");
  const avatar = page.locator("#session-avatar");
  await expect(avatar).toBeVisible();
  expect(await avatar.evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);

  await page.getByRole("button", { name: "Refresh The Discordians server profile" }).click();
  await expect(page.locator("#toast")).toContainText("test Discord server-profile data");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("the master Journal keeps archives read-only and current entries actionable", async ({ page }, testInfo) => {
  await page.getByRole("button", { name: "Journal" }).click();
  await expect(page.getByRole("heading", { name: "The Journal" })).toBeVisible();
  await expect(page.locator(".journal-header .eyebrow")).toContainText("2 archived");
  await expect(page.locator(".journal-header .eyebrow")).toContainText("1 editable");
  await expect(page.locator(".journal-entry-card")).toHaveCount(3);
  if (testInfo.project.name === "phone") {
    const narrowCardGeometry = await page.evaluate(() => ({
      documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
      cards: [...document.querySelectorAll(".journal-entry-card")].map((card) => {
        const bodyRect = card.querySelector(".journal-entry-body").getBoundingClientRect();
        const actionsRect = card.querySelector(".journal-entry-actions").getBoundingClientRect();
        const actionButtons = card.querySelector(".journal-entry-action-buttons");
        const buttonRects = [...actionButtons.children].map((button) => button.getBoundingClientRect());
        return {
          footerDirection: getComputedStyle(card.querySelector(".journal-entry-actions")).flexDirection,
          actionColumns: getComputedStyle(actionButtons).gridTemplateColumns.split(" ").length,
          footerBelowBody: Math.round(actionsRect.top - bodyRect.bottom),
          footerOverflow: actionsRect.width < card.querySelector(".journal-entry-actions").scrollWidth,
          buttonsFillFooter: buttonRects.every((rect) => Math.abs(rect.width - actionButtons.getBoundingClientRect().width) <= 1),
          minimumButtonHeight: Math.min(...buttonRects.map((rect) => Math.round(rect.height))),
          contentOverflow: card.scrollHeight - card.clientHeight,
        };
      }),
    }));
    expect(narrowCardGeometry.documentOverflow).toBeLessThanOrEqual(1);
    expect(narrowCardGeometry.cards.every(({ footerDirection, actionColumns }) => footerDirection === "column" && actionColumns === 1)).toBe(true);
    expect(narrowCardGeometry.cards.every(({ footerBelowBody }) => footerBelowBody === 0)).toBe(true);
    expect(narrowCardGeometry.cards.every(({ footerOverflow, buttonsFillFooter }) => !footerOverflow && buttonsFillFooter)).toBe(true);
    expect(narrowCardGeometry.cards.every(({ minimumButtonHeight }) => minimumButtonHeight >= 44)).toBe(true);
    expect(narrowCardGeometry.cards.every(({ contentOverflow }) => contentOverflow <= 1)).toBe(true);
  }
  if (testInfo.project.name === "tablet") {
    const tabletCardGeometry = await page.evaluate(() => ({
      documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
      cards: [...document.querySelectorAll(".journal-entry-card")].map((card) => {
        const footer = card.querySelector(".journal-entry-actions");
        const actionButtons = card.querySelector(".journal-entry-action-buttons");
        return {
          footerDirection: getComputedStyle(footer).flexDirection,
          actionColumns: getComputedStyle(actionButtons).gridTemplateColumns.split(" ").length,
          footerOverflow: footer.scrollWidth - footer.clientWidth,
          minimumButtonHeight: Math.min(...[...actionButtons.children].map((button) => Math.round(button.getBoundingClientRect().height))),
          contentOverflow: card.scrollHeight - card.clientHeight,
        };
      }),
    }));
    expect(tabletCardGeometry.documentOverflow).toBeLessThanOrEqual(1);
    expect(tabletCardGeometry.cards.map(({ footerDirection }) => footerDirection)).toEqual(["column", "column", "column"]);
    expect(tabletCardGeometry.cards.map(({ actionColumns }) => actionColumns)).toEqual([2, 1, 1]);
    expect(tabletCardGeometry.cards.every(({ footerOverflow, contentOverflow }) => footerOverflow <= 1 && contentOverflow <= 1)).toBe(true);
    expect(tabletCardGeometry.cards.every(({ minimumButtonHeight }) => minimumButtonHeight >= 44)).toBe(true);
  }
  if (testInfo.project.name === "desktop") {
    const journalGeometry = await page.evaluate(() => {
      const list = document.querySelector(".journal-entry-list");
      const cards = [...document.querySelectorAll(".journal-entry-card")];
      const currentCard = cards[0];
      const currentBody = currentCard.querySelector(".journal-entry-body");
      const currentActions = currentCard.querySelector(".journal-entry-actions");
      const currentTitle = currentCard.querySelector("h2");
      const currentYear = currentCard.querySelector(".journal-entry-year");
      const listStyle = getComputedStyle(list);
      const bodyRect = currentBody.getBoundingClientRect();
      const actionsRect = currentActions.getBoundingClientRect();
      const titleRect = currentTitle.getBoundingClientRect();
      const yearRect = currentYear.getBoundingClientRect();
      return {
        listWidth: Math.round(list.getBoundingClientRect().width),
        listMarginTop: Math.round(Number.parseFloat(listStyle.marginTop)),
        listGap: Math.round(Number.parseFloat(listStyle.gap)),
        cards: cards.map((card) => ({
          width: Math.round(card.getBoundingClientRect().width),
          height: Math.round(card.getBoundingClientRect().height),
          titleSize: Math.round(Number.parseFloat(getComputedStyle(card.querySelector("h2")).fontSize)),
          contentOverflow: card.scrollHeight - card.clientHeight,
        })),
        footerWidth: Math.round(actionsRect.width),
        footerHeight: Math.round(actionsRect.height),
        footerBelowBody: Math.round(actionsRect.top - bodyRect.bottom),
        footerDirection: getComputedStyle(currentActions).flexDirection,
        footerOverflow: currentActions.scrollWidth - currentActions.clientWidth,
        titleYearGap: Math.round(yearRect.left - titleRect.right),
        actionCounts: cards.map((card) => card.querySelectorAll(".journal-entry-action-buttons > *").length),
        actionOrder: [...currentCard.querySelectorAll(".journal-entry-action-buttons > *")].map((action) => action.textContent.replace(action.querySelector(".material-symbols-outlined")?.textContent || "", "").trim()),
        actionLevels: [...currentCard.querySelectorAll(".journal-entry-action-buttons > *")].map((action) => action.classList.contains("primary-button") ? "primary" : (action.classList.contains("secondary-button") ? "secondary" : "quiet")),
        title: currentTitle.textContent.trim(),
        year: currentYear.textContent.trim(),
        facts: [...currentCard.querySelectorAll(".journal-entry-fact")].map((fact) => fact.textContent.trim().replace(/\s+/g, " ")),
        comment: currentCard.querySelector(".journal-entry-comment").textContent.trim(),
      };
    });
    const { cards, ...journalLayout } = journalGeometry;
    expect(journalLayout).toEqual({
      listWidth: 1000,
      listMarginTop: 12,
      listGap: 20,
      footerWidth: 998,
      footerHeight: 60,
      footerBelowBody: 0,
      footerDirection: "row",
      footerOverflow: 0,
      titleYearGap: 10,
      actionCounts: [4, 1, 1],
      actionOrder: ["Update Discord post", "View in Discord", "Copy for Discord", "Edit"],
      actionLevels: ["primary", "secondary", "quiet", "quiet"],
      title: "Filth",
      year: "2013",
      facts: ["Viewers — Dean, Kieran", "Recorded by Cameron"],
      comment: "Same rules still apply — corrected on Cine-Cord after posting.",
    });
    expect(cards.map(({ width, titleSize, contentOverflow }) => ({ width, titleSize, contentOverflow }))).toEqual([
      { width: 1000, titleSize: 28, contentOverflow: 1 },
      { width: 1000, titleSize: 25, contentOverflow: 1 },
      { width: 1000, titleSize: 28, contentOverflow: 1 },
    ]);
    expect(cards.every(({ height }) => height >= 216 && height <= 220)).toBe(true);
  }
  await expect(page.locator(".journal-entry-card.is-archive [data-edit-journal-entry]")).toHaveCount(0);
  await expect(page.locator(".journal-entry-card.is-archive [data-delete-journal-entry]")).toHaveCount(0);
  await expect(page.locator(".journal-entry-card.is-archive [data-journal-entry-form]")).toHaveCount(0);
  await expect(page.locator(".journal-entry-card.is-archive [data-copy-journal-entry]")).toHaveCount(0);
  await expect(page.locator(".journal-entry-card.is-archive").first()).toContainText("Original Discord message");

  await page.locator("#journal-search").fill("Ghostland");
  await expect(page.locator(".journal-entry-card")).toHaveCount(1);
  await expect(page.locator(".journal-entry-card")).toContainText("Entry #12.1");
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.locator("#journal-source-filter").selectOption({ label: "Cine-Cord entries" });
  await expect(page.locator(".journal-entry-card")).toHaveCount(1);
  await expect(page.locator(".journal-entry-card")).toContainText("Discord copy out of date");

  await page.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByRole("button", { name: "Delete entry" })).toBeVisible();
  await page.getByRole("button", { name: "Delete entry" }).click();
  const deleteDialog = page.getByRole("dialog", { name: "Delete Journal entry?" });
  await expect(deleteDialog).toBeVisible();
  await expect(deleteDialog).toContainText("Filth");
  await expect(deleteDialog).toContainText("existing Discord message");
  await expect(deleteDialog.getByRole("button", { name: "Delete entry and Discord post" })).toBeVisible();
  expect(await deleteDialog.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await deleteDialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.locator("[data-journal-entry-form]").getByRole("button", { name: "Cancel" }).click();

  if (testInfo.project.name === "desktop") {
    await page.getByRole("button", { name: "Edit" }).click();
    await page.locator("[data-journal-entry-form] [name=comment]").fill("Corrected from the website.");
    await page.getByRole("button", { name: "Save entry" }).click();
    await expect(page.locator("#toast")).toContainText("marked out of date");
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Update Discord post" }).click();
    await expect(page.locator(".journal-entry-card")).toContainText("Discord copy current");
    await expect(page.getByRole("button", { name: "Update Discord post" })).toHaveCount(0);

    await page.getByRole("button", { name: "Edit" }).click();
    await page.getByRole("button", { name: "Delete entry" }).click();
    await page.getByRole("dialog", { name: "Delete Journal entry?" }).getByRole("button", { name: "Delete entry and Discord post" }).click();
    await expect(page.locator("#toast")).toContainText("and its Discord post were deleted");
    await expect(page.locator(".journal-header .eyebrow")).toContainText("0 editable");
    await expect(page.locator(".journal-entry-card")).toHaveCount(0);
  }

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("a confirmed Queue Roulette result and Discord form stay in-bounds", async ({ page }, testInfo) => {
  test.setTimeout(45_000);
  await page.locator('[data-view="pick"]').click();
  await page.getByRole("button", { name: /Start a Session/ }).click();
  await page.getByRole("button", { name: /Create Watch Party/ }).click();
  await page.getByRole("button", { name: "Close Queue Roulette" }).click();
  await expect(page.getByRole("heading", { name: "Sessions", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel session" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: /Open current session/ }).click();
  await expect(page.locator("#roulette-runtime")).toHaveValue("any");

  if (testInfo.project.name === "desktop") {
    await page.setViewportSize({ width: 1430, height: 804 });
    const titleFontSize = await page.locator("#roulette-title").evaluate((title) => parseFloat(getComputedStyle(title).fontSize));
    expect(titleFontSize).toBe(56);
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
  await expect(page.locator(".roulette-pool .roulette-veto-token")).toHaveCount(5);
  await expect(page.locator(".roulette-pool .roulette-veto-player")).toContainText(["Cameron", "Dean", "Kieran", "Andrew", "Ross"]);
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
    await page.setViewportSize({ width: 1900, height: 1040 });
    const wideResultGeometry = await page.evaluate(() => {
      const stage = document.querySelector(".roulette-result-stage")?.getBoundingClientRect();
      const poster = document.querySelector(".roulette-winning-poster")?.getBoundingClientRect();
      const copy = document.querySelector(".roulette-result-copy")?.getBoundingClientRect();
      const reroll = document.querySelector("[data-request-reroll]");
      const rerollIcon = reroll?.querySelector(".material-symbols-outlined");
      const rerollStyle = reroll ? getComputedStyle(reroll) : null;
      const rerollIconStyle = rerollIcon ? getComputedStyle(rerollIcon) : null;
      return {
        // The decision is still open here, so the wheel belongs to the spin, not this screen.
        wheelCount: document.querySelectorAll(".roulette-result-wheel").length,
        calloutCount: document.querySelectorAll(".roulette-landed-callout").length,
        // Hand-tuned offsets once pushed the poster out of its column and over the text.
        posterWithinStage: Boolean(stage && poster && poster.left >= stage.left - 1 && poster.right <= stage.right + 1),
        posterClearsCopy: Boolean(poster && copy && poster.right <= copy.left + 1),
        rerollDisplay: rerollStyle?.display || "",
        rerollGap: parseFloat(rerollStyle?.gap || "0"),
        rerollPaddingRight: parseFloat(rerollStyle?.paddingRight || "0"),
        rerollPaddingLeft: parseFloat(rerollStyle?.paddingLeft || "0"),
        rerollIconMarginLeft: parseFloat(rerollIconStyle?.marginLeft || "0"),
        viewportOverflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    expect(wideResultGeometry.wheelCount).toBe(0);
    expect(wideResultGeometry.calloutCount).toBe(0);
    expect(wideResultGeometry.posterWithinStage).toBe(true);
    expect(wideResultGeometry.posterClearsCopy).toBe(true);
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
  // Confirming changes what the screen says, not where the film sits.
  const boxes = () => page.evaluate(() => {
    // Document-relative, so scrolling between the two reads is not mistaken for movement.
    const rect = (selector) => {
      const box = document.querySelector(selector)?.getBoundingClientRect();
      return box ? { x: Math.round(box.x + window.scrollX), y: Math.round(box.y + window.scrollY), width: Math.round(box.width) } : null;
    };
    return { poster: rect(".roulette-winning-poster"), title: rect("#roulette-winner-title"), facts: rect(".roulette-winner-facts") };
  });
  // Measure once the reveal animation has settled, or its scale(0.96) reads as movement.
  const posterSettled = () => page.waitForFunction(() => {
    const poster = document.querySelector(".roulette-winning-poster");
    return Boolean(poster) && poster.getAnimations().every((animation) => animation.playState === "finished");
  });
  await posterSettled();
  const beforeConfirm = await boxes();
  const winnerTitle = (await page.locator("#roulette-winner-title").textContent()).trim();

  await page.getByRole("button", { name: "Confirm Movie and Create Session" }).click();

  // Confirming creates an editable session, not a finished Journal entry.
  await expect(page.locator(".session-summary")).toBeVisible();
  await expect(page.locator(".roulette-result-handoff .discord-copy-card")).toHaveCount(0);
  await expect(page.locator(".session-summary-grid dt")).toHaveText(["Watch date", "Host", "Participants"]);
  await expect(page.getByRole("button", { name: "Mark as watched" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start another round" })).toHaveCount(0);

  await posterSettled();
  const afterConfirm = await boxes();
  const shiftMessage = `before=${JSON.stringify(beforeConfirm)} after=${JSON.stringify(afterConfirm)}`;
  for (const part of ["poster", "title", "facts"]) {
    expect(Math.abs(afterConfirm[part].x - beforeConfirm[part].x), `${part}.x ${shiftMessage}`).toBeLessThanOrEqual(4);
    expect(Math.abs(afterConfirm[part].y - beforeConfirm[part].y), `${part}.y ${shiftMessage}`).toBeLessThanOrEqual(4);
    expect(Math.abs(afterConfirm[part].width - beforeConfirm[part].width), `${part}.width ${shiftMessage}`).toBeLessThanOrEqual(4);
  }

  await expect(page.locator(".roulette-result-wheel")).toHaveCount(0);
  await expect(page.locator(".roulette-landed-callout")).toHaveCount(0);
  await expect(page.locator("#roulette-winner-title")).toBeFocused();

  // The watch date, participants and (for an admin) host remain editable.
  await page.locator("[data-edit-session-details]").click();
  const dateField = page.locator("#session-details-form [name=watch_date]");
  await expect(dateField).toBeVisible();
  await expect(page.locator("#session-details-form [name=host_id]")).toHaveValue("preview-cameron");
  await dateField.fill("2026-09-05");
  await page.locator("#session-details-form [name=participant]").last().uncheck();
  await page.getByRole("button", { name: "Save session details" }).click();
  // Formatted with the viewer's locale, so match the parts rather than an order.
  await expect(page.locator(".session-summary-grid dd").first()).toHaveText(/September.*5|5.*September/);

  // Marking watched is not immediate: the final details are reviewed first.
  await page.getByRole("button", { name: "Mark as watched" }).click();
  await expect(page.getByRole("heading", { name: "Review before marking watched" })).toBeVisible();
  await expect(page.locator(".discord-copy-card")).toHaveCount(0);
  await expect(page.locator("#session-details-form [name=watch_date]")).toHaveValue("2026-09-05");
  await page.getByRole("button", { name: "Confirm and mark watched" }).click();
  await expect(page.locator("#toast")).toContainText("is marked watched");

  // Watching reveals the optional Journal on Sessions; Discord is still manual.
  await expect(page.getByRole("heading", { name: "Prepare the Journal post" })).toBeVisible();
  await expect(page.locator(".copy-only-badge")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Copy for Discord" })).toBeVisible();
  await expect(page.locator(".discord-copy-actions small")).toContainText("Nothing is posted automatically");
  await expect(page.locator(".session-history-actions .status-pill").first()).toHaveText("Watched");

  // A draft survives refresh without creating a Journal entry or assigning a number.
  await page.evaluate(() => {
    const originalSetItem = Storage.prototype.setItem;
    window.__previewWorkspaceWrites = 0;
    Storage.prototype.setItem = function setItem(key, value) {
      if (key === "cine-cord-design-preview-state") window.__previewWorkspaceWrites += 1;
      return originalSetItem.call(this, key, value);
    };
  });
  const commentField = page.locator("[name=comment]");
  await commentField.fill("Still thinking about that ending.");
  const writesAfterInput = await page.evaluate(() => window.__previewWorkspaceWrites);
  await commentField.blur();
  await expect.poll(() => page.evaluate(() => window.__previewWorkspaceWrites)).toBeGreaterThan(writesAfterInput);
  await commentField.press("End");
  await commentField.type(" ");
  await commentField.press("Backspace");
  const writesBeforeTabHide = await page.evaluate(() => window.__previewWorkspaceWrites);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    delete document.visibilityState;
  });
  await expect.poll(() => page.evaluate(() => window.__previewWorkspaceWrites)).toBeGreaterThan(writesBeforeTabHide);
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Sessions", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue Journal post" })).toBeVisible();
  await page.getByRole("button", { name: "Continue Journal post" }).click();
  await expect(page.locator("[name=comment]")).toHaveValue("Still thinking about that ending.");
  await expect(page.locator("[name=entry_number]")).toHaveValue("");

  // The watched session remains editable until a real Journal entry is saved.
  await page.getByRole("button", { name: "Edit session" }).click();
  await expect(page.getByRole("heading", { name: "Edit watched session" })).toBeVisible();
  await page.locator("#session-details-form [name=watch_date]").fill("2026-09-06");
  await page.getByRole("button", { name: "Save session details" }).click();
  await expect(page.locator(".session-history-row").first()).toContainText(/6 Sept? 2026/);
  await page.getByRole("button", { name: "Continue Journal post" }).click();

  // The fancy card adds runtime and genres while the Journal is outstanding.
  const embedPreview = page.locator(".discord-embed-preview");
  await expect(embedPreview).toContainText(/\d+ min/);
  await expect(embedPreview).toContainText("Submitted by Basil Brush via Cine-Cord");
  await expect(embedPreview.locator("[data-discord-preview-genres]")).not.toHaveText("Genres unavailable");
  await expect(page.getByText("Manual copy preview")).toBeVisible();

  // The session fills these in, so they start folded away.
  const entryDetails = page.locator(".discord-entry-details");
  await expect(entryDetails).not.toHaveAttribute("open", /.*/);
  await expect(page.locator(".discord-entry-fields input[name=\"title\"]")).toBeHidden();
  const journalDetailsToggle = page.locator("[data-toggle-journal-details]");
  await journalDetailsToggle.evaluate((element) => element.scrollIntoView({ block: "center" }));
  await journalDetailsToggle.click();
  await expect(entryDetails).toHaveAttribute("open", /.*/);
  await expect(page.locator(".discord-entry-fields input[name=\"title\"]")).toBeVisible();

  if (testInfo.project.name === "desktop") {
    await page.setViewportSize({ width: 1553, height: 938 });
    const journalGeometry = await page.evaluate(() => {
      const preview = document.querySelector("#discord-template-preview");
      const buttons = [".discord-copy-actions .primary-button", "[data-open-journal]"];
      return {
        // The post you are about to paste must be fully visible, not scrolled.
        previewClippedVertically: Boolean(preview && preview.scrollHeight > preview.clientHeight + 1),
        previewClippedHorizontally: Boolean(preview && preview.scrollWidth > preview.clientWidth + 1),
        // A button whose label wraps is a button that was given too little room.
        tallestButton: Math.max(...buttons.map((selector) => document.querySelector(selector)?.getBoundingClientRect().height || 0)),
      };
    });
    expect(journalGeometry.previewClippedVertically).toBe(false);
    expect(journalGeometry.previewClippedHorizontally).toBe(false);
    expect(journalGeometry.tallestButton).toBeLessThanOrEqual(60);
  }

  // Copy saves the one real entry, removes the session from the Sessions inbox,
  // and takes the writer to the saved Journal card.
  await page.getByRole("button", { name: "Copy for Discord" }).click();
  await expect(page.getByRole("heading", { name: "The Journal" })).toBeVisible();
  await expect(page.locator("#toast")).toContainText(/Journal entry #1317 (?:saved and copied|was saved)/);
  let savedCard = page.locator(".journal-entry-card.is-current", { hasText: winnerTitle });
  await expect(savedCard).toContainText("Entry #1317");
  await page.locator('[data-view="sessions"]').click();
  await expect(page.locator(".session-history-row", { hasText: winnerTitle })).toHaveCount(0);

  // The viewing count still comes from the retained watched-session row.
  await page.locator('[data-view="list"]').click();
  await expect(page.locator(".poster-card").filter({ hasText: winnerTitle }).locator(".status-pill")).toHaveText("Watched once");
  await page.locator('[data-view="journal"]').click();
  savedCard = page.locator(".journal-entry-card.is-current", { hasText: winnerTitle });

  // Publishing remains an explicit action on the Journal card and survives a refresh.
  page.once("dialog", (dialog) => dialog.accept());
  await savedCard.getByRole("button", { name: "Post to Discord" }).click();
  await expect(savedCard).toContainText("Discord copy current");
  await expect(savedCard.getByRole("link", { name: /View in Discord/ })).toHaveAttribute(
    "href",
    /^https:\/\/discord\.com\/channels\/preview-guild\/preview-channel\/preview-\d+$/,
  );
  await page.reload();
  savedCard = page.locator(".journal-entry-card.is-current", { hasText: winnerTitle });
  await expect(savedCard).toContainText("Discord copy current");
  await expect(savedCard.getByRole("button", { name: "Post to Discord" })).toHaveCount(0);

  // Deleting the entry leaves the watch history intact and returns the session
  // to the outstanding Sessions inbox with a clean Journal form.
  await savedCard.getByRole("button", { name: "Edit" }).click();
  await savedCard.getByRole("button", { name: "Delete entry" }).click();
  await page.getByRole("dialog", { name: "Delete Journal entry?" }).getByRole("button", { name: "Delete entry and Discord post" }).click();
  await expect(page.locator("#toast")).toContainText("and its Discord post were deleted");
  await page.locator('[data-view="sessions"]').click();
  const restoredSession = page.locator(".session-history-row", { hasText: winnerTitle });
  await expect(restoredSession).toBeVisible();
  await expect(restoredSession.getByRole("button", { name: "Write Journal post" })).toBeVisible();

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

test("a participant cannot edit another host's sessions but can copy a saved Journal", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Permission surfaces are covered once.");
  const cdpSession = await page.context().newCDPSession(page);
  await cdpSession.send("Emulation.setTimezoneOverride", { timezoneId: "America/Los_Angeles" });
  await page.evaluate(() => {
    const alien = { id: "preview-alien", title: "Alien", year: 1979, posterUrl: "https://image.tmdb.org/t/p/w500/vfrQk5IPloGg1v9Rzbh2Eg3VGyM.jpg", runtime: 117, genres: ["Horror", "Science Fiction"], overview: "A deadly lifeform.", tmdbId: 348 };
    const homeAlone = { id: "preview-home-alone", title: "Home Alone", year: 1990, posterUrl: "https://image.tmdb.org/t/p/w500/onTSipZ8R3bliBdKfPtsDuHTdlL.jpg", runtime: 103, genres: ["Comedy", "Family"], overview: "Home alone.", tmdbId: 771 };
    localStorage.setItem("cine-cord-design-preview-state", JSON.stringify({
      activeSession: {
        id: "permission-current", groupId: "preview-group", createdById: "preview-cameron", hostId: "preview-cameron", hostName: "Cameron", mode: "Queue Roulette", status: "CONFIRMED", candidateCount: 8,
        participantIds: ["preview-cameron", "preview-dean"], participants: [{ id: "preview-cameron", name: "Cameron" }, { id: "preview-dean", name: "Dean" }], members: ["Cameron", "Dean"],
        selectedFilmId: alien.id, selectedFilm: alien, gameState: { phase: "confirmed", winnerId: alien.id, filters: { runtime: "any", genre: "all", includeWatched: false, weightedByAge: true } }, startedAt: "2026-08-23T18:00:00.000Z", confirmedAt: "2026-08-23T18:05:00.000Z", sessionDate: "2026-08-23", watchedAt: null, journalDraft: null, journalEntry: null,
      },
      sessionHistory: [{
        id: "permission-watched", groupId: "preview-group", createdById: "preview-cameron", hostId: "preview-cameron", hostName: "Cameron", mode: "Queue Roulette", status: "WATCHED", candidateCount: 8,
        participantIds: ["preview-cameron", "preview-dean"], participants: [{ id: "preview-cameron", name: "Cameron" }, { id: "preview-dean", name: "Dean" }], members: ["Cameron", "Dean"],
        selectedFilmId: homeAlone.id, selectedFilm: homeAlone, gameState: {}, startedAt: "2026-08-20T18:00:00.000Z", confirmedAt: "2026-08-20T18:05:00.000Z", sessionDate: "2026-08-20", watchedAt: "2026-08-20T00:00:00.000Z",
        journalDraft: { sessionId: "permission-watched", entryNumber: "1317", title: "Home Alone", year: "1990", viewerIds: ["preview-cameron", "preview-dean"], viewers: "Cameron, Dean", status: "Finished", comment: "Christmas classic." },
        journalEntry: { id: "permission-journal", entryNumber: 1317, title: "Home Alone", year: 1990, watchedAt: "2026-08-20", status: "FINISHED", comment: "Christmas classic.", viewerIds: ["preview-cameron", "preview-dean"] },
      }],
      rouletteState: { phase: "confirmed", winnerId: alien.id, filters: { runtime: "any", genre: "all", includeWatched: false, weightedByAge: true } },
      discordDraft: null,
      previewNextEntryNumber: 1318,
      watchState: [{ id: homeAlone.id, watched: true, watchCount: 1, lastWatchedOn: "2026-08-20" }],
    }));
  });

  await page.goto("/moviepicker/?design-preview=observer#sessions");
  await expect(page.getByRole("heading", { name: "Sessions", exact: true })).toBeVisible();
  await expect(page.locator(".session-history-row", { hasText: "Home Alone" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Mark as watched" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cancel session" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit session" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Write Journal post" })).toHaveCount(0);
  await page.locator('[data-view="journal"]').click();
  const savedEntry = page.locator(".journal-entry-card.is-current", { hasText: "Home Alone" });
  await expect(savedEntry).toBeVisible();
  await expect(savedEntry.getByRole("button", { name: "Copy for Discord" })).toBeVisible();
  await expect(savedEntry.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await expect(savedEntry.getByRole("button", { name: "Post to Discord" })).toHaveCount(0);
});

test("a Discord failure still moves the saved session into the Journal", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The saved-before-post failure path is covered once.");
  await page.evaluate(() => {
    const alien = { id: "preview-alien", title: "Alien", year: 1979, posterUrl: "https://image.tmdb.org/t/p/w500/vfrQk5IPloGg1v9Rzbh2Eg3VGyM.jpg", runtime: 117, genres: ["Horror", "Science Fiction"], overview: "A deadly lifeform.", tmdbId: 348 };
    localStorage.setItem("cine-cord-design-preview-state", JSON.stringify({
      activeSession: null,
      sessionHistory: [{
        id: "discord-failure-session", groupId: "preview-group", createdById: "preview-cameron", hostId: "preview-cameron", hostName: "Cameron", mode: "Queue Roulette", status: "WATCHED", candidateCount: 8,
        participantIds: ["preview-cameron", "preview-dean"], participants: [{ id: "preview-cameron", name: "Cameron" }, { id: "preview-dean", name: "Dean" }], members: ["Cameron", "Dean"],
        selectedFilmId: alien.id, selectedFilm: alien, gameState: {}, startedAt: "2026-08-24T18:00:00.000Z", confirmedAt: "2026-08-24T18:05:00.000Z", sessionDate: "2026-08-24", watchedAt: "2026-08-24T00:00:00.000Z", journalDraft: null, journalEntry: null,
      }],
      rouletteState: null,
      discordDraft: null,
      previewNextEntryNumber: 1317,
      watchState: [{ id: alien.id, watched: true, watchCount: 1, lastWatchedOn: "2026-08-24" }],
    }));
  });

  await page.goto("/moviepicker/?design-preview=discord-error#sessions");
  const pendingSession = page.locator(".session-history-row", { hasText: "Alien" });
  await expect(pendingSession).toBeVisible();
  await pendingSession.getByRole("button", { name: "Write Journal post" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Post to Discord" }).click();

  await expect(page.getByRole("heading", { name: "The Journal" })).toBeVisible();
  await expect(page.locator("#toast")).toContainText("The Journal was saved, but Discord was not posted to");
  const savedEntry = page.locator(".journal-entry-card.is-current", { hasText: "Alien" });
  await expect(savedEntry).toContainText("Entry #1317");
  await expect(savedEntry.getByRole("button", { name: "Post to Discord" })).toBeVisible();
  await page.locator('[data-view="sessions"]').click();
  await expect(page.locator(".session-history-row", { hasText: "Alien" })).toHaveCount(0);
});
