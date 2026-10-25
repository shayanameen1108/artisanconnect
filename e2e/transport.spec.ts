import { clickUntil, expect, seed, signIn, test } from "./support/helpers";

// Server functions POST to /_serverFn; aborting one acts out a dropped
// connection without touching anything the page shows. Before the page
// hydrates a fill is emptied and a click does nothing (helpers.ts), so
// the Title is filled until it holds and the click goes through
// clickUntil.
test("a dropped save keeps the draft's Title, says it may be tried again, and frees the button", async ({
  page,
}) => {
  const { email, password } = seed<{ email: string; password: string }>("hire");
  await signIn(page, { email, password });

  await page.route(/\/_serverFn(\/|$)/, (route) => route.abort());
  await page.goto("/jobs/new");
  const title = page.getByLabel("Title", { exact: true });
  await expect(async () => {
    await title.fill("Kitchen tap leaks");
    await expect(title).toHaveValue("Kitchen tap leaks", { timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  const save = page.getByRole("button", { name: "Save Draft" });
  await clickUntil(save, async () => {
    await expect(
      page.getByText(
        "Something went wrong on our side, or the connection dropped. Nothing you did was lost; try again.",
      ),
    ).toBeVisible();
  });
  await expect(title).toHaveValue("Kitchen tap leaks");
  await expect(save).toBeEnabled();
});
