// Browser integration against disposable local DB; provider transports are isolated fakes.
const assert = require("node:assert/strict"),
  crypto = require("node:crypto"),
  mongoose = require("mongoose"),
  { freePort } = require("../test/helpers/replica.cjs");
Object.assign(process.env, {
  NODE_ENV: "production",
  AUTH_ORIGIN: "http://localhost:5187",
  AUTH_OTP_SECRET: crypto.randomBytes(32).toString("hex"),
  AUTH_MAIL_SECRET: crypto.randomBytes(32).toString("hex"),
  JWT_SECRET: crypto.randomBytes(32).toString("hex"),
  GOOGLE_CLIENT_ID_DEVELOPMENT: "browser-check.apps.googleusercontent.com",
  RESEND_API_KEY: "fake-not-used",
});
const { chromium, webkit } = require("../frontend/node_modules/playwright"),
  app = require("../app"),
  { Flow, Mail, Limit } = require("../model/studentAuthModels"),
  Controls = require("../model/eventControlsModel"),
  User = require("../model/usersModel"),
  security = require("../utils/accounts/security");
const db = "kqv_browser_check_" + crypto.randomBytes(8).toString("hex");
let server, vite, browser;
(async () => {
  await mongoose.connect(
    process.env.AUTH_TEST_MONGO_URI.replace("/?", `/${db}?`),
    { autoIndex: false, autoCreate: false },
  );
  try {
    for (const model of Object.values(mongoose.models)) {
      await model.createCollection();
      await model.createIndexes();
    }
    await Controls.create({ _id: "event", registrationOpen: true });
    require("../utils/accounts/google").verify = async (credential) => {
      const p = JSON.parse(credential);
      return {
        email: "google.browser@gmail.com",
        emailKey: "googlebrowser@gmail.com",
        sub: "browser-sub",
        nonce: p.nonce,
      };
    };
    server = await new Promise((r) => {
      const s = app.listen(0, "127.0.0.1", () => r(s));
    });
    const { createServer } = await import("../frontend/node_modules/vite/dist/node/index.js");
    vite = await createServer({root:require("node:path").resolve(__dirname,"../frontend"),server:{host:"localhost",port:await freePort("localhost"),strictPort:true,proxy:{"/api":{target:`http://127.0.0.1:${server.address().port}`,changeOrigin:true}}}});
    await vite.listen();
    const origin = `http://localhost:${vite.httpServer.address().port}`;
    process.env.AUTH_ORIGIN = origin;
    const engine = process.env.AUTH_BROWSER === "webkit" ? webkit : chromium;
    browser = await engine.launch(process.env.AUTH_BROWSER === "webkit" || process.env.CI ? {headless:true} : {channel:"chrome",headless:true});
    const context = await browser.newContext({ reducedMotion: "reduce" });
    let blockedGoogle = true;
    await context.route("https://accounts.google.com/gsi/client", (route) => {
      if(blockedGoogle){blockedGoogle=false;return route.abort();}
      return route.fulfill({
        contentType: "application/javascript",
        body: `window.google={accounts:{id:{initialize(o){this.options=o},renderButton(el){el.textContent='';const b=document.createElement('button');b.textContent='Continue with Google';b.onclick=()=>this.options.callback({credential:JSON.stringify({nonce:this.options.nonce})});el.append(b)},cancel(){},disableAutoSelect(){}}}};`,
      });
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(origin);
    await page
      .getByRole("button", { name: "Sign in", exact: true })
      .first()
      .click();
    await page.getByRole("button", {name:"Retry Google",exact:true}).waitFor();
    await page.getByRole("button", {name:"Retry Google",exact:true}).click();
    await page.getByRole("button", { name: "Register", exact: true }).click();
    await page
      .getByLabel("Gmail address", { exact: true })
      .fill("browser.check@gmail.com");
    await page
      .getByLabel("Create password", { exact: true })
      .fill("browser-password123");
    let attempts=0;
    await context.route("**/api/v1/auth/register", route=>{attempts++;return attempts===1?route.abort():route.continue();});
    await page.getByRole("button", {name:"Send verification code",exact:true}).click();
    await page.getByRole("alert").filter({hasText:"Connection interrupted"}).waitFor();
    assert.equal(attempts,1);assert.equal(await Mail.countDocuments(),0);
    await page.getByRole("button", {name:"Send verification code",exact:true}).click();
    await page.getByLabel("6-digit email code").waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: require("node:path").resolve(
        __dirname,
        "../frontend/test-artifacts/student-otp-mobile.png",
      ),
    });
    await page.setViewportSize({ width: 1280, height: 850 });
    await page.screenshot({
      path: require("node:path").resolve(
        __dirname,
        "../frontend/test-artifacts/student-otp-desktop.png",
      ),
    });
    assert.equal(await User.countDocuments(), 0);
    let flow = await Flow.findOne({
      emailKey: "browsercheck@gmail.com",
      purpose: "register",
      consumed: false,
    });
    const text = security.unseal(
      (await Mail.findById(flow._id).select("+payload")).payload,
    ).text;
    const code = text.match(/code is (\d{6})/)[1];
    await page.getByLabel("6-digit email code").fill(code);
    await page
      .getByRole("button", { name: "Verify code", exact: true })
      .click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal(
      await page.evaluate(() =>
        localStorage.getItem("thadingyut_voter_session"),
      ),
      null,
    );
    await page.reload();
    await page
      .getByRole("link", { name: "Account and my choices", exact: true })
      .waitFor();
    await page
      .getByRole("link", { name: "Account and my choices", exact: true })
      .click();
    const cookies = await context.cookies();
    assert.ok(cookies.some((c) => c.name === "kq_session" && c.httpOnly));
    await page
      .getByRole("button", { name: "Sign out", exact: true })
      .first()
      .click();
    await page
      .getByRole("button", { name: "Sign in", exact: true })
      .first()
      .waitFor();
    await page
      .getByRole("button", { name: "Sign in", exact: true })
      .first()
      .click();
    await page
      .getByRole("button", {
        name: "Forgot password / add a password",
        exact: true,
      })
      .click();
    await page
      .getByLabel("Gmail address", { exact: true })
      .fill("browser.check@gmail.com");
    await Limit.updateOne(
      { _id: "recipient:browsercheck@gmail.com" },
      { $set: { last: new Date(Date.now() - 61000) } },
    );
    // Make the countdown elapsed in the isolated UI; the real API still enforces its own cooldown.
    await page.route(
      "**/api/v1/auth/password/recovery/start",
      async (route) => {
        const response = await route.fetch();
        const json = await response.json();
        json.data.resendAt = new Date(Date.now() - 1000).toISOString();
        await route.fulfill({ response, json });
      },
    );
    await page
      .getByRole("button", { name: "Send recovery code", exact: true })
      .click();
    await page.getByLabel("6-digit email code").waitFor();
    const recoveryFlow = await Flow.findOne({
      emailKey: "browsercheck@gmail.com",
      purpose: "recovery",
      consumed: false,
    });
    await Limit.updateOne(
      { _id: "recipient:browsercheck@gmail.com" },
      { $set: { last: new Date(Date.now() - 61000) } },
    );
    await page
      .getByRole("button", { name: "Resend code", exact: true })
      .click();
    await page.getByRole("button", { name: /Resend in/ }).waitFor();
    assert.equal((await Flow.findById(recoveryFlow._id)).consumed, true);
    assert.equal(await Mail.countDocuments(), 3);
    await page
      .getByRole("button", { name: "Back to sign in", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Continue with Google", exact: true })
      .click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal(await User.countDocuments(), 2);
    await page.goto(origin + "/#memory-gallery");
    await page.reload();
    await page
      .getByRole("link", { name: "Account and my choices", exact: true })
      .waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole("button", { name: "Open navigation menu", exact: true })
      .click();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page
      .getByRole("button", { name: "Sign in", exact: true })
      .first()
      .waitFor();
    assert.ok(!(await context.cookies()).some((c) => c.name === "kq_session"));
    await page.goto(origin + "/privacy");
    await page.getByRole("heading", { name: "Accounts and sign-in" }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: require("node:path").resolve(
        __dirname,
        "../frontend/test-artifacts/student-privacy-mobile.png",
      ),
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    console.log(
      "Browser auth passed: blocked Google retry, interrupted request without automatic replay, signup + OTP, cookie restore, no localStorage token, logout, recovery resend, Google flow, privacy route and mobile render.",
    );
  } finally {
    if (browser) await browser.close();
    await vite?.close();
    if (server) await new Promise((r) => server.close(r));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
})()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
