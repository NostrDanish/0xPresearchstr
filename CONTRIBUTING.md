# Contributing to 0xPresearchstr

Thank you for your interest in contributing to 0xPresearchstr. This document provides guidelines and information for contributors.

## Code of Conduct

This project takes content moderation seriously. The content policy pipeline is non-negotiable and exists for legal and ethical reasons. Contributions that weaken, bypass, or remove content filtering will not be accepted.

## Getting Started

### Frontend Development

```bash
git clone https://github.com/NostrDanish/0xPresearchstr.git
cd 0xPresearchstr
npm install
npm run dev
```

The frontend runs standalone with Nostr search via NIP-50 relay queries. No backend needed for development.

### Backend Development

Each backend service can be developed independently:

```bash
# Start Meilisearch (required for all backend services)
docker compose up -d meilisearch

# Develop a specific service
cd backend/nostr-crawler
npm install
npm run dev
```

## Project Structure

- `src/` — Frontend (React SPA)
- `backend/shared/` — Shared modules (types, Meilisearch client, content policy)
- `backend/nostr-crawler/` — Nostr event indexer
- `backend/clearnet-crawler/` — Web crawler
- `backend/tor-crawler/` — Tor/I2P crawler
- `backend/nip50-relay/` — NIP-50 search relay proxy
- `backend/abuse-api/` — REST API + abuse reports

## Making Changes

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Make your changes
4. Run the frontend tests (`npm test`)
5. Commit your changes with a descriptive message
6. Push to your fork and open a Pull Request

## Commit Messages

Use conventional commit format:

```
feat: add new search filter option
fix: handle relay disconnection gracefully
docs: update deployment guide
refactor: extract shared search logic
```

## Areas for Contribution

### High Priority
- **Blocklist integration**: Automate blocklist updates from IWF, NCMEC, Ahmia
- **Engagement signals**: Add zap count, reaction count to Nostr search results
- **WoT scoring**: Implement Web of Trust scoring for Nostr result ranking
- **i18n**: Internationalize the frontend

### Medium Priority
- **Search suggestions**: Auto-complete and search suggestions
- **Advanced filters**: Date range, language, domain filtering in the UI
- **Result caching**: Client-side caching of frequent queries
- **Relay health checking**: Monitor relay availability and latency

### Backend
- **Database migration**: Replace file-based abuse report storage with SQLite/PostgreSQL
- **Rate limiting**: Add proper rate limiting to the abuse API
- **Metrics**: Prometheus/Grafana monitoring for crawler health
- **Content classifiers**: Improve keyword classifier accuracy with ML models

## Content Policy Changes

Any changes to the content policy pipeline (`backend/shared/src/content-policy.ts`) or blocklist configuration require extra review:

1. Changes must not reduce the effectiveness of existing filters
2. New categories must be documented with clear rationale
3. Classifier threshold changes must be tested against false positive/negative rates
4. All content policy changes require review by at least two maintainers

## Security

If you discover a security vulnerability, please report it privately. See [SECURITY.md](SECURITY.md) for details.

## License

By contributing to 0xPresearchstr, you agree that your contributions will be licensed under the MIT License.
