# Security policy

## Supported versions

Security fixes are applied to the latest release only. During the initial public release, that is the `0.2.x` line.

## Reporting a vulnerability

Use GitHub private vulnerability reporting once the public repository is enabled. Do not open a public issue for credentials, local privilege boundaries or provider-session findings.

Include the affected platform, application version, reproduction steps and impact. Remove access tokens, cookies, account identifiers and raw provider responses before attaching logs or fixtures.

## Security boundaries

Marge AI Widget does not provide an authentication boundary. It reads quota information from provider sessions already available to the current operating-system user. It must never copy, persist or log provider credentials.

The Antigravity integration is limited to loopback services owned by the current user. Claude traffic is restricted to Anthropic’s usage endpoint. Codex authentication remains inside the official Codex App Server.
