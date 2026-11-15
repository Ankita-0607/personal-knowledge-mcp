# Delivery metrics (DORA)

## The four key metrics

- **Deployment frequency**: how often we release to production.
- **Lead time for changes**: time from a commit being merged to it running in production.
- **Change failure rate**: share of deployments that cause a failure needing a fix or rollback.
- **Time to restore service**: how long it takes to recover from a failure in production.

The first two measure throughput and the last two measure stability. The
research finding that matters: strong teams are good at both at once. Speed and
stability are not a trade-off.

## How I use them

As a conversation starter for the team, never as an individual performance
measure. The moment a metric is tied to a person's review it gets gamed.
I look at trends over a quarter, not week-to-week noise.

## A worked example

A team that moves from fortnightly releases to twice a week, and from a lead
time of about nine days to under two, has improved throughput. If its change
failure rate is 12 percent against a target of below 10, stability is where
the next investment goes.

## Traps

Counting deployments of trivial config changes inflates frequency. Measuring
lead time from ticket creation instead of from merge mixes in planning delay,
which is a product-process question, not a delivery-pipeline one.
