# Web Frontend Security Best Practices

Frontend security focuses on protecting the user from malicious execution within their browser and securing the communication channels with backends.

## 1. Cross-Site Scripting (XSS) (CWE-79)

XSS occurs when an application includes untrusted data in a web page without proper validation or escaping.

### React / Vue / Angular
Modern frameworks escape string variables by default, but provide escape hatches that must be used carefully.
**Bad Pattern (React)**:
```javascript
// BAD: DOM-based XSS if user provided user.bio
<div dangerouslySetInnerHTML={{ __html: user.bio }} />
```

**Secure Pattern**:
Rely on default data binding. If HTML must be rendered, sanitize it first on the server or client using a robust library like `DOMPurify`.
```javascript
import DOMPurify from 'dompurify';
// GOOD: Sanitized before insertion
const cleanHTML = DOMPurify.sanitize(user.bio);
<div dangerouslySetInnerHTML={{ __html: cleanHTML }} />
```

### Reflected / Stored XSS in Vanilla JS
**Bad Pattern**:
```javascript
// BAD
document.getElementById('greeting').innerHTML = "Hello " + new URLSearchParams(window.location.search).get('name');
```
**Secure Pattern**:
```javascript
// GOOD
document.getElementById('greeting').textContent = "Hello " + new URLSearchParams(window.location.search).get('name');
```

## 2. Content Security Policy (CSP)

CSP is a crucial defense-in-depth layer against XSS and data injection. It is an HTTP response header (or meta tag) that declares approved sources of content that the browser may load.
```http
Content-Security-Policy: default-src 'self'; script-src 'self' https://trusted.cdn.com; object-src 'none'; frame-ancestors 'none';
```
- Use strict CSP to prevent inline scripts (`'unsafe-inline'`) and `eval()` (`'unsafe-eval'`).

## 3. Cross-Site Request Forgery (CSRF) (CWE-352)

CSRF tricks the victim's browser into executing an unwanted action on a trusted site when the user is authenticated.
- **Primary Defense**: Use `SameSite=Lax` or `SameSite=Strict` attribute on session cookies. This prevents the browser from sending the cookie with cross-site requests.
- **Secondary Defense**: Use Anti-CSRF tokens (Synchronizer Token Pattern) for state-changing requests (POST, PUT, DELETE) if SameSite is not universally supported or sufficient.

## 4. Token Storage (localStorage vs Cookies)

- **JWT / Access Tokens**: Never store sensitive persistent tokens in `localStorage` or `sessionStorage` because they are fully accessible to any JavaScript running on the page (making them prime targets for XSS).
- **Secure Storage**: Store authentication tokens in `HttpOnly`, `Secure`, `SameSite` cookies. The browser will automatically attach them to requests to the issuing domain, but JS cannot read them.

## 5. Third-Party Integrations & Sandboxing

- **Subresource Integrity (SRI)**: When loading scripts/styles from CDNs, use SRI to ensure the file hasn't been maliciously altered.
```html
<script src="https://code.jquery.com/jquery-3.6.0.min.js" 
        integrity="sha256-/xUj+3OJU5yExlq6GSYGSHk7tPXikynS7ogEvDej/m4=" 
        crossorigin="anonymous"></script>
```
- **iframe Sandboxing**: Use the `sandbox` attribute on `<iframe>` tags to restrict the capabilities of embedded content (e.g., prevent scripts, forms, or popups unless explicitly allowed).
```html
<iframe src="https://untrusted-third-party.com" sandbox="allow-scripts"></iframe>
```
- **postMessage**: Always verify the `origin` of the sender when listening for `message` events, and specify an exact target origin (not `*`) when sending.
