# Goes Local

**A multi-city business directory connecting public discovery, listing management, and GoHighLevel CRM operations.**

Company-owned project developed for Mianro Systems. Miami Goes Local (MGL) is one city deployment of the shared system.

## Problem and product

A directory is only useful when its public listings, business-owner updates, and internal CRM stay aligned. Goes Local brings search, category and neighbourhood pages, listing claims, content publishing, and operational administration into one system.

Public sites: [Miami Goes Local](https://miamigoeslocal.com) and [Orlando Goes Local](https://orlandogoeslocal.com). Public pages are suitable for a product walkthrough; administration and CRM records are not public demo material.

## Ownership and contribution

Mianro Systems retains ownership of this project. Farhan Shaikh owned requirements, architecture and data-system flow, implementation direction, testing, QA, and deployment for MGL. AI tools wrote code under direction; team members supported GoHighLevel workflows and QA. This describes delivery responsibilities, not sole manual authorship of the source or ownership of the company product.

## Architecture

```text
Public visitors / business owners / operations team
                       |
            Shared Cloudflare Worker
            server-rendered HTML + routes
                       |
        +--------------+---------------+
        |              |               |
    City D1        City KV         GoHighLevel
    directory      sessions /      CRM and
    and content    coordination    workflows
                                       |
                       scheduled synchronization
```

- **Application:** JavaScript in `worker.js`; public pages, owner tools, administration, migrations, and scheduled work share one Worker implementation.
- **Data:** per-city Cloudflare D1 (SQLite), with KV for sessions and coordination.
- **Integration:** GoHighLevel supplies CRM listing data and supports operational messaging and payment workflows; Google Places integration supports review enrichment.
- **Delivery:** Wrangler configuration and repository scripts support prechecks, configuration comparison, migration verification, and browser checks.

## Decisions and trade-offs

- **Shared code, city-specific configuration:** city variables and separate databases reduce code drift while keeping each city’s content distinct. New-city configuration still requires validation.
- **CRM synchronization needs behavioral QA:** a successful HTTP response alone does not prove a field was saved. Native and custom GHL field updates are separated, and synchronization must not undo recent edits.
- **Read efficiency matters:** caching, query indexes, and crawler controls address the cost of repeated directory reads.
- **One-file application:** straightforward deployment, but broad coupling makes regression checks and careful change review important.

## Evidence and current limitations

The repository contains the shared application, deployment tooling, and release history. `COSTS.md` records a dated before/after investigation reporting approximately 96% lower Miami D1 reads on 26 September 2026. That is a repository-recorded observation, not an independently reproduced benchmark or a promise of ongoing cost savings.

The handoff and changelog describe deployed Miami and Orlando operations; Tampa configuration was added later. Configuration in Git does not by itself establish that a city launch or every integration is complete. Consult current release notes and verify the target environment.

## Repository guide

| Location | Purpose |
| --- | --- |
| `worker.js` | Shared application and scheduled processing |
| `wrangler.toml` | City deployment configuration |
| `scripts/` | Prechecks, deployment and verification tools |
| `docs/HANDOFF.md` | System context and operational lessons |
| `docs/DEPLOY.md` | Maintainer deployment procedure |
| `changelog/` | Release-by-release changes |
| `COSTS.md` | Dated performance and cost investigation |

## Development and validation

Install dependencies with `npm ci`; run `npm run precheck` before application changes. Deployment and live checks require authorized environment access; follow `docs/DEPLOY.md`. Schema changes require the migration procedure and browser verification in each affected city.

This overview is documentation only. It does not certify a fresh deployment, security audit, or end-to-end test run.

## Demo opportunities

A short walkthrough can show public search → category/neighbourhood page → business listing, then explain the CRM-to-directory flow using a diagram. Demonstrate claims and administrative review only in an approved test environment with synthetic records. Add screenshots with captions once captured; do not include customer records, credentials, or internal datasets.
