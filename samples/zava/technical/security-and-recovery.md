# Zava Checkout Security and Recovery Standard

Document: TECH-004, revision 2. Effective: 1 October 2026.
Owner: Information Security and Database Operations.

This is original fictional demonstration content, not a security certification or a real recovery procedure.

## Identity and data handling

Workloads use managed identities and least-privilege access. Production secrets stay in the approved secret store and are not copied into source code, incident tickets, chat, or logs.

Telemetry excludes payment-card data, access tokens, customer addresses, and full checkout payloads. Correlation IDs and aggregate metrics are sufficient for the demonstration runbook.

## Recovery objectives

The order database has an illustrative recovery point objective of 15 minutes and recovery time objective of 60 minutes. These are design targets, not evidence that a particular recovery achieved them.

Point-in-time recovery retains 35 days of database restore points. The order-events stream retains seven days. These retention periods do not mean a restore is safe without reconciling external payment state.

## Restore authorization

A restore requires confirmed corruption or an otherwise unrecoverable data-integrity incident, plus incident-commander and Database Owner approval.

Before restoring, record the affected database, last known good recovery point, estimated write-loss window, payment-reconciliation plan, and communication owner. Restore into an isolated recovery database, validate integrity, and approve cutover; do not overwrite the current database as the first diagnostic step.

After a restore, reconcile external payment outcomes, order state, outbox records, and consumers. Deduplicate event replay using event_id. Record actual recovery times and data loss against the objectives.

## What is not authorization

An API deployment regression, a brief timeout spike, a delayed Loyalty Worker, an unapproved incident ticket, or the existence of a backup is not permission to restore.

The reportable answer should distinguish the documented process from missing operational facts: current backups, a selected restore point, live approvals, successful integrity checks, and actual reconciliation results are not supplied here.
