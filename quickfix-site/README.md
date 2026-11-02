# QuickFIX website integration

This directory contains the public static business website and MendCue widget
connection. Upload its contents to the website's static host; it needs no server
credentials or build step. Preserve the bundled font license files.

`mendcue-config.json` contains public settings only. The current enabled flag,
backend origin, widget key, and tenant slug determine the connection. Generate a
replacement using the [integration guide](../docs/integration.md), then publish the
static files. The backend has its own [deployment procedure](../docs/deployment.md).

Keep business contact details, canonical URLs, sitemap, and allowed website origins
consistent with the authorized business. API keys and owner credentials belong
only in private backend/operator configuration.
