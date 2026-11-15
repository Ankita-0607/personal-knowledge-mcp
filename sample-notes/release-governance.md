# Release governance

## Release train

Production releases leave every Tuesday and Thursday at 10:00 IST. A change
that is not ready waits for the next train; the train does not wait for the
change. Predictable departures removed most of the pressure to rush a risky
change through.

## Go or no-go checklist

- All automated checks are green on the release candidate.
- No open severity 1 or 2 defects against the changes in the release.
- Database migrations have been run against a copy of production data.
- A rollback plan is written down and the on-call engineer has read it.
- Customer-facing changes are behind a feature flag that defaults to off.

## Feature flags

Flags separate deployment from release. Code ships dark, is enabled for
internal users first, then for a pilot customer, then for everyone. Every flag
has an owner and a removal date; flags older than 90 days show up in the tech
debt review.

## Freeze periods

No production releases in the last week of a quarter or during a customer's
validation window, except fixes for severity 1 incidents approved by the
engineering manager on call.

## Regulated changes

Changes to anything in the clinical reporting path need a documented risk
assessment and a second reviewer from the quality team before the go decision.
