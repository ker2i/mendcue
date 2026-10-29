# Private pilot case record — v1

Store completed records under ignored `data/`, never in the public repository.
Collect 5–10 anonymized jobs. Technician review remains pending until recorded.

- Case ID; tenant ID; real anonymized or synthetic; consent/usage basis.
- Initial complaint, verbatim; what was actually known/observable at intake.
- Brand/model/serial and identity evidence; inaccessible/ambiguous state.
- Private photo references; applicable reviewed document/version/hash/page references.
- Technician-defined critical facts, declared before seeing model output.
- Known applicable fact values; separately, unavailable/unknown facts.
- Withheld outcome in a separate file: confirmed issue, evidence, uncertainty, reviewer.

Runtime input JSON (the comparison runner strips all other properties):

```json
{"kind":"synthetic","images":[],"input":{"tenantId":"tnt_demo_phoenix","caseId":"synthetic-washer-1","facts":[{"id":"f1","key":"problem_description","value":"Washer stopped with standing water"}],"chunks":[],"knowledgeLevel":"unknown"}}
```

Blinded grading record per A/B output:

```json
{"runId":"...","label":"A","grade":"useful_as_received","missingFacts":[],"unsupportedAssertions":[],"identificationCorrect":null,"documentationApplies":null,"reviewSeconds":null,"timingMethod":"not_recorded","followupQuestions":null,"approvedBrief":null}
```

Other grades: `useful_after_corrections`, `needed_followup`, `misleading_or_unusable`.
Timing method: `manual`, `measured`, `estimated`, `not_recorded`. Pause timing for
interruptions. Unknown values remain null; never count them as zero.

For report export, add `kind`, `knownCriticalFactsExpected`,
`knownCriticalFactsCaptured`, and `unavailableFacts` to each grade (null counts
when unmeasured). Run `node scripts/grade-comparison.mjs data/grades.json`.
The report preserves per-case rows and separate real/synthetic grade counts;
it does not infer business improvements from grades.
