// Browser end-to-end tests. Every assertion below goes through the real UI,
// the real API routes and the real compiled circuits (LocalSimulatorNetwork).
// Run against a started app — see playwright.config.ts.

import { test, expect, type Page } from "@playwright/test";

const ID = /\/mandates\/[0-9a-f]{64}/;

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  (page as Page & { __errors?: string[] }).__errors = errors;
  await page.request.delete("/api/mandate").catch(() => {});
});

test.afterEach(async ({ page }) => {
  const errors = (page as Page & { __errors?: string[] }).__errors ?? [];
  expect(errors, "uncaught page errors").toEqual([]);
});

async function loadDemo(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Load live demo/ }).first().click();
  await expect(page).toHaveURL(ID, { timeout: 60_000 });
  await expect(page.getByText("Agent #01").first()).toBeVisible();
}

test("white glass theme: canvas, glass panels and ink text", async ({ page }) => {
  await page.goto("/");
  const [r, g, b] = await page.evaluate(() => {
    const m = getComputedStyle(document.body).backgroundColor.match(/\d+/g)!.map(Number);
    return m.slice(0, 3);
  });
  expect(Math.min(r, g, b)).toBeGreaterThan(235);
  const h1 = await page.locator("h1").first().evaluate((el) => getComputedStyle(el).color);
  const [hr, hg, hb] = h1.match(/\d+/g)!.map(Number);
  expect(Math.max(hr, hg, hb)).toBeLessThan(80);
  const blur = await page.locator(".glass-strong").first().evaluate((el) => getComputedStyle(el).backdropFilter);
  expect(blur).toContain("blur");
});

test("live demo seeds a root mandate with two delegated sub-agents", async ({ page }) => {
  await loadDemo(page);
  await expect(page.getByText("Delegation tree")).toBeVisible();
  await page.goto("/");
  await expect(page.getByText("Sub-agent #01").first()).toBeVisible();
  await expect(page.getByText("Sub-agent #02").first()).toBeVisible();
});

