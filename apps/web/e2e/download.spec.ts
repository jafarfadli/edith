import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

const SAMPLE = path.join(__dirname, "fixtures", "sample.pdf");
const EXPORT = "**/documents/*/export";

test("a failing download says why and can be retried", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.getByTestId("file-input").setInputFiles(SAMPLE);
  await expect(page.getByTestId("page").first()).toBeVisible();
  const unduh = page.getByRole("button", { name: "Unduh" });
  const alert = page.getByRole("alert").filter({ hasText: /./ }); // not Next.js's empty route announcer

  // A proxy error page instead of the API's JSON error.
  await page.route(EXPORT, (r) => r.fulfill({ status: 502, contentType: "text/html", body: "<html>Bad Gateway</html>" }));
  await unduh.click();
  await expect(alert).toContainText("Server sedang bermasalah (502)");

  // The connection drops.
  await page.unroute(EXPORT);
  await page.route(EXPORT, (r) => r.abort("connectionreset"));
  await alert.getByRole("button", { name: "Coba lagi" }).click();
  await expect(alert).toContainText("Tidak dapat terhubung ke server");

  // 200, but not a PDF (an HTML page from something in between).
  await page.unroute(EXPORT);
  await page.route(EXPORT, (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<html>login</html>" }));
  await alert.getByRole("button", { name: "Coba lagi" }).click();
  await expect(alert).toContainText("Server tidak mengirim file PDF");

  // An API error with its code: no retry button (a re-upload is needed), the mapped message.
  await page.unroute(EXPORT);
  await page.route(EXPORT, (r) => r.fulfill({ status: 410, contentType: "application/json", body: JSON.stringify({ error: { code: "doc_expired", message: "expired" } }) }));
  await unduh.click();
  await expect(alert).toContainText("Sesi dokumen sudah berakhir");
  await expect(alert.getByRole("button", { name: "Coba lagi" })).toHaveCount(0);

  // Back to the real server: Coba lagi from a transient error downloads the PDF and says so.
  await page.unroute(EXPORT);
  await page.route(EXPORT, (r) => r.abort("connectionreset"), { times: 1 });
  await unduh.click();
  await expect(alert).toContainText("Tidak dapat terhubung ke server");
  const pending = page.waitForEvent("download");
  await alert.getByRole("button", { name: "Coba lagi" }).click();
  const file = path.join(test.info().outputDir, "retry.pdf");
  await (await pending).saveAs(file);
  expect(readFileSync(file).subarray(0, 5).toString()).toBe("%PDF-");
  await expect(page.getByRole("status").filter({ hasText: "Mengunduh" })).toBeVisible();
  await expect(page.getByRole("status").getByRole("button", { name: "Buka di tab baru" })).toBeVisible();
});
