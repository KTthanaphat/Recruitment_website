#!/usr/bin/env python3
"""Validate the active recruitment documentation graph.

This intentionally supports a small, predictable subset of Markdown and YAML:
local Markdown links, ATX headings, and flat ``name``/``description`` skill
frontmatter with scalar values.  It is a maintenance check, not a full parser.
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable
from urllib.parse import urldefrag, urlparse


ROOT = Path(__file__).resolve().parents[1]
FEATURE_RE = re.compile(r"^###\s+(F(?:0[0-9]|1[0-9]|2[0-7])):\s+", re.MULTILINE)
LINK_RE = re.compile(r"!?\[[^\]]*\]\(([^)]+)\)")
EDGE_RE = re.compile(
    r"^\|\s*`(?P<kind>[A-Za-z][A-Za-z -]*)`\s*\|\s*\[(?P<label>[^]]+)\]\((?P<target>[^)]+)\)\s*\|",
    re.MULTILINE,
)
HEADING_RE = re.compile(r"^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$", re.MULTILINE)


@dataclass(frozen=True)
class Issue:
    path: Path
    line: int | None
    message: str

    def __str__(self) -> str:
        location = f":{self.line}" if self.line else ""
        return f"{self.path}{location}: {self.message}"


def _without_fences(text: str) -> str:
    lines = text.splitlines(keepends=True)
    inside = False
    result: list[str] = []
    for line in lines:
        if re.match(r"^\s*(```|~~~)", line):
            inside = not inside
            result.append("\n" if line.endswith("\n") else "")
        elif inside:
            result.append("\n" if line.endswith("\n") else "")
        else:
            result.append(line)
    return "".join(result)


def _line_number(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def _display_path(path: Path, root: Path) -> str:
    try:
        return str(path.relative_to(root))
    except ValueError:
        return str(path)


def _slug(value: str) -> str:
    value = re.sub(r"<[^>]*>", "", value)
    value = value.lower().strip()
    value = re.sub(r"[^\w\s-]", "", value)
    return re.sub(r"[\s-]+", "-", value).strip("-")


def _is_external(target: str) -> bool:
    parsed = urlparse(target)
    return bool(parsed.scheme or parsed.netloc) or target.startswith("//")


def maintained_markdown(root: Path) -> list[Path]:
    """Return active routing/design/workflow Markdown in stable order."""
    candidates = [
        root / "AGENTS.md",
        root.parent / "AGENTS.md",
        root / "docs" / "FEATURE_FILE_MAP.md",
        root / "docs" / "design.md",
        root / "docs" / "AI_HANDOVER.md",
        *sorted((root / "docs" / "maps").rglob("*.md")),
        *sorted((root / "docs" / "design").rglob("*.md")),
        *sorted((root / "docs" / "workflows").rglob("*.md")),
    ]
    return [p for p in candidates if p.is_file() and "archive" not in p.parts and "work-items" not in p.parts]


def active_skills(root: Path) -> list[Path]:
    skills_root = root.parent / ".agents" / "skills"
    if not skills_root.is_dir():
        return []
    return sorted(path / "SKILL.md" for path in skills_root.iterdir() if path.is_dir() and (path / "SKILL.md").is_file())


CONSTRAINED_SKILLS = {"internal-ops-ui", "feature-delivery-loop", "full-output-enforcement"}


def constrained_skills(root: Path) -> list[Path]:
    return [path for path in active_skills(root) if path.parent.name in CONSTRAINED_SKILLS]


def check_links(paths: Iterable[Path], root: Path) -> list[Issue]:
    issues: list[Issue] = []
    for path in paths:
        text = path.read_text(encoding="utf-8")
        active = _without_fences(text)
        headings = {_slug(match.group(1)) for match in HEADING_RE.finditer(active)}
        for match in LINK_RE.finditer(active):
            raw = match.group(1).strip().strip("<>")
            target, anchor = urldefrag(raw)
            if not target and not anchor:
                continue
            if _is_external(target):
                continue
            destination = (path.parent / target).resolve() if target else path.resolve()
            if not destination.is_file():
                issues.append(Issue(path, _line_number(active, match.start()), f"missing local link target {raw!r}"))
                continue
            if anchor and destination.suffix.lower() == ".md":
                target_text = _without_fences(destination.read_text(encoding="utf-8"))
                target_headings = {_slug(item.group(1)) for item in HEADING_RE.finditer(target_text)}
                if anchor.lower() not in target_headings:
                    issues.append(Issue(path, _line_number(active, match.start()), f"missing anchor {anchor!r} in {_display_path(destination, root)}"))
    return issues


def check_skill_frontmatter(paths: Iterable[Path], root: Path) -> list[Issue]:
    issues: list[Issue] = []
    for path in paths:
        lines = path.read_text(encoding="utf-8").splitlines()
        if not lines or lines[0].strip() != "---":
            issues.append(Issue(path, 1, "skill frontmatter must start with ---"))
            continue
        try:
            end = next(index for index, line in enumerate(lines[1:], 1) if line.strip() == "---")
        except StopIteration:
            issues.append(Issue(path, 1, "unterminated skill frontmatter"))
            continue
        fields: dict[str, str] = {}
        for index, line in enumerate(lines[1:end], 2):
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            if not re.match(r"(?:name|description):", line):
                # Other frontmatter keys (including nested metadata) are outside
                # this deliberately small parser and are left to their owner.
                continue
            match = re.fullmatch(r"(name|description):\s*([^:#][^\n]*)", line)
            if not match or match.group(2).strip().startswith(("[", "{", "|", ">")):
                issues.append(Issue(path, index, "unsupported skill frontmatter; use plain scalar name/description"))
                continue
            key = match.group(1)
            if key in fields:
                issues.append(Issue(path, index, f"duplicate skill frontmatter key {key!r}"))
            fields[key] = match.group(2).strip().strip('"\'')
        expected = path.parent.name
        if fields.get("name") != expected:
            issues.append(Issue(path, 2, f"skill name must match folder {expected!r}"))
        description = fields.get("description", "")
        if not description:
            issues.append(Issue(path, 2, "skill description must be nonempty"))
        elif len(description) > 300:
            issues.append(Issue(path, 2, "skill description must be concise (300 characters or fewer)"))
    return issues


def check_graph(root: Path) -> list[Issue]:
    system_root = root / "docs" / "maps" / "system"
    nodes = sorted(system_root.glob("*.md"))
    issues: list[Issue] = []
    feature_locations: dict[str, list[Path]] = {}
    for path in nodes:
        text = _without_fences(path.read_text(encoding="utf-8"))
        for match in FEATURE_RE.finditer(text):
            feature_locations.setdefault(match.group(1), []).append(path)
    for number in range(28):
        feature = f"F{number:02d}"
        locations = feature_locations.get(feature, [])
        if len(locations) != 1:
            where = ", ".join(str(p.relative_to(root)) for p in locations) or "none"
            issues.append(Issue(system_root, None, f"{feature} must appear exactly once in system nodes (found {len(locations)}: {where})"))

    expected_nodes = {"home", "workspace", "records", "pipeline", "reporting", "platform", "integrations"}
    actual_nodes = {path.stem for path in nodes}
    for missing in sorted(expected_nodes - actual_nodes):
        issues.append(Issue(system_root, None, f"required system node missing: {missing}.md"))
    for extra in sorted(actual_nodes - expected_nodes):
        issues.append(Issue(system_root / f"{extra}.md", None, "unexpected system node; graph must contain the seven named system nodes"))
    for path in nodes:
        text = _without_fences(path.read_text(encoding="utf-8"))
        for match in EDGE_RE.finditer(text):
            target_ref = match.group("target").split("#", 1)[0]
            target = (path.parent / target_ref).resolve()
            if not target.is_file():
                issues.append(Issue(path, _line_number(text, match.start()), f"dependency target missing: {target_ref!r}"))
                continue
            source_name = f"SYS-{path.stem.upper()}"
            target_text = _without_fences(target.read_text(encoding="utf-8"))
            impact = re.search(r"^##+\s+Impact back-links\s*$", target_text, re.IGNORECASE | re.MULTILINE)
            impact_text = target_text[impact.end():] if impact else ""
            next_heading = re.search(r"^##+\s+", impact_text, re.MULTILINE)
            if next_heading:
                impact_text = impact_text[:next_heading.start()]
            backlink_found = False
            for backlink in LINK_RE.finditer(impact_text):
                href = backlink.group(1).strip().strip("<>")
                href_target, _ = urldefrag(href)
                resolved = (target.parent / href_target).resolve() if href_target else target.resolve()
                if backlink.group(0).startswith(f"[{source_name}]") and resolved == path.resolve():
                    backlink_found = True
                    break
            if not backlink_found:
                safe_target = str(target.relative_to(root)) if target.is_relative_to(root) else str(target)
                issues.append(Issue(path, _line_number(text, match.start()), f"edge {source_name} -> SYS-{target.stem.upper()} lacks exact impact back-link to {path.name} in {safe_target}"))
    return issues


def validate(root: Path = ROOT) -> list[Issue]:
    root = root.resolve()
    markdown = maintained_markdown(root)
    custom_skills = constrained_skills(root)
    return [*check_links(markdown + custom_skills, root), *check_skill_frontmatter(custom_skills, root), *check_graph(root)]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT, help="recruitment_website root (defaults from script location)")
    args = parser.parse_args(argv)
    issues = validate(args.root)
    if issues:
        for issue in issues:
            print(issue, file=sys.stderr)
        print(f"documentation check failed: {len(issues)} issue(s)", file=sys.stderr)
        return 1
    print("documentation check passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
