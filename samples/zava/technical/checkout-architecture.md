# Zava Checkout Platform Architecture

Document: TECH-001, revision 6. Effective: 1 October 2026.
Owner: Platform Engineering. Related documents: TECH-002, TECH-003, TECH-004.

This is original fictional demonstration content. Service names, incidents, and operational values are invented.

## Request flow

The storefront calls Checkout API, which validates the basket and creates a pending order. Payment Adapter contacts the external payment provider. After an authorized payment, Checkout API commits the order and its outbox event in one database transaction.

Outbox Publisher delivers committed order events to the order-events stream. Loyalty Worker consumes those events asynchronously. A Loyalty Worker delay must not cause Checkout API to charge a customer again.

## Boundaries and idempotency

Every checkout request includes a client-generated idempotency key. The platform stores its result for 24 hours. Reusing the same key with a different basket or amount returns HTTP 409; it does not create a second charge.

The payment provider's state and Zava's order database are separate. Restoring the database does not undo external payments. Reconciliation is required after any restore.

## Healthy operating envelope

| Signal | Target | Incident trigger |
| --- | --- | --- |
| Checkout API p95 latency | Below 500 ms | Above 1,000 ms for five minutes |
| Payment timeout rate | Below 1% | Above 5% for five minutes |
| Outbox oldest-message age | Below 60 seconds | Above 300 seconds for five minutes |
| Loyalty consumer lag | Below 120 seconds | Above 900 seconds for ten minutes |

Use the actual observed time window when evaluating a trigger. One isolated sample does not prove the sustained condition.

## Release and schema

Release 2026.10.3 uses database schema v17. Its migration adds a nullable promotion_code column and leaves schema v16 consumers compatible. It does not remove or rename an existing column.

For this release, rolling the stateless API back to 2026.10.2 does not require a database restore or a down migration. Keep schema v17 in place. Confirm compatibility and follow TECH-002 rather than generalize this rule to another release.
