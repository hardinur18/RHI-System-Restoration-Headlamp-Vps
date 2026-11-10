# Orders: All Time history loading

The orders page initially loads today's orders for a fast first render. Selecting
“Semua Waktu” cleared the date range, but both the page effect and range loader
returned early when no start date existed. Removing the client date filter did
not fetch history, leaving the 17 initially loaded rows visible as if complete.

The page now requests history when both date bounds are absent. The existing
paginated loader fetches every page, without excluding unscheduled orders. Direct
order queries use an ID tie-breaker for stable offset pagination. Date-bounded
requests and technician constraints retain their existing behavior and permissions.

A dedicated hook waits for the priority bootstrap, reloads the selected scope on
refresh, ignores obsolete request failures, exposes loading/error state, and lets
the user retry. Existing rows are retained during loading with a visible notice.

Validation: the React regression harness runs the actual provider loader against
multiple pages and tests today-to-all-time, undated rows, cached scope reuse,
technician constraints, refresh/bootstrap coordination, failure/retry and stale
request completion. Orders and core TypeScript checks pass. Live verification
uses a temporary Owner Auth/profile fixture, reads all pages without business
writes, and removes that fixture. Deployment verification is recorded separately.

## Live result

Frontend commit `426c6afc2e128b631b820155862354045e0011c5` was deployed at
23:52:27 WIB. All 223 frontend files matched their hashes over public HTTPS.
The authenticated live read retrieved **9,457 unique orders in 19 pages** and
removed its temporary fixture. In the user's signed-in Chrome session, after
accepting the PWA update, “Semua Waktu” showed the loading notice and then
**Total 9.457 / SEMUA 9457 / Data Pesanan 9457**, matching the database.
No business records or backend configuration were changed by this fix.
