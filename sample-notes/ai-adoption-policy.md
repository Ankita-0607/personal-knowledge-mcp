# AI adoption policy for engineering: working notes

## Principles

1. The engineer who merges the code is accountable for it, however it was written.
2. AI output gets the same review as human output. No lighter path, no heavier one.
3. What may be sent to a model depends on the data classification, not on convenience.
4. We measure outcomes before we scale a tool, and we publish the results internally.

## Data classification

- **Public and internal** code and documents: allowed with approved tools.
- **Confidential** (customer configurations, unreleased roadmap): allowed only with tools under an enterprise agreement that excludes training on our data.
- **Restricted** (patient data, credentials, anything regulated): never sent to a model, in any tool.

## Approved uses

Code completion, test generation, refactoring, documentation, code review
assistance, and agentic coding in repositories that have an agent policy file.

## Agentic coding guardrails

Agents work on a branch and open a pull request. They never push to the main
branch, never merge, and never change CI configuration or dependency manifests
without a human making that change. A named human approves the plan for
anything larger than a small fix.

## Rollout

Pilot with two teams for six weeks. Compare cycle time, review time and defect
escape rate against the previous quarter before widening. Collect developer
sentiment separately; it is useful but it is not the success measure.
