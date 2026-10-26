import { clickUntil, expect, seed, signIn, test } from "./support/helpers";

// Server functions POST to /_serverFn; aborting one acts out a dropped
// connection without touching anything the page shows. Before the page
// hydrates a click does nothing and a fill is emptied when React takes
// the input over (helpers.ts), so the first dropped save doubles as the
// proof the page is hydrated; the Title is filled only after it shows.
test("a dropped save keeps the draft's Title, says it may be tried again, and frees the button", async ({
  page,
}) => {
  const { email, password } = seed<{ email: string; password: string }>("hire");
  await signIn(page, { email, password });

  await page.route(/\/_serverFn(\/|$)/, (route) => route.abort());
  await page.goto("/jobs/new");
  const save = page.getByRole("button", { name: "Save Draft" });
  const retried = page.getByText(
    "Something went wrong on our side, or the connection dropped. Nothing you did was lost; try again.",
  );
  await clickUntil(save, async () => {
    await expect(retried).toBeVisible();
  });

  const title = page.getByLabel("Title", { exact: true });
  await title.fill("Kitchen tap leaks");
  await save.click();

  await expect(title).toHaveValue("Kitchen tap leaks");
  await expect(save).toBeEnabled();
});
