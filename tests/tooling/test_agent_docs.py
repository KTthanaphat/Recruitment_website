import importlib.util
import io
import sys
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path


SCRIPT = Path(__file__).parents[2] / "scripts" / "check_agent_docs.py"
SPEC = importlib.util.spec_from_file_location("check_agent_docs", SCRIPT)
CHECKER = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = CHECKER
SPEC.loader.exec_module(CHECKER)


def write(root: Path, relative: str, content: str) -> None:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


class AgentDocsTests(unittest.TestCase):
    def temp_fixture(self):
        return tempfile.TemporaryDirectory()

    def test_valid_links_anchors_and_fenced_examples(self):
        with self.temp_fixture() as temp:
            root = Path(temp)
            write(root, "docs/a.md", "# Target Heading\n")
            write(root, "docs/b.md", "[ok](a.md#target-heading)\n```md\n[ignored](missing.md#nope)\n```\nhttps://example.com\n")
            self.assertEqual(CHECKER.check_links([root / "docs/b.md"], root), [])

    def test_missing_link_and_anchor_report_source(self):
        with self.temp_fixture() as temp:
            root = Path(temp)
            source = root / "docs" / "b.md"
            write(root, "docs/a.md", "# Present\n")
            write(root, "docs/b.md", "[file](a.md)\n[anchor](a.md#absent)\n[missing](gone.md)\n")
            issues = CHECKER.check_links([source], root)
            self.assertEqual(len(issues), 2)
            self.assertTrue(all(issue.path == source for issue in issues))
            self.assertIn("missing anchor", str(issues[0]))

    def test_anchor_outside_root_reports_safe_path(self):
        with self.temp_fixture() as temp:
            root = Path(temp)
            outside = root.parent / f"outside-{root.name}.md"
            try:
                outside.write_text("# Present\n", encoding="utf-8")
                source = root / "docs" / "source.md"
                write(root, "docs/source.md", f"[anchor](../../{outside.name}#absent)\n")
                issues = CHECKER.check_links([source], root)
                self.assertEqual(len(issues), 1)
                self.assertIn("missing anchor", issues[0].message)
                self.assertIn(outside.name, issues[0].message)
            finally:
                outside.unlink(missing_ok=True)

    def test_skill_frontmatter_name_and_description(self):
        with self.temp_fixture() as temp:
            root = Path(temp)
            good = root / ".agents" / "skills" / "alpha" / "SKILL.md"
            write(root, ".agents/skills/alpha/SKILL.md", "---\nname: alpha\ndescription: A concise skill.\n---\n")
            self.assertEqual(CHECKER.check_skill_frontmatter([good], root), [])
            write(root, ".agents/skills/alpha/SKILL.md", "---\nname: wrong\ndescription:\n---\n")
            messages = "\n".join(issue.message for issue in CHECKER.check_skill_frontmatter([good], root))
            self.assertIn("name must match folder", messages)
            self.assertIn("description must be nonempty", messages)

    def test_graph_detects_duplicate_and_missing_feature(self):
        with self.temp_fixture() as temp:
            root = Path(temp)
            system = root / "docs" / "maps" / "system"
            write(root, "docs/maps/system/a.md", "### F00: One\n### F00: Duplicate\n")
            write(root, "docs/maps/system/b.md", "### F01: One\n")
            issues = CHECKER.check_graph(root)
            messages = "\n".join(issue.message for issue in issues)
            self.assertIn("F00 must appear exactly once", messages)
            self.assertIn("F02 must appear exactly once", messages)

    def test_graph_requires_reverse_edge(self):
        with self.temp_fixture() as temp:
            root = Path(temp)
            write(root, "docs/maps/system/a.md", "### F00: One\n\n## Dependency edges\n| Edge | Target | Follow when |\n| --- | --- | --- |\n| `uses` | [SYS-B](b.md) | test |\n")
            write(root, "docs/maps/system/b.md", "### F01: Two\n\n## Impact back-links\n\nNo links here.\n")
            issues = CHECKER.check_graph(root)
            self.assertTrue(any("lacks exact impact back-link" in issue.message for issue in issues))

    def test_graph_rejects_wrong_path_or_non_impact_backlink(self):
        with self.temp_fixture() as temp:
            root = Path(temp)
            write(root, "docs/maps/system/a.md", "### F00: One\n\n## Dependency edges\n| Edge | Target | Follow when |\n| --- | --- | --- |\n| `uses` | [SYS-B](b.md) | test |\n")
            write(root, "docs/maps/system/b.md", "### F01: Two\n\n## Other\n[SYS-A](wrong.md)\n\n## Impact back-links\n[SYS-A](wrong.md)\n")
            issues = CHECKER.check_graph(root)
            self.assertTrue(any("lacks exact impact back-link" in issue.message for issue in issues))

    def test_nested_workflow_is_discovered(self):
        with self.temp_fixture() as temp:
            root = Path(temp)
            nested = root / "docs" / "workflows" / "feature-loop" / "luna.md"
            write(root, "docs/workflows/feature-loop/luna.md", "[missing](gone.md)\n")
            self.assertIn(nested, CHECKER.maintained_markdown(root))

    def test_cli_returns_nonzero_for_invalid_root(self):
        with self.temp_fixture() as temp:
            with redirect_stderr(io.StringIO()):
                self.assertEqual(CHECKER.main(["--root", temp]), 1)

    def test_complete_graph_fixture_is_valid(self):
        with self.temp_fixture() as temp:
            root = Path(temp)
            names = ["home", "workspace", "records", "pipeline", "reporting", "platform", "integrations"]
            ids = iter(range(28))
            for name in names:
                features = []
                for _ in range(4):
                    number = next(ids)
                    features.append(f"### F{number:02d}: Feature\n")
                extra = ""
                if name == "home":
                    extra = "\n## Dependency edges\n| Edge | Target | Follow when |\n| --- | --- | --- |\n| `uses` | [SYS-WORKSPACE](workspace.md) | test |\n"
                if name == "workspace":
                    extra = "\n## Impact back-links\n[SYS-HOME](home.md)\n"
                write(root, f"docs/maps/system/{name}.md", "".join(features) + extra)
            self.assertEqual(CHECKER.check_graph(root), [])


if __name__ == "__main__":
    unittest.main()
