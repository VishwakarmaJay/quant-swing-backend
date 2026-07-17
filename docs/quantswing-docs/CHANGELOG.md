# Changelog

All notable changes documented here. Format: [Keep a Changelog](https://keepachangelog.com). Versioning: SemVer.

## [Unreleased]
### Added
- Spec v2.0 frozen (§1–§32): pipeline, factor architecture, strategy/portfolio split,
  data quality gate, observability, failure handling, config validation, benchmarking,
  integration testing, external data versioning.

### Changed
- Implementation stack redefined before Phase 1: Bun + TypeScript + Express (was
  Spring Boot 3 / Java 21), Redis + BullMQ for scheduling/caching/rate limiting
  (was Spring @Scheduled + Caffeine), Prisma + Prisma Migrate (was JPA + Flyway).
  Redis is a soft dependency: in-process watchdog dispatches runs inline on Redis
  outage; Postgres stays the only fail-fast dependency. PostgreSQL and the FinBERT
  sidecar unchanged. Domain architecture unchanged. See ADR 0008.

## [0.1.0] — Phase 1 (planned)
- Angel One auth (TOTP), instrument master, PostgreSQL persistence, DataQualityService.
