import { test as base, type Page } from "@playwright/test";
import { expect, openApp, runExample, skipWelcome, test } from "./helpers";

// The workspace laid out like VS Code, Saarthi's streamed chat, installing
// KAIRO as an app, and the star field of the boot sequence.

async function height(page: Page, testId: string): Promise<number> {
  return (await page.getByTestId(testId).boundingBox())?.height ?? 0;
}

async function width(page: Page, testId: string): Promise<number> {
  return (await page.getByTestId(testId).boundingBox())?.width ?? 0;
}

test("the terminal panel resizes, maximizes, hides with Ctrl+` and comes back on Run", async ({ page }) => {
  await skipWelcome(page);
  await openApp(page);
  const panel = page.getByTestId("panel-pane");
  await expect(panel).toBeVisible();

  // Drag the divider above the terminal 120 px up: the terminal grows by as much.
  const before = await height(page, "panel-pane");
  const sash = page.getByRole("separator", { name: "Resize the terminal" });
  const box = (await sash.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 120, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => height(page, "panel-pane")).toBeGreaterThan(before + 100);

  // The divider works from the keyboard too, and Enter puts the default size back.
  const dragged = await height(page, "panel-pane");
  await sash.focus();
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => height(page, "panel-pane")).toBeLessThan(dragged);
  await page.keyboard.press("Enter");
  await expect.poll(async () => Math.abs((await height(page, "panel-pane")) - before)).toBeLessThan(4);

  // Maximize gives the terminal the whole column; restore brings the editor back.
  await page.getByTestId("panel-maximize").click();
  await expect(page.locator(".monaco-editor")).toBeHidden();
  await expect(page.getByTestId("panel-maximize")).toHaveAttribute("aria-label", "Restore the terminal size");
  await page.getByTestId("panel-maximize").click();
  await expect(page.locator(".monaco-editor")).toBeVisible();

  // Ctrl+` hides and shows it, as in VS Code.
  await page.getByTestId("workspace").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Control+Backquote");
  await expect(panel).toHaveCount(0);
  await expect(page.getByTestId("toggle-terminal")).toHaveAttribute("aria-label", /Show the terminal/);
  await page.keyboard.press("Control+Backquote");
  await expect(panel).toBeVisible();

  // Hidden, it comes back by itself when the program runs.
  await page.getByTestId("panel-close").click();
  await expect(panel).toHaveCount(0);
  await page.getByTestId("run-button").click();
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("program-stdout")).not.toBeEmpty({ timeout: 30_000 });
});

test("the explorer and Saarthi's panel resize and hide like VS Code's side bars, and the layout is remembered", async ({ page }) => {
  await skipWelcome(page);
  await openApp(page);
  await expect(page.getByTestId("sidebar-pane")).toBeVisible();
  await expect(page.getByTestId("secondary-pane")).toBeVisible();

  // Saarthi's panel grows when its divider is dragged to the left.
  const saarthi = await width(page, "secondary-pane");
  const sash = page.getByRole("separator", { name: "Resize Saarthi's panel" });
  const box = (await sash.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 80, box.y + 200, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => width(page, "secondary-pane")).toBeGreaterThan(saarthi + 60);
  const wider = await width(page, "secondary-pane");

  // The Layout buttons say what they do, and hide both side bars.
  await expect(page.getByTestId("toggle-explorer")).toHaveAttribute("aria-label", /Hide the explorer/);
  await page.getByTestId("toggle-explorer").click();
  await expect(page.getByTestId("sidebar-pane")).toHaveCount(0);
  await page.getByTestId("toggle-saarthi").click();
  await expect(page.getByTestId("secondary-pane")).toHaveCount(0);

  // After a reload the workspace is as it was left.
  await page.reload();
  await expect(page.locator(".monaco-editor")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("sidebar-pane")).toHaveCount(0);
  await expect(page.getByTestId("secondary-pane")).toHaveCount(0);

  // Ctrl+B and Ctrl+Alt+B bring them back, Saarthi's panel at the width it had.
  await page.getByTestId("workspace").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Control+B");
  await expect(page.getByTestId("sidebar-pane")).toBeVisible();
  await page.keyboard.press("Control+Alt+B");
  await expect(page.getByTestId("secondary-pane")).toBeVisible();
  expect(Math.abs((await width(page, "secondary-pane")) - wider)).toBeLessThan(4);

  // Dragging a side bar far past its smallest size hides it.
  const explorerSash = page.getByRole("separator", { name: "Resize the side bar" });
  const at = (await explorerSash.boundingBox())!;
  await page.mouse.move(at.x + at.width / 2, at.y + 200);
  await page.mouse.down();
  await page.mouse.move(at.x - 260, at.y + 200, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByTestId("sidebar-pane")).toHaveCount(0);
});

