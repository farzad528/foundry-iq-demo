# Zava Checkout API Integration Guide

Document: TECH-003, revision 3. Effective: 1 October 2026.
Owner: Developer Platform. Related documents: TECH-001 and TECH-002.

This is original fictional demonstration content. Paths and responses describe an imaginary API, not a live endpoint.

## Create a checkout

The illustrative POST /v1/checkouts operation requires authentication, application/json, and an Idempotency-Key header. The JSON body contains basketId, currency, amountMinorUnits, and customerReference.

The amount uses integer minor units: GBP 24.50 is amountMinorUnits 2450 with currency GBP. A missing currency or a decimal amountMinorUnits is invalid.

## Outcomes

| Status | Meaning | Client action |
| --- | --- | --- |
| 201 | Checkout created | Store checkoutId and status |
| 202 | Payment outcome pending | Poll the returned status path; do not start a new charge |
| 400 | Invalid request | Correct the request before resubmitting |
| 401 | Missing or invalid authentication | Refresh through the approved identity flow |
| 409 | Key reused with different request data | Investigate; do not replace the key to force a second payment |
| 429 | Rate limited | Respect Retry-After |
| 503 | Temporary unavailability | Reconcile the existing checkout before a bounded retry |

## Retry and reconciliation

A timeout does not prove a failed charge. Query the existing checkout or payment reconciliation record first. If a retry is appropriate, preserve the original idempotency key and identical request body.

The service retains idempotency results for 24 hours. After that window, involve the payment-reconciliation owner before retrying an ambiguous payment; do not assume deduplication still protects it.

## Event consumers

Order events contain event_id, order_id, event_type, and occurred_at. Consumers persist processed event_id values and acknowledge only after their own transaction commits.

Loyalty Worker is asynchronous. Replaying an already processed event must not award points twice. Application rollback does not require clearing the stream or resetting consumer offsets.
