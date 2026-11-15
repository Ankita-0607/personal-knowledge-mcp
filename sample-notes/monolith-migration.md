# Migrating the monolith to microservices

## Approach: strangler fig

We did not rewrite. We put a routing layer in front of the monolith and moved
one capability at a time behind it, starting with the reporting module because
it had the clearest boundary and the fewest writes. The monolith kept shrinking
until what was left was small enough to retire.

## Sequencing rule

Extract in order of *clearest data ownership*, not in order of what is most
painful. The most painful module is usually the most entangled, and extracting
it first teaches the team the wrong lessons.

## Data

Each service owns its own database. During the transition we used change data
capture to keep the old tables in sync, and removed the sync only after a full
release cycle with no reads from the old table.

## What I would do differently

- Invest in contract tests before the second service, not the fifth.
- Agree on one way to do service-to-service authentication on day one.
- Budget for the observability work up front: distributed tracing was not optional once there were more than three services.

## Result

The biggest win was that long-running analysis jobs stopped blocking the
request path and could scale on their own, which cut end-to-end turnaround
time substantially.
