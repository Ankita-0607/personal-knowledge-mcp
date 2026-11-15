# Blameless postmortems

## When we write one

Any customer-facing incident of severity 1 or 2, any data-integrity problem
regardless of severity, and any near miss someone thinks we can learn from.
The draft is due within five working days of the incident being resolved.

## The blameless rule

We describe what people knew and saw at the time, not what they should have
known. "The engineer ran the migration without a dry run" becomes "the runbook
did not require a dry run and the tool did not offer one". If a sentence could
be read as blaming a person, rewrite it to name the system condition that made
the mistake easy.

## Template

1. Summary in three sentences a customer could read.
2. Impact: who was affected, for how long, and how we know.
3. Timeline with timestamps in UTC.
4. Contributing factors, plural. There is never a single root cause.
5. What went well, including detection and communication.
6. Action items, each with one owner and a due date.

## Action items

No more than five. Each must be something that would have prevented the
incident, shortened it, or made it easier to detect. "Be more careful" is not an
action item. We review open postmortem actions in the monthly operations review
and anything open after 60 days is escalated to the engineering director.
