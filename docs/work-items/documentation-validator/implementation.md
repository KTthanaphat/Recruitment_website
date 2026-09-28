# Documentation validator implementation

Implemented `scripts/check_agent_docs.py` with standard-library-only checks for active routing, design and workflow Markdown (including app/workspace AGENTS files, AI handover and nested role contracts), local links and heading anchors, fenced-example exclusion, three maintained custom-skill frontmatters, F00–F27 uniqueness, seven named system nodes, dependency targets and exact reverse impact links. Third-party/resource-style skill frontmatter is deliberately excluded. Added temporary-fixture tests in `tests/tooling/test_agent_docs.py` covering valid input, missing links/anchors, ignored fences, frontmatter, duplicate/missing feature IDs, missing reverse edges, nested discovery and CLI exit status.

Validation evidence and source hashes are recorded in the handoff message. The checker supports only the documented flat skill frontmatter subset and GitHub-style ATX heading anchors; it does not parse arbitrary YAML or Markdown extensions.
