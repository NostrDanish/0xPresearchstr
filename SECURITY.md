# Security Policy

## Reporting Vulnerabilities

If you discover a security vulnerability in 0xPresearchstr, **please do not open a public issue**. Instead, report it privately:

1. **Nostr DM**: Send an encrypted DM to the project maintainer
2. **GitHub**: Use GitHub's private vulnerability reporting feature
3. **Email**: Contact the repository owner directly

We will acknowledge receipt within 48 hours and provide a timeline for a fix.

## Scope

### In Scope

- **Content policy bypass**: Any method to get blocked content into the public index
- **XSS vulnerabilities**: Especially critical because Nostr private keys may be in localStorage
- **API authentication bypass**: Accessing admin endpoints without proper credentials
- **Index poisoning**: Injecting malicious or misleading content into search results
- **Denial of service**: Resource exhaustion attacks on crawlers or relay
- **Information disclosure**: Leaking admin tokens, internal state, or user data

### Out of Scope

- Content that is correctly blocked by the content policy pipeline (working as intended)
- Social engineering attacks
- Issues in third-party dependencies (report those upstream)
- Attacks requiring physical access to the server

## Security Architecture

### Frontend

- **CSP headers**: Restrictive Content Security Policy (`script-src 'self'`)
- **URL sanitization**: All event-sourced URLs are sanitized before rendering
- **No `dangerouslySetInnerHTML`**: Content is rendered as text, never as HTML
- **Warning interstitials**: .onion/.i2p links require explicit user confirmation

### Backend

- **Content policy pipeline**: Triple-layer filtering before indexing (domain → hash → classifier)
- **Admin authentication**: Bearer token required for report management endpoints
- **Rate limiting**: Per-domain rate limiting on crawlers
- **robots.txt compliance**: Crawler respects robots.txt directives
- **Read-only relay**: NIP-50 relay rejects EVENT messages

### Infrastructure

- **Docker isolation**: Each service runs in its own container
- **Volume-mounted secrets**: Sensitive configuration via environment variables
- **Tor/I2P isolation**: Proxy containers handle all network routing
- **No persistent query logging**: Frontend is client-side; no server logs user queries

## Known Limitations

1. **File-based abuse reports**: The current abuse report storage uses JSON files. Production deployments should migrate to a proper database.
2. **Keyword classifiers**: Regex-based classifiers have inherent limitations. ML-based classifiers would improve accuracy.
3. **Single admin token**: The abuse API uses a single bearer token. Production deployments should implement proper authentication.
4. **No rate limiting on abuse API**: The report submission endpoint lacks rate limiting. Add nginx rate limiting in production.

## Responsible Disclosure

We follow responsible disclosure practices:

1. Reporters will be credited (unless they prefer anonymity)
2. We aim to fix critical vulnerabilities within 72 hours
3. We will coordinate disclosure timing with the reporter
4. A security advisory will be published after the fix is deployed
