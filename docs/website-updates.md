# Website release freshness

The server serves the application HTML with `Cache-Control: no-store`, `etag off`, and `if_modified_since off`. This also covers direct `/index.html`, `/privacy` and admin entry routes. API privacy headers remain unchanged. Release packaging deliberately uses reproducible archive timestamps; Nginx's default mtime-and-size ETag could therefore repeat for different HTML with the same length, incorrectly answering 304. The HTTPS regression recreates that case.

Both built websites check their own entry HTML without cookies or cache on initial load, every minute while visible, and when returning to the tab, going online or changing the route. Matching built JS/CSS filenames mean no action. Invalid/error responses and offline checks leave the current website usable.

A changed release automatically replaces an idle student page on home, privacy, developers, entertainment or results. It retains the current route and uses a new document URL so an old cached HTML entry cannot win again. Open dialogs, focused inputs, recent interaction/submission and other student routes defer automatic replacement and display a mobile-friendly **Update now** button. Staff pages always require that button; an update never automatically reloads a staff operation. Cookies and browser storage are not cleared.

An already-open copy of code from before this checker was introduced cannot acquire a new handler without a normal navigation/reopen. No special cache-clearing instructions should be needed after the corrected server policy responds, and subsequent releases are detected by the checker. This does not push arbitrary new code into an old running tab instantly.

Checks: `npm run test:nginx` exercises real temporary local HTTPS and old conditional headers. `npm --prefix frontend run test:updates` exercises desktop and phone-sized Chromium/WebKit, safe automatic replacement, preserving forms, user-controlled updates, bad responses, staff protection and cleanup. Both run in CI without live database calls or OTP email.

Operational deployment: `deploy/nginx-public.conf` must be installed on EC2 and Nginx syntax-checked/reloaded; deploying only the built frontend does not install Nginx templates. Back up the current live configuration and preserve its unrelated settings. The checked-in template protects future server setups too.
