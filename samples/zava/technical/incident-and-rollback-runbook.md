# Zava Checkout Incident and Rollback Runbook

Document: TECH-002, revision 4. Effective: 1 October 2026.
Owner: Site Reliability Engineering. Related documents: TECH-001 and TECH-004.

This is original fictional demonstration content, not instructions for operating a real production system.

## Declare and scope

Use TECH-001's sustained incident thresholds. Record the release, start time, affected region, error rate, latency window, and last successful payment reconciliation. Assign an incident commander and a payment-reconciliation owner.

An observed p95 of 1,400 ms and payment timeouts of 8% meet the numeric thresholds, but the runbook still requires evidence that they persisted for five minutes.

## Ordered containment checklist

1. Stop the rollout and preserve diagnostic evidence. Do not clear the outbox or consumer offsets.
2. Disable the new promotions feature flag if it was enabled by release 2026.10.3. Record the change.
3. Confirm schema v17 is the additive nullable-column migration described in TECH-001 and that no other migration occurred.
4. With incident-commander approval, roll stateless Checkout API instances back to 2026.10.2. Do not roll back the database for this compatible change.
5. Watch latency, timeout rate, order creation, and outbox age for ten minutes. Reconcile ambiguous payment outcomes using the existing idempotency key before any retry.
6. Let Loyalty Worker drain the existing event stream. It deduplicates by event_id; do not reset offsets to zero or discard messages.

If compatibility cannot be confirmed, stop and escalate rather than applying a speculative down migration.

## Why a restore is not the default

Application latency, an external-provider timeout, or loyalty lag alone does not justify a database restore. Restore is reserved for confirmed database corruption or an otherwise unrecoverable data-integrity incident.

TECH-004 requires incident-commander and Database Owner approval before a restore, a recorded recovery point, and a payment reconciliation plan. A restore can lose later database writes without undoing external payments.

## Recovery and remaining work

Declare service recovery only after the observation window passes, new checkout requests meet the targets, and ambiguous payments are reconciled. Record unresolved loyalty lag separately.

This runbook contains no current telemetry or actual approval record. Do not claim the incident is resolved, that a threshold persisted, or that a rollback was approved solely from the scenario description.
