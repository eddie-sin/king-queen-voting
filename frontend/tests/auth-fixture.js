import test from "node:test";
import { authConfig, clearAuthConfig } from "../src/authSession.js";

// Adapter tests start after the page's /auth/config handshake. No real cookies or email.
test.beforeEach(async () => {
  clearAuthConfig();
  await authConfig(
    async () =>
      new Response(
        JSON.stringify({
          status: "success",
          data: { csrfToken: "fixture-csrf" },
        }),
      ),
  );
});
