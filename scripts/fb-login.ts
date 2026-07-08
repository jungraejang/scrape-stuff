/**
 * One-time Facebook login for the Marketplace scraper.
 *
 * Opens a real browser window. Log in to Facebook manually (including any
 * 2FA), and the session cookies are saved to fb-session.json for
 * scrape-facebook.ts to reuse. Re-run whenever the session expires.
 *
 * Run with: npm run fb:login
 */
import { chromium } from "playwright";

const SESSION_FILE = "fb-session.json";
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

async function main() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("https://www.facebook.com/login");

  console.log("A browser window has opened.");
  console.log("Log in to Facebook there (finish any 2FA). Waiting up to 5 minutes...");

  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  let loggedIn = false;
  while (Date.now() < deadline) {
    const cookies = await context.cookies("https://www.facebook.com");
    if (cookies.some((c) => c.name === "c_user")) {
      loggedIn = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  if (!loggedIn) {
    console.error("Timed out waiting for login. Run npm run fb:login again.");
    await browser.close();
    process.exit(1);
  }

  await context.storageState({ path: SESSION_FILE });
  console.log(`Logged in. Session saved to ${SESSION_FILE} (gitignored - keep it private).`);
  console.log("You can close the browser window. Now run: npm run scrape:facebook");
  await browser.close();
}

main().catch((err) => {
  console.error("Login failed:", err);
  process.exit(1);
});