test("create-mandate wizard validates and creates a mandate end to end", async ({ page }) => {
  await page.goto("/mandates/new");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  // Policy step: an invalid cap blocks progress with a clear message.
  const cap = page.locator('input[type="number"]').first();
  await cap.fill("0");
  await expect(page.getByText(/Max amount must be a whole number/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
  await cap.fill("250");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Exactly what becomes public")).toBeVisible();
  await page.getByRole("button", { name: "Create mandate" }).click();
  await expect(page.getByText("Mandate created").first()).toBeVisible();
  await page.getByRole("button", { name: /Open mandate/ }).click();
  await expect(page).toHaveURL(ID);
  await expect(page.locator("[data-status='active']").first()).toBeVisible();
});

test("in-policy action is authorized; over-cap and wrong-destination are refused by the circuit", async ({ page }) => {
  await loadDemo(page);
  await page.getByRole("button", { name: "Submit action" }).click();
  await expect(page.getByText(/Authorized — action/)).toBeVisible();
  await expect(page.getByText("Commitment advanced")).toBeVisible();

  await page.getByRole("button", { name: "Over-cap attack" }).click();
  await expect(page.getByText(/Refused by the circuit — over-cap attack/)).toBeVisible();
  await expect(page.getByText(/exceeds mandate cap/).first()).toBeVisible();

  await page.getByRole("button", { name: "Wrong destination" }).click();
  await expect(page.getByText(/Refused by the circuit — wrong-destination attack/)).toBeVisible();
  await expect(page.getByText(/destination not permitted by mandate/).first()).toBeVisible();
});

test("delegation: a valid carve-out succeeds, an over-delegation is refused", async ({ page }) => {
  await loadDemo(page);
  // Seeded demo already reserved 700 of 1000; 300 is left to carve.
  await page.getByLabel("Child cap").fill("300");
  await page.getByRole("button", { name: "Delegate", exact: true }).click();
  await expect(page.getByText("Sub-agent mandate created")).toBeVisible();

  await page.getByRole("button", { name: "Over-delegate attack" }).click();
  await expect(page.getByText("Delegation refused by the circuit")).toBeVisible();
  await expect(page.getByText(/exceeds parent's remaining budget/).first()).toBeVisible();
});

test("pause freezes the subtree and resume restores it", async ({ page }) => {
  await loadDemo(page);
  await page.getByRole("button", { name: /Pause/ }).click();
  await expect(page.getByText("Mandate paused").first()).toBeVisible();
  await expect(page.locator("[data-status='paused']").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit action" })).toBeDisabled();

  await page.getByRole("button", { name: /Resume/ }).click();
  await expect(page.getByText("Mandate resumed")).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit action" })).toBeEnabled();
});

test("revoking the root cuts off every sub-agent while their own flag is untouched", async ({ page }) => {
  await loadDemo(page);
  await page.getByRole("button", { name: /^Revoke \(\+2 sub-agents\)/ }).click();
  await expect(page.getByText(/2 sub-agents will stop working instantly/)).toBeVisible();
  await page.getByRole("button", { name: "Revoke permanently" }).click();
  await expect(page.getByText("Mandate revoked").first()).toBeVisible();

  await page.goto("/");
  await expect(page.getByText(/Cut off by its parent \(revoked\)/).first()).toBeVisible();
  await page.getByText("Sub-agent #01").first().click();
  await expect(page).toHaveURL(ID);
  await expect(page.getByRole("button", { name: "Submit action" })).toBeDisabled();
  await expect(page.getByText(/Its parent is revoked/)).toBeVisible();
});

test("attestation: an honest ceiling is published, a lie is refused", async ({ page }) => {
  await loadDemo(page);
  await page.getByRole("button", { name: "Attest", exact: true }).click();
  await expect(page.getByText(/Attestation published/)).toBeVisible();
  await expect(page.getByText(/Public: spent ≤/)).toBeVisible();

  await page.getByRole("button", { name: "Attest a lie" }).click();
  await expect(page.getByText(/Attestation refused/)).toBeVisible();
  await expect(page.getByText(/attestation false: spend exceeds ceiling/).first()).toBeVisible();
});

test("public verifier shows the ledger view for a session mandate and rejects bad ids", async ({ page }) => {
  await loadDemo(page);
  await page.getByRole("link", { name: /Public view/ }).click();
  await expect(page).toHaveURL(/\/verify\?id=[0-9a-f]{64}/);
  await expect(page.getByText("The world sees")).toBeVisible();
  await expect(page.getByText("Root mandate", { exact: true })).toBeVisible();
  await expect(page.getByText("Delegated sub-mandates (2)")).toBeVisible();
  await expect(page.getByText("The world cannot see")).toBeVisible();

  await page.goto("/verify");
  await page.getByLabel("Mandate id").fill("not-an-id");
  await expect(page.getByText(/exactly 64 hex characters/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Verify" })).toBeDisabled();

  await page.getByLabel("Mandate id").fill("ab".repeat(32));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByText(/No mandate with this id is registered/)).toBeVisible();
});

test("Attack Lab: every scenario behaves exactly as the protocol promises", async ({ page }) => {
  await page.goto("/lab");
  await page.getByRole("button", { name: /Run all scenarios/ }).click();
  await expect(page.getByText("Behaved as promised")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("[data-result]")).toHaveCount(19);
  await expect(page.getByText("19/19")).toBeVisible();
  await expect(page.getByText(/parent mandate revoked/).first()).toBeVisible();
  await expect(page.getByText(/attestation false/).first()).toBeVisible();
});

test("Agent swarm: rogue agents are blocked and nothing survives the root revocation", async ({ page }) => {
  await page.goto("/lab");
  await page.getByRole("tab", { name: "Agent swarm" }).click();
  await page.getByRole("button", { name: /Launch swarm/ }).click();
  await page.getByRole("button", { name: "4×" }).click({ timeout: 60_000 });
  await expect(page.getByText(/Finished:/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/rogue attempts were blocked/)).toBeVisible();
  await expect(page.getByText("Circuit feed")).toBeVisible();
});

test("Preprod evidence page lists the deployed contract and every lifecycle step", async ({ page }) => {
  await page.goto("/preprod");
  await expect(page.getByText("live on Midnight Preprod.")).toBeVisible();
  await expect(page.getByText("15/15 steps behaved", { exact: false })).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(15);
  await expect(page.getByText("none — the proof cannot be built").first()).toBeVisible();
  await page.getByRole("button", { name: "Verify on-chain now" }).click();
  // Without an indexer key configured the page says so honestly; with one it confirms the contract.
  await expect(page.getByText(/cannot query the chain live|The indexer returns this contract|did not answer/)).toBeVisible();
});

test("deck navigates with the keyboard", async ({ page }) => {
  await page.goto("/deck");
  await expect(page.locator("h1").first()).toContainText("real authority");
  for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowRight");
  await expect(page.locator("h1").first()).toContainText("Break it");
  await expect(page.getByRole("button", { name: /Next/ })).toBeDisabled();
});

test("mobile: no horizontal overflow on any page", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/", "/mandates/new", "/lab", "/verify", "/deck"]) {
    await page.goto(path);
    await page.waitForTimeout(900);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${path} overflows horizontally by ${overflow}px`).toBeLessThanOrEqual(1);
  }
});
