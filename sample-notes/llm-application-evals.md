# Evaluating LLM applications

## Start with the failure cases

Before choosing metrics, read fifty real outputs and write down what went
wrong. The categories that emerge are the things worth measuring. Generic
"quality" scores hide the specific failures users actually hit.

## Retrieval metrics

For a retrieval-augmented system, measure retrieval separately from generation.
Recall at k asks whether the right passage is in the top k results. Mean
reciprocal rank rewards putting it near the top. If retrieval misses, no prompt
will fix the answer.

## Generation metrics

Faithfulness: is every claim in the answer supported by the retrieved passages?
Answer relevance: does it address the question that was asked? Check abstention
too: when the answer is not in the sources, does the system say so instead of
inventing one?

## Golden sets

A small hand-written set of questions with known answers beats a large
synthetic one. Thirty to fifty cases is enough to catch regressions. Add a case
every time a real failure is reported.

## LLM as judge

Useful for scale, but validate the judge against human labels first, and give
it a rubric with examples. A judge that agrees with humans 70 percent of the
time is measuring something else.

## Regression gates

Run the eval set in CI on every prompt or model change, and fail the build on a
drop beyond an agreed threshold.
