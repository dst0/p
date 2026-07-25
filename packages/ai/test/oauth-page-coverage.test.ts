import { describe, expect, it } from "vitest";
import { oauthErrorHtml, oauthSuccessHtml } from "../src/utils/oauth/oauth-page.ts";

describe("oauth-page coverage", () => {
  it("renders success page html with escaped strings", () => {
    const html = oauthSuccessHtml("Success! <script>alert('xss')</script> & 'quotes'");
    expect(html).toContain("Authentication successful");
    expect(html).toContain("&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt; &amp; &#39;quotes&#39;");
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("svg");
  });

  it("renders error page html with details", () => {
    const html = oauthErrorHtml("Failed to login", 'Details: "Error 500" & <bad>');
    expect(html).toContain("Authentication failed");
    expect(html).toContain("Failed to login");
    expect(html).toContain("Details: &quot;Error 500&quot; &amp; &lt;bad&gt;");
  });

  it("renders error page html without details", () => {
    const html = oauthErrorHtml("Failed to login");
    expect(html).toContain("Authentication failed");
    expect(html).toContain("Failed to login");
    expect(html).not.toContain('class="details"');
  });
});
