# Visual foundations

Use for new treatments or shared hierarchy/theme changes. A focused edit can start directly in its component contract.

## Hierarchy

Assign an information role before styling. Size establishes reading order; weight distinguishes values from labels; spacing groups related content. Color reinforces action or state rather than compensating for weak hierarchy.

| Role | Current baseline | Treatment |
| --- | --- | --- |
| Home greeting | 16px phone, 24px sm, 30px lg; 600 | Navy over the banner's quiet left area |
| Candidate identity | 20px / 600 | Navy; long name/ID wraps; status stays smaller |
| Candidate section heading | 18px / 600 | Navy with small accent icon |
| Summary value | 18px compact, 20px regular / 600 | Tabular digits, right-aligned in stacked rows |
| Record/profile value | 14px / 600 | Navy; contact/record values can wrap |
| Input / command-selector value | 14px / 400 input, 600 selector | Dark readable text |
| Supporting label | 12px / 500; profile label 11px | Slate, subordinate to value |
| Optional helper | 12px / 300–500 | Muted only when nonessential |

These are reference baselines, not a demand to resize every screen. Calendar microtype is a density exception in [Home](home.md). Preserve Prompt and Thai-capable fallbacks from [globals.css](../../src/app/globals.css); avoid Latin-only line-height assumptions. Do not dim critical dates or blocked-action explanations.

## Color roles

Use [site-theme.ts](../../src/lib/site-theme.ts), [Tailwind tokens](../../tailwind.config.ts), and [CSS variables](../../src/app/globals.css).

| Role | Source/treatment |
| --- | --- |
| Main text | `text-navy` / `#0B132B` |
| Secondary | `text-slate` / `#475569`; ATS CSS secondary differs (`#5B6780`), preserve the owning primitive |
| Optional metadata | `text-cool` / `#94A3B8`; check legibility before using for essential information |
| Canvas / surface | Off-white `#FAFAFC`, white, pale neutral `#F8FAFD` |
| Boundaries | Existing `#D7DEE8`, `#E4E9F2`, `#C9D5E6` by primitive |
| Action / selection / focus | Assigned-profile `primary`: HQ `#0AA0C3`, KT1 `#146EFA`, KT2 `#411EDC`, fallback `#0A3CDC` |
| Pending / risk / failure | Existing semantic helpers, readable text plus status wording/icon |

The assigned user's site sets the accent; the Site filter does not establish a new brand. Use stronger theme variants when text contrast requires them. White-on-accent is not automatically readable for every site.

Preserve local exceptions: calendar green means confirmed start; candidate soft tags use green success. Do not spread these colors to unrelated summaries or erase them through a blanket blue-success rule. Waterfall has its own chart colors; theme work must not recolor its data series.

## Surfaces and composition

Prefer a work panel with aligned rows and restrained separators. Reuse `Panel`, `.ats-card`, `.ats-card-subtle`, and primitive variants. Avoid a bordered card around each label/value. Current radii vary (date trigger `rounded-md`, selector `rounded-xl`); preserve component identity rather than forcing a global radius rewrite.

Typical working gaps are 8–20px and panel padding 12–20px by density. Try stronger type and spacing before stronger borders/shadows. Reserve substantial elevation for floating controls. The Home illustration is an orientation asset, not decoration to repeat in every panel.

At 360/390px preserve usable targets, wrapping, safe areas and in-viewport overlays. Prefer 44px primary touch targets without inflating desktop calendar micro-controls. Tables and Pipeline may scroll internally; the page should not overflow. Reuse mobile drawer/bottom-sheet primitives. Respect reduced motion.

| Need | Designed component |
| --- | --- |
| Count plus explanation | [Home summary row/card](home.md#summary-cards-and-rows) |
| Dated work with record access | Home calendar event/agenda |
| Person, status and progress | [Candidate detail](candidate-detail.md) |
| Select a value/date | Shared [controls](controls.md) |
| Compare many records | Existing sortable/paginated table, mobile record cards |
| Secondary history/actions | Disclosure or More menu; current action stays visible |

Check hierarchy with long names, Thai labels, missing values, focus and disabled states. Source inspection establishes baseline; rendered review establishes whether a change works.
