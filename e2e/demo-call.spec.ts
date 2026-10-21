import { expect, test } from "@playwright/test";

// End-to-end call with the scripted buyer: typed replies, no mic, no model download.
test("demo call: type replies, buyer answers, call ends with a scorecard", async ({ page }) => {
  await page.goto("/?demo");
  await page.getByLabel("Speak with the microphone").uncheck({ force: true }).catch(() => {});
  await page.getByLabel("Buyer speaks out loud").uncheck();
  await page.getByRole("button", { name: /^Load$/ }).click();
  await expect(page.getByRole("button", { name: "Ready ✓" })).toBeVisible();
  await page.getByRole("button", { name: "Start call" }).click();

  await expect(page.getByText("Ramesh here.", { exact: false })).toBeVisible();
  await expect(page.getByTestId("call-state")).toHaveText(/Your turn/);

  const reply = page.getByLabel("Your reply");
  await reply.fill("Hi Ramesh, how do you plan routes today?");
  await reply.press("Enter");
  await expect(page.getByText("what exactly does it cost", { exact: false })).toBeVisible();
  await expect(page.getByTestId("metrics")).toContainText("tok/s");

  await reply.fill("We usually save 10 percent on fuel. Can we do a pilot next week?");
  await reply.press("Enter");
  await expect(page.getByText("Our current vendor is half the price", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "End call" }).click();
  await expect(page.getByRole("heading", { name: "Call review" })).toBeVisible();
  await expect(page.getByTestId("score-summary")).toContainText("checks passed");
  await expect(page.getByText("Proposed a concrete next step")).toBeVisible();

  await page.getByRole("button", { name: "History" }).click();
  await expect(page.getByText("Skeptical VP Procurement", { exact: false })).toBeVisible();
});
