# Documentation validator acceptance

Date: 2026-09-14. Status: accepted against [order revision 1](order.md).

GPT-5.6 Luna medium implemented the checker and fixture tests. Astra reviewed the implementation, issued two repair rounds, and independently reran verification after Luna froze the files. The first review found discovery omissions, overbroad third-party frontmatter checks, insufficient reverse-link validation and unsafe diagnostic paths. The second found a remaining Windows path failure and brittle fixture assertions. Both rounds are resolved in the accepted files.

| Acceptance | Evidence |
| --- | --- |
| AC01: maintained links and anchors | Checker passes from the workspace parent with `python recruitment_website\scripts\check_agent_docs.py`; fixtures cover missing links/anchors, nested workflow discovery, fenced examples and outside-root diagnostics. |
| AC02: custom skill metadata | Scoped flat-frontmatter validation and positive/negative fixtures pass. Third-party skills are excluded. |
| AC03: graph integrity | Complete seven-node fixture passes; duplicate/missing F00–F27 ownership, missing reverse edges and wrong-path/non-impact backlinks are rejected. |
| AC04: meaningful fixture tests | Astra independently ran `python -m unittest discover -s tests/tooling -p test_agent_docs.py -v` from the app checkout: exit 0, 10 tests passed. |
| AC05: frozen handoff | Independent SHA-256 checks match Luna's frozen code/test hashes below. |

## Accepted source identity

| File | SHA-256 |
| --- | --- |
| `scripts/check_agent_docs.py` | `706C7C8C4C8860F012B5BD15773D145E8A07890198610B0E3550291D43499622` |
| `tests/tooling/test_agent_docs.py` | `0D95DDD41CC20779ED60D58612C53431EACEA1E8272BFAF7DE08408C75D08F69` |

See the [implementation summary](implementation.md). Fixture execution required approved local sandbox escalation because default sandbox access prevented temporary-directory operations.

## Verification limits

This is an exercised documentation-tooling delivery loop, not an application feature or browser end-to-end test. It changed no application runtime behavior and accessed no external services. The checker handles its documented Markdown/link/heading and flat-frontmatter subsets, not arbitrary Markdown or YAML. It excludes historical documents and work-item reports. Passing proves checked graph/link invariants, not the semantic accuracy of every document or UI accessibility.
