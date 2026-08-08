import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright-core";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = join(repoRoot, ".trellis", "artifacts", "ui-regression");
const sizes = [
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "1366x768", width: 1366, height: 768 },
  { name: "narrow-900x720", width: 900, height: 720 }
];

await mkdir(outputRoot, { recursive: true });
const profileRoot = await mkdtemp(join(tmpdir(), "codepilot-ui-"));
const electronApp = await electron.launch({
  args: [repoRoot, `--user-data-dir=${profileRoot}`],
  cwd: repoRoot
});

try {
  const page = await electronApp.firstWindow();
  await page.waitForSelector("#task-form", { state: "visible", timeout: 20_000 });
  const results = [];

  for (const size of sizes) {
    await electronApp.evaluate(({ BrowserWindow }, nextSize) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.setSize(nextSize.width, nextSize.height, false);
      window.center();
    }, size);
    await page.waitForTimeout(350);

    const basePath = join(outputRoot, `${size.name}.png`);
    await page.screenshot({ path: basePath });
    const diagnostics = await page.evaluate(() => ({
      viewport: { width: window.innerWidth, height: window.innerHeight },
      bodyOverflowX: document.body.scrollWidth > document.body.clientWidth,
      workspaceOverflowX: document.querySelector("#workspace-main").scrollWidth > document.querySelector("#workspace-main").clientWidth,
      composer: document.querySelector("#task-form").getBoundingClientRect().toJSON(),
      sidebar: document.querySelector("#workspace-sidebar").getBoundingClientRect().toJSON()
    }));
    results.push({ name: size.name, path: basePath, ...diagnostics });

    const reviewButton = page.locator('[data-change-action="review"]').first();
    if (await reviewButton.count()) {
      await reviewButton.click();
      await page.waitForTimeout(250);
      await page.screenshot({ path: join(outputRoot, `${size.name}-review.png`) });
      if (size.name === "1920x1080") {
        await page.click('[data-review-context="full"]');
        await page.waitForTimeout(120);
        await page.screenshot({ path: join(outputRoot, `${size.name}-review-full.png`) });
      }
      await page.click("#inspector-close");
    }

    if (size.name === "1920x1080") {
      await page.click("#inspector-toggle");
      await page.waitForTimeout(250);
      await page.screenshot({ path: join(outputRoot, `${size.name}-inspector.png`) });
      await page.click("#inspector-close");

      await page.click("#add-project");
      await page.waitForTimeout(180);
      await page.screenshot({ path: join(outputRoot, `${size.name}-project-create.png`) });
      await page.click("#project-create-cancel");

      await page.click("#model-settings");
      await page.waitForTimeout(220);
      await page.screenshot({ path: join(outputRoot, `${size.name}-settings.png`) });
      await page.click("#close-settings");

      await page.click("#open-skills");
      await page.waitForTimeout(220);
      await page.screenshot({ path: join(outputRoot, `${size.name}-skills.png`) });
      await page.click("#close-skills");

      await page.click("#open-mcp");
      await page.waitForTimeout(220);
      await page.screenshot({ path: join(outputRoot, `${size.name}-mcp.png`) });
      await page.click("#close-mcp");
    }

    if (size.name.startsWith("narrow")) {
      await page.click("#sidebar-toggle");
      await page.waitForTimeout(250);
      await page.screenshot({ path: join(outputRoot, `${size.name}-drawer.png`) });
      await page.click("#sidebar-scrim");
    }
  }

  console.log(JSON.stringify(results, null, 2));
} finally {
  await electronApp.close();
  await rm(profileRoot, { recursive: true, force: true });
}
