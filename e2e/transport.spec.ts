import { expect, seed, signIn, test } from "./support/helpers";

// Server functions POST to /_server; aborting one acts out a dropped
// connection without touching anything the page shows.
test("a dropped save keeps the draft's Title, says it may be tried again, and frees the button", async ({
  page,
}) => {
  const { email, password } = seed<{ email: string; password: string }>("hire");
  await signIn(page, { email, password });

  await page.route(/\/_server(\/|$)/, (route) => route.abort());
  await page.goto("/jobs/new");
  const title = page.getByLabel("Title", { exact: true });
  await title.fill("Kitchen tap leaks");
  const save = page.getByRole("button", { name: "Save Draft" });
  await save.click();

  await expect(
    page.getByText(
      "Something went wrong on our side, or the connection dropped. Nothing you did was lost; try again.",
    ),
  ).toBeVisible();
  await expect(title).toHaveValue("Kitchen tap leaks");
  await expect(save).toBeEnabled();
});
