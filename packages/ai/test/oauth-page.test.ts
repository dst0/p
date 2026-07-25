import { describe, expect, it } from "vitest";
import { oauthErrorHtml, oauthSuccessHtml } from "../src/utils/oauth/oauth-page.ts";

describe("oauth-page", () => {
  it("renders success page with escaped message", () => {
    const html = oauthSuccessHtml("Successfully logged in <script>alert(1)</script> & enjoy!");
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Authentication successful");
    expect(html).toContain("Successfully logged in &lt;script&gt;alert(1)&lt;/script&gt; &amp; enjoy!");
  });

  it("renders error page with escaped message and optional details", () => {
    const htmlWithoutDetails = oauthErrorHtml("Failed to login", undefined);
    expect(htmlWithoutDetails).toContain("Authentication failed");
    expect(htmlWithoutDetails).toContain("Failed to login");
    expect(htmlWithoutDetails).not.toContain('<div class="details">');

    const htmlWithDetails = oauthErrorHtml("Failed to login", "Invalid grant code 'foo'");
    expect(htmlWithDetails).toContain('<div class="details">Invalid grant code &#39;foo&#39;</div>');
  });
});
