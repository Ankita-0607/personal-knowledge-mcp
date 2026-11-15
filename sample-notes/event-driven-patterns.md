# Event-driven architecture patterns

## Idempotent consumers

Every consumer must tolerate receiving the same event twice. The broker
guarantees at-least-once delivery, so duplicates are normal, not exceptional.
We store the event id in a processed-events table inside the same transaction
as the state change and skip events we have already seen.

## Transactional outbox

To avoid the dual-write problem (the database commit succeeds but publishing
the event fails), the service writes the event to an outbox table in the same
transaction as the business change. A separate relay reads the outbox and
publishes. The event may be published late, but it is never lost and never
published for a change that rolled back.

## Dead-letter queues

An event that fails processing three times goes to a dead-letter queue with the
error attached. Every DLQ has an alarm on depth greater than zero and a named
owning team. A dead-letter queue nobody watches is a data-loss mechanism with
extra steps.

## Schema evolution

Events are versioned. Consumers ignore fields they do not know. We only ever
add optional fields; removing or renaming a field means publishing a new event
type and running both in parallel until every consumer has moved.

## Choreography or orchestration

Choreography (services react to each other's events) for simple flows.
An explicit orchestrator, such as a state machine, once a flow has more than
about four steps or needs compensation when a step fails.
