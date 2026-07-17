# Changelog

All notable changes documented here. Format: [Keep a Changelog](https://keepachangelog.com). Versioning: SemVer.

## [Unreleased]
### Added
- Spec v2.0 frozen (§1–§32): pipeline, factor architecture, strategy/portfolio split,
  data quality gate, observability, failure handling, config validation, benchmarking,
  integration testing, external data versioning.

### Changed
- Implementation stack redefined before Phase 1: Bun + TypeScript + Express (was
  Spring Boot 3 / Java 21), Redis for caching, Prisma + Prisma Migrate (was JPA + Flyway).
  PostgreSQL unchanged. Domain architecture unchanged. See ADR 0008.
  - **As-built amendments (post-spec):** the job/scheduling layer is **RabbitMQ** (not the
    BullMQ originally specced), and indicators are **in-house** implementations (not `indicatorts`)
    so they can be golden-tested. The FinBERT sidecar / Sentiment factor remain **not yet built**.
    See `../SYSTEM.md` §2 and `HANDOFF_NEXT_STEPS.md` §3.

## [0.1.0] — Phase 1 (planned)
- Angel One auth (TOTP), instrument master, PostgreSQL persistence, DataQualityService.