test.describe("Saarthi's chat", () => {
  test.beforeEach(async ({ page, request }) => {
    const status = await (await request.get("/api/v1/assistant/status")).json();
    test.skip(status.model !== "mock-saarthi", "needs the mock AI provider (scripts/mock_llm.py)");
    await skipWelcome(page);
    await openApp(page);
  });

  test("an answer is written word by word and can be stopped", async ({ page }) => {
    await page.getByTestId("workspace").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+Alt+I"); // focuses the question box, like Copilot Chat
    await expect(page.getByTestId("saarthi-input")).toBeFocused();
    // "[slow]" makes the mock stream a long answer slowly (scripts/mock_llm.py).
    await page.keyboard.type(`Explain loops step by step [slow] (${Date.now()})`);
    await page.keyboard.press("Enter");

    const chat = page.getByTestId("saarthi-chat");
    const writing = chat.locator("li[data-streaming]");
    await expect(writing).toContainText("You asked", { timeout: 15_000 });
    await expect(writing).toContainText("writing...");
    await expect(writing).not.toContainText("end.");
    await page.getByTestId("saarthi-stop").click();
    await expect(chat.locator("li[data-streaming]")).toHaveCount(0);
    await expect(chat).toContainText("stopped");
    await page.waitForTimeout(1000);
    await expect(chat).not.toContainText("end."); // nothing more arrives after Stop

    // A whole answer arrives and gets a copy button; New chat starts over.
    await page.getByTestId("saarthi-input").fill(`What is a loop? (${Date.now()})`);
    await page.keyboard.press("Enter");
    await expect(chat).toContainText("You asked: What is a loop?");
    await expect(chat.getByRole("button", { name: "Copy the answer" }).last()).toBeVisible();
    await page.getByTestId("saarthi-new-chat").click();
    await expect(chat).toHaveCount(0);
  });

  test("the suggestions ask about the error on screen with one click", async ({ page }) => {
    await runExample(page, "missing-semicolon");
    await expect(page.locator('[data-code="C_MISSING_SEMICOLON"]').first()).toBeVisible({ timeout: 30_000 });
    const suggestions = page.getByTestId("saarthi-suggestions");
    await expect(suggestions).toBeVisible();
    await suggestions.getByRole("button", { name: /Explain this error/ }).click();
    await expect(page.getByTestId("saarthi-chat")).toContainText("You asked", { timeout: 15_000 });
  });
});

test("KAIRO can be installed as an app", async ({ page, request }) => {
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest.display).toBe("standalone");
  expect(manifest.start_url).toBe("/?source=app");
  expect(manifest.icons.some((icon: { sizes: string; purpose: string }) => icon.sizes === "512x512" && icon.purpose === "maskable")).toBe(true);
  for (const icon of manifest.icons as { src: string }[]) expect((await request.get(icon.src)).ok(), icon.src).toBe(true);
  const worker = await request.get("/sw.js");
  expect(worker.ok()).toBe(true);
  expect(await worker.text()).toContain('url.pathname.startsWith("/api/")'); // runs and Saarthi are never cached

  await skipWelcome(page);
  await openApp(page);
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);

  // When the browser offers installation, KAIRO shows its Install button, which opens the browser's prompt.
  await page.evaluate(() => {
    const offer = new Event("beforeinstallprompt", { cancelable: true }) as Event & {
      prompt(): Promise<void>;
      userChoice: Promise<{ outcome: string }>;
    };
    (window as unknown as { __prompted: number }).__prompted = 0;
    offer.prompt = async () => void ((window as unknown as { __prompted: number }).__prompted += 1);
    offer.userChoice = Promise.resolve({ outcome: "accepted" });
    window.dispatchEvent(offer);
  });
  const install = page.getByTestId("install-app").filter({ visible: true }).first();
  await expect(install).toBeVisible();
  await install.click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __prompted: number }).__prompted)).toBe(1);
  await expect(page.getByTestId("install-app").filter({ visible: true })).toHaveCount(0);
});

base("the boot sequence draws the star field that forms the KAIRO mark", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("boot")).toBeVisible();
  const field = page.getByTestId("astra-gather");
  await expect(field).toBeVisible();
  // The canvas really draws: some of its pixels are lit.
  await page.waitForTimeout(900);
  const lit = await field.locator("canvas").evaluate((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext("2d")!;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    for (let i = 3; i < data.length; i += 4 * 7) if (data[i] > 40) count += 1;
    return count;
  });
  expect(lit).toBeGreaterThan(200);
  await page.keyboard.press("Space"); // any key skips it
  await expect(page.getByTestId("boot")).toHaveCount(0);
});
