# Managing an external engineering vendor

## Contract and SLAs

The agreement specifies response times by severity (one hour for severity 1,
four hours for severity 2, next business day for the rest), a minimum notice
period of 30 days for removing a named engineer, and a monthly service credit
if response SLAs are missed more than twice.

## Scorecard

Reviewed monthly with the vendor's delivery lead, covering four things:
delivery predictability (committed versus delivered), quality (defects found
after hand-off), responsiveness against the SLA, and staff continuity.
Each is scored red, amber or green with one sentence of evidence.

## Integration with our teams

Vendor engineers join our standups, use our repositories and follow our
definition of done. No separate vendor backlog: one backlog, one board. The
failure mode to avoid is a "throw it over the wall" interface where their work
arrives as a large batch at the end of the sprint.

## Capacity planning

I forecast vendor capacity a quarter ahead and confirm it six weeks before each
quarter starts. Ramp-up for a new vendor engineer is about four weeks before
they are net positive, so short bursts of extra capacity rarely pay off.

## Knowledge retention

Every vendor-owned component has an internal engineer as a named secondary
owner, and design decisions are recorded in our repository, not in the vendor's
tools.
