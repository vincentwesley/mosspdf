import { test, expect, checkA11y, setTheme } from "./fixtures";

test("dark by default, toggles to light", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Light theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByText("Made by")).toBeAttached();
});

for (const theme of ["dark", "light"] as const) {
  test(`A-E2E-3: axe clean (${theme})`, async ({ page }) => {
    await page.goto("/");
    await setTheme(page, theme);
    await checkA11y(page, `home ${theme}`);
  });
}
