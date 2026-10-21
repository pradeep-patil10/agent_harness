import { expect, test } from "@playwright/test";

// Hinglish demo call with replies written the way hi-IN speech recognition outputs them
// (English words in Devanagari). Scripted buyer, so this checks the app, not model quality.
test("Hinglish demo call: Hinglish opener and replies, Devanagari transcript scores correctly", async ({ page }) => {
  await page.goto("/?demo");
  await page.getByLabel("Language").selectOption("hinglish");
  await page.getByLabel("Buyer speaks out loud").uncheck();
  await expect(page.getByLabel("Hindi voice")).toHaveCount(0); // voice pickers hidden when voice is off
  await page.getByRole("button", { name: /^Load$/ }).click();
  await page.getByRole("button", { name: "Start call" }).click();

  await expect(page.getByText("Ramesh बोल रहा हूँ", { exact: false })).toBeVisible();
  const reply = page.getByLabel("Your reply");
  const myTurn = () => expect(page.getByTestId("call-state")).toHaveText(/Your turn/);

  await myTurn();
  await reply.fill("सर आप अभी रूट्स कैसे प्लान करते हैं और फ्यूल पर कितना खर्च होता है");
  await reply.press("Enter");
  await expect(page.getByText("exactly cost क्या है", { exact: false })).toBeVisible();

  await myTurn();
  await reply.fill("हमारे कस्टमर्स को तीन महीने में दस परसेंट की बचत होती है तो आरओआई जल्दी आता है");
  await reply.press("Enter");
  await expect(page.getByText("आधे price में देता है", { exact: false })).toBeVisible();

  await myTurn();
  await reply.fill("बीस ट्रक्स पर तीस दिन का फ्री पायलट कर लेते हैं, अगले हफ्ते शुरू करें");
  await reply.press("Enter");
  await expect(page.getByText("तीन महीने में results", { exact: false })).toBeVisible();
  await page.screenshot({ path: "test-results/hinglish-call.png", fullPage: true });

  await page.getByRole("button", { name: "End call" }).click();
  await expect(page.getByRole("heading", { name: "Call review" })).toBeVisible();
  for (const label of ["Asked about current process", "Quantified ROI / savings", "Offered to reduce risk", "Proposed a concrete next step"]) {
    await expect(page.locator(".scorecard li.good", { hasText: label })).toBeVisible();
  }
  await page.screenshot({ path: "test-results/hinglish-review.png", fullPage: true });
});
