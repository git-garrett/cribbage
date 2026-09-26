# Exclude defunct models from learning data

Accepted 2026-09-25. Model 15.2 and all Model 16.x policies are flawed and
defunct; the project owner also excludes the entire 15.x family from usable
learning evidence. All future asset generation, refreshes, calibration and
training must exclude decisions made by **any 15.x or 16.x model**, including
renamed exports and mixed-model databases. A larger corpus does not justify
reintroducing these policies.

Apply eligibility to the actor producing each observation, using recorded model
identity and provenance. An eligible actor's decision against an excluded
opponent may be retained, with the opponent recorded; the excluded actor's
decision may not. Require identifiable, approved sources; a missing model label
does not establish eligibility. Preserve excluded raw games for historical
reproduction, separately from usable evidence. Existing frozen benchmark inputs
remain immutable; rebuilding a learning asset must audit its inherited evidence
as well as new rows. Reinstating an excluded family requires an explicit decision
superseding this ADR.

The September discard refresh is clean in both its conditional and suited
sections. The separate frozen `model1322-decline-factors.json` still records
15.x as eligible and includes a 13.0-versus-15.2 source; its next learning refresh
must remove those observations. Its builder now excludes those versions and
requires attributable model identities. This decision does not retroactively
certify other historical assets as clean.
