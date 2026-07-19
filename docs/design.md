# ATS Design System

> Design specification for the current internal Applicant Tracking System dashboard concept.

## 1. Document purpose

This document defines the visual language, interface rules, component behavior, and implementation guidance for the internal ATS. It should be treated as the shared source of truth for product, design, and engineering decisions.

The design system is intentionally simple: a Swiss-inspired grid, a mostly monochromatic blue palette, restrained decoration, clear hierarchy, generous whitespace, and friendly 2D illustrations that communicate the big picture without adding visual noise.

---

## 2. Product experience goal

The ATS should help recruiters understand the health of the hiring pipeline within a few seconds, then move into detailed work only when needed.

The interface should feel:

- Clear before clever
- Professional but not corporate-heavy
- Playful without becoming childish
- Calm, spacious, and easy to scan
- Data-informed without feeling like a dense analytics tool
- Consistent across dashboard, jobs, candidates, interviews, and reports

The dashboard is an overview, not a data dump. Each section should answer one important question.

---

## 3. Core design principles

### 3.1 Big picture first

Show the most important hiring signals before operational detail. Prefer summarized stages, totals, progress, and exceptions over large tables or long lists.

### 3.2 One dominant color

Use Primary Blue as the main brand and interaction color. Build variety through tint, opacity, scale, spacing, and illustration rather than adding unrelated colors.

### 3.3 Swiss structure, soft execution

Use strict alignment, simple geometry, and consistent spacing. Balance this structure with rounded corners, soft blue gradients, and approachable illustrations.

### 3.4 Progressive disclosure

Keep the default interface simple. Secondary actions, advanced filters, full tables, and historical detail should appear only after a user chooses to explore.

### 3.5 Purposeful decoration

Illustrations, waves, grain, and abstract shapes must support orientation or mood. They must not compete with metrics, labels, or primary actions.

### 3.6 Consistency over novelty

A repeated pattern should behave and look the same everywhere. New visual treatments should only be introduced when an existing pattern cannot solve the problem.

---

## 4. Information architecture

### Primary navigation

1. Dashboard
2. Jobs
3. Candidates
4. Pipeline
5. Interviews
6. Calendar
7. Messages
8. Reports
9. Settings

### Dashboard hierarchy

1. Global search and user controls
2. Greeting and dashboard context
3. Key hiring metrics
4. Candidate pipeline overview
5. Open jobs overview
6. Interview summary
7. Hiring trend summary

The dashboard should remain summary-oriented. Candidate-level detail belongs in Pipeline or Candidates. Requisition detail belongs in Jobs.

---

## 5. Layout system

### 5.1 Desktop canvas

- Target viewport: 1440-1680 px wide
- Minimum supported desktop width: 1024 px
- Main content maximum width: fluid within the viewport
- Sidebar width: 224-240 px
- Top bar height: 64-72 px
- Main page padding: 32 px
- Section gap: 24 px
- Card gap: 16 px

### 5.2 Grid

Use a 12-column grid in the main content area.

Recommended dashboard allocation:

- KPI row: equal-width cards across the available space
- Candidate Pipeline: 7-8 columns
- Open Jobs: 4-5 columns
- Interview Summary: 5 columns
- Hiring Trends: 7 columns

All major elements must align to the same grid lines. Avoid isolated widths that do not align with surrounding content.

### 5.3 Responsive behavior

#### Large desktop, 1440 px and above

- Sidebar remains expanded
- KPI cards display in one row
- Pipeline and Jobs appear side by side
- Interview Summary and Hiring Trends appear side by side

#### Small desktop and tablet, 768-1439 px

- Sidebar may collapse to icons
- KPI cards wrap into two rows
- Pipeline and Jobs stack vertically
- Lower sections stack vertically

#### Mobile, below 768 px

- Replace the permanent sidebar with a drawer
- Use one-column content
- Keep only 2-3 highest-priority KPI cards visible initially
- Convert wide pipeline visuals into a vertical stage list
- Keep illustrations small or hide them when they reduce usable space

---

## 6. Color system

The interface uses one primary blue family plus neutral colors. Additional semantic colors should be introduced only when required for warnings, errors, or success states.

### 6.1 Primary blue scale

| Token | Value | Use |
|---|---:|---|
| `blue-950` | `#06133F` | High-contrast headings on light blue surfaces |
| `blue-900` | `#071B61` | Deep sidebar details, dark blue illustration areas |
| `blue-800` | `#082A9E` | Hovered dark surfaces |
| `blue-700` | `#0A3CDC` | Primary brand color, buttons, active navigation, key icons |
| `blue-600` | `#146EFA` | Interactive highlight, charts, focused states |
| `blue-500` | `#3B82F6` | Secondary blue emphasis |
| `blue-300` | `#93B9FF` | Illustration and chart support |
| `blue-200` | `#C4D8FF` | Borders, inactive progress, decorative shapes |
| `blue-100` | `#E8F0FF` | Selected rows, soft panels, tinted cards |
| `blue-50` | `#F4F7FF` | Large background regions |

### 6.2 Neutral scale

| Token | Value | Use |
|---|---:|---|
| `navy-950` | `#0B132B` | Primary text |
| `navy-700` | `#24324A` | Secondary headings |
| `slate-600` | `#5B6780` | Supporting text |
| `slate-400` | `#98A3B8` | Placeholder and disabled labels |
| `gray-200` | `#E4E9F2` | Borders and dividers |
| `gray-100` | `#F1F5F9` | Disabled and muted backgrounds |
| `off-white` | `#FAFAFC` | App background |
| `white` | `#FFFFFF` | Cards and primary surfaces |

### 6.3 Color usage ratio

- 65-75% white and off-white
- 15-20% neutral text and borders
- 10-15% primary blue and blue tints
- Less than 3% semantic status colors when required

### 6.4 Gradients

Gradients should remain within the blue family.

```css
--gradient-primary: linear-gradient(135deg, #0A3CDC 0%, #146EFA 100%);
--gradient-soft: linear-gradient(135deg, #E8F0FF 0%, #FFFFFF 100%);
--gradient-illustration: linear-gradient(135deg, #93B9FF 0%, #0A3CDC 100%);
```

Do not apply gradients to every card. Use them mainly for the sidebar, hero illustration, small promotional modules, and selected high-emphasis actions.

---

## 7. Typography

### 7.1 Font family

Use `Inter`, with the following fallback:

```css
font-family: Inter, "Helvetica Neue", Arial, sans-serif;
```

This supports the Swiss-inspired structure while remaining modern and highly readable.

### 7.2 Type scale

| Style | Size / Line height | Weight | Use |
|---|---|---:|---|
| Display | 32 / 40 px | 600 | Page greeting or primary dashboard title |
| H1 | 28 / 36 px | 600 | Primary page title |
| H2 | 20 / 28 px | 600 | Major dashboard sections |
| H3 | 16 / 24 px | 600 | Card and component titles |
| Body | 16 / 24 px | 400 | Main content and controls |
| Body Small | 14 / 20 px | 400 | Supporting content, table cells |
| Caption | 12 / 16 px | 500 | Metadata, labels, timestamps |
| Metric | 28 / 32 px | 600 | KPI values |

### 7.3 Typography rules

- Use sentence case, not title case, for most labels and buttons.
- Use no more than three font weights: 400, 500, and 600.
- Avoid all caps except for very small category labels.
- Never use muted text for critical values or primary actions.
- Keep line lengths between 45 and 75 characters for longer content.

---

## 8. Spacing and sizing

Use a 4 px base unit.

| Token | Value |
|---|---:|
| `space-1` | 4 px |
| `space-2` | 8 px |
| `space-3` | 12 px |
| `space-4` | 16 px |
| `space-5` | 20 px |
| `space-6` | 24 px |
| `space-8` | 32 px |
| `space-10` | 40 px |
| `space-12` | 48 px |

Recommended component padding:

- Compact control: 8 x 12 px
- Standard control: 10 x 16 px
- KPI card: 20-24 px
- Large dashboard panel: 24 px
- Page section: 24-32 px

---

## 9. Shape, border, and elevation

### 9.1 Radius

| Token | Value | Use |
|---|---:|---|
| `radius-sm` | 8 px | Chips, compact controls |
| `radius-md` | 12 px | Inputs, buttons, list items |
| `radius-lg` | 16 px | Cards and dashboard panels |
| `radius-xl` | 24 px | Hero illustration container only |
| `radius-round` | 999 px | Avatars, circular icons, pills |

### 9.2 Borders

- Default: 1 px solid `gray-200`
- Focus: 2 px solid `blue-600`
- Selected: 1 px solid `blue-300`
- Avoid dark outlines on large white cards

### 9.3 Elevation

Use elevation sparingly. Structure should come primarily from spacing, borders, and background contrast.

```css
--shadow-sm: 0 2px 8px rgba(11, 19, 43, 0.05);
--shadow-md: 0 8px 24px rgba(11, 19, 43, 0.08);
```

- Standard cards: no shadow or `shadow-sm`
- Floating menus: `shadow-md`
- Do not use glow effects

---

## 10. Iconography

### Style

- Simple 2D line or solid icons
- Rounded stroke endings
- Consistent stroke width
- Use blue on white or white on blue
- Avoid multicolor icons

### Sizes

- Inline icon: 16 px
- Navigation icon: 20 px
- Card icon: 24 px
- KPI icon container: 48-56 px

Icons must not carry meaning through color alone. Pair important icons with text labels.

---

## 11. Illustration system

The illustration style should provide warmth and personality without adding operational detail.

### Visual characteristics

- Simple 2D cartoon characters
- Solid shapes with one soft blue gradient
- Minimal facial detail
- Rounded anatomy and objects
- Large, simple compositions
- Blue monochrome or duotone rendering
- Light grain texture at low opacity
- No complex scenes, detailed backgrounds, or photorealism

### Approved illustration uses

- Dashboard greeting
- Interview summary
- Empty states
- Onboarding and guidance
- Success confirmation
- Small educational callouts

### Illustration ratio

Illustrations should occupy no more than 20-30% of a functional panel. They should never reduce the readability of metrics or controls.

### Grain texture

Use grain only as a subtle overlay on decorative regions.

```css
opacity: 0.03-0.06;
mix-blend-mode: multiply;
```

Do not apply grain over text, tables, or data visualizations.

---

## 12. Component specifications

## 12.1 Sidebar

### Purpose

Provides persistent access to the ATS's main modules.

### Visual design

- Background: `gradient-primary` or solid `blue-700`
- Width: 224-240 px
- Horizontal padding: 16 px
- Item height: 44-48 px
- Item radius: 12 px
- Default icon and label: white at approximately 85% opacity
- Active item: white surface with `blue-950` label and `blue-700` icon
- Hover: translucent white background
- Badge: light blue pill with high-contrast text

### Behavior

- Keep Dashboard selected in the current concept.
- Collapse to an icon rail on smaller desktop widths.
- Show tooltip labels in collapsed mode.

---

## 12.2 Top bar

### Contents

- Global search
- Notification button
- User avatar and role
- Optional help entry

### Search

- Width: 480-560 px on large desktop
- Height: 44 px
- Radius: 12 px
- Placeholder: “Search candidates, jobs, or keywords…”
- Shortcut hint may appear at the trailing edge
- Focus state: blue border plus visible focus ring

---

## 12.3 Dashboard hero

### Contents

- Greeting title
- One-line explanatory subtitle
- Small supportive illustration on the right

### Rules

- Keep the message within two lines.
- Do not place operational buttons inside the illustration.
- Use a soft blue wave or shape behind the illustration to separate it from the white background.
- The illustration may be hidden at smaller widths.

Recommended copy:

- Title: `Welcome back, Olivia!`
- Subtitle: `Here’s your talent pipeline overview.`

---

## 12.4 KPI cards

### Purpose

Show the most important ATS signals at a glance.

### Current metrics

1. Open Roles
2. New Applicants
3. Interviews This Week
4. Offer Acceptance
5. Hiring Progress

### Anatomy

- Icon container
- Short label
- Large value
- Optional trend or progress indicator

### Rules

- Maximum of five KPI cards in the default desktop row.
- Keep labels to one line.
- Show no more than one supporting comparison.
- Use blue for all positive/neutral trends in the current monochromatic system.
- Reserve green or red only for genuine semantic success or risk states.
- Do not use decorative charts inside every KPI card.

---

## 12.5 Candidate pipeline overview

### Purpose

Show where candidates are distributed across the hiring journey.

### Current stages

`Applied → Screening → Interview → Offer → Hired`

### Visual treatment

- Display each stage as a label, count, and simple icon.
- Use a single blue line or soft area curve to connect the stages.
- Use arrows or spacing to reinforce sequence.
- Keep candidate-level cards out of the overview.

### Interaction

- Hover or focus reveals stage conversion rate and average time in stage.
- Selecting a stage opens the Pipeline page with the relevant filter applied.
- Keyboard users must be able to reach each stage.

---

## 12.6 Open jobs overview

### Purpose

Show the highest-priority active requisitions.

### Row anatomy

- Job icon
- Job title
- Location or work mode
- Applicant count
- Optional status badge

### Rules

- Show only three to five jobs.
- Sort by priority, aging, or activity rather than alphabetically.
- Use one clear `View all jobs` action.
- Keep row height at least 56 px.

---

## 12.7 Interview summary

### Purpose

Communicate interview workload without showing a detailed schedule.

### Current treatment

- Large weekly interview count
- Short supporting statement
- Simple illustration of an interview conversation

### Rules

- Do not repeat detailed interview rows on the dashboard.
- Selecting the panel should open the Interviews page or calendar view.

---

## 12.8 Hiring trends

### Purpose

Show the direction of hiring activity over the selected period.

### Visual treatment

- One blue line series
- Light blue area fill
- Minimal grid lines
- Direct label on the latest point
- Period selector in the panel header

### Rules

- Use one primary series on the dashboard.
- Do not add multiple competing colors.
- Keep axis labels sparse.
- Provide an accessible text summary of the trend.

---

## 12.9 Buttons

### Primary

- Background: `blue-700`
- Text: white
- Hover: `blue-800`
- Height: 40-44 px
- Radius: 12 px

### Secondary

- Background: `blue-100`
- Text: `blue-700`
- Border: optional `blue-200`

### Tertiary

- Transparent background
- Text: `blue-700`
- Use for `View all`, `Learn more`, and navigation links

Buttons should use verb-first labels such as `Create job`, `Schedule interview`, or `View pipeline`.

---

## 12.10 Inputs and filters

- Height: 40-44 px
- Radius: 12 px
- Border: `gray-200`
- Focus: blue border and focus ring
- Labels appear above inputs when the meaning is not obvious
- Placeholder text must not replace a required label
- Filters should show active state clearly and support reset

---

## 13. Motion and interaction

Motion should be subtle, low velocity, and functional.

### Timing

| Token | Duration | Use |
|---|---:|---|
| `motion-fast` | 140 ms | Hover, icon feedback |
| `motion-standard` | 220 ms | Buttons, card emphasis, navigation |
| `motion-slow` | 360-480 ms | Illustration drift, panel entrance |

### Easing

```css
--ease-standard: cubic-bezier(0.2, 0, 0, 1);
--ease-gentle: cubic-bezier(0.22, 1, 0.36, 1);
```

### Approved motion

- Navigation highlight fades or slides gently
- Cards lift by no more than 2 px on hover
- Pipeline points expand slightly on focus or hover
- Illustration shapes drift 2-4 px over 6-10 seconds
- Charts draw once when entering the viewport
- Loading states use soft pulse or skeletons

### Prohibited motion

- Fast bouncing
- Continuous spinning
- Strong parallax
- Large-scale zoom
- Repeated attention-seeking loops

Respect `prefers-reduced-motion` and remove non-essential animation when enabled.

---

## 14. Content design

### Voice

- Friendly
- Direct
- Helpful
- Calm
- Professional

### Writing rules

- Use concise sentences.
- Prefer familiar hiring terminology.
- Avoid internal system jargon unless recruiters already use it.
- Use active voice.
- State the next action clearly in empty and error states.

Examples:

- Good: `No interviews scheduled this week.`
- Better with action: `No interviews scheduled this week. Review candidates ready for interview.`
- Avoid: `There are currently no records available in the selected interview time period.`

---

## 15. Accessibility

The system should meet WCAG 2.1 AA as a minimum.

### Requirements

- Normal text contrast: at least 4.5:1
- Large text contrast: at least 3:1
- Interactive component contrast: at least 3:1
- Minimum touch target: 44 x 44 px where practical
- Visible focus indicator for every interactive element
- Full keyboard navigation
- Semantic headings and landmarks
- Icons paired with text or accessible labels
- Charts include text summaries and tooltips accessible by keyboard
- Do not rely on color alone for status
- Illustrations use empty alt text when decorative and concise alt text when informative

White text on `#0A3CDC` is approved for primary actions and sidebar navigation.

---

## 16. Empty, loading, error, and success states

### Empty state

Use:

- One simple blue illustration
- Short explanation
- One primary action
- Optional secondary guidance link

### Loading state

Use skeleton blocks that match the final layout. Avoid full-screen spinners for page-level data.

### Error state

Explain what failed, preserve the user's work, and provide a clear retry action.

### Success state

Use concise confirmation and keep the user in context. Avoid large celebratory animations for routine actions.

---

## 17. Data-density rules

The dashboard should remain intentionally light.

- Maximum five KPI cards above the fold
- Maximum five visible jobs in the overview
- Maximum one chart series in the default dashboard trend panel
- Maximum five pipeline stages in the overview
- Avoid tables on the dashboard unless they answer a critical operational question
- Move candidate-level detail to dedicated pages
- Prefer counts, progress, and exceptions over raw activity logs

---

## 18. Design tokens example

```css
:root {
  --color-primary-950: #06133F;
  --color-primary-900: #071B61;
  --color-primary-800: #082A9E;
  --color-primary-700: #0A3CDC;
  --color-primary-600: #146EFA;
  --color-primary-300: #93B9FF;
  --color-primary-200: #C4D8FF;
  --color-primary-100: #E8F0FF;
  --color-primary-50: #F4F7FF;

  --color-text-primary: #0B132B;
  --color-text-secondary: #5B6780;
  --color-border: #E4E9F2;
  --color-surface-muted: #F1F5F9;
  --color-background: #FAFAFC;
  --color-surface: #FFFFFF;

  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 24px;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;

  --shadow-sm: 0 2px 8px rgba(11, 19, 43, 0.05);
  --shadow-md: 0 8px 24px rgba(11, 19, 43, 0.08);

  --motion-fast: 140ms;
  --motion-standard: 220ms;
  --motion-slow: 420ms;
  --ease-standard: cubic-bezier(0.2, 0, 0, 1);
  --ease-gentle: cubic-bezier(0.22, 1, 0.36, 1);
}
```

---

## 19. Component naming convention

Use clear product-oriented names.

Recommended examples:

- `AppSidebar`
- `GlobalSearch`
- `UserMenu`
- `DashboardHero`
- `MetricCard`
- `PipelineOverview`
- `PipelineStage`
- `OpenJobsPanel`
- `JobSummaryRow`
- `InterviewSummary`
- `HiringTrendChart`
- `EmptyState`
- `StatusBadge`

Avoid names based only on appearance such as `BlueCard`, `BigBox`, or `LeftPanel`.

---

## 20. Design QA checklist

Before a screen is approved, confirm that:

- The primary task is obvious within five seconds.
- The screen uses the 4 px spacing system.
- Major sections align to the grid.
- Primary Blue is the only dominant accent color.
- Typography uses the approved scale and weights.
- Cards are not nested unnecessarily.
- The dashboard shows summaries rather than detailed records.
- Every interactive state includes hover, focus, active, disabled, and loading behavior.
- Color contrast meets WCAG AA.
- Keyboard navigation is complete.
- Motion respects reduced-motion preferences.
- Empty, loading, error, and success states are designed.
- Illustrations remain simple, monochromatic, and secondary to content.
- Responsive behavior is defined before implementation.

---

## 21. Current-demo direction summary

The current ATS demo should be implemented as a spacious, blue-led dashboard with a strong left navigation rail, global search, friendly greeting, five high-level recruiting metrics, a simplified candidate pipeline, a short open-jobs list, an interview summary illustration, and one hiring trend chart.

The overall visual balance should come from:

- Strict alignment and grid structure
- Large white surfaces
- Deep blue navigation
- Light blue content accents
- Minimal card decoration
- Simple 2D blue illustrations
- Restrained grain texture
- Slow, low-amplitude motion
- Summary-first information design

This direction should remain consistent as the ATS expands into Jobs, Candidates, Pipeline, Interviews, Calendar, Messages, Reports, and Settings.

---

## 22. GFPT recruitment implementation note

The live GFPT recruitment website adapts this ATS design system to the existing internal operations product. This document owns visual language, spacing, typography, surface hierarchy, focus treatment, and component behavior. `docs/WEBSITE_STRUCTURE.md` remains the source of truth for routes, recruitment workflows, permissions, Supabase behavior, Dashboard waterfall calculations, and Thai/English language rules.

Implementation mapping:

- App shell keeps the existing GFPT navigation order: Home, Workspace, Records, Dashboard, Audit Log.
- The sidebar uses the blue-led ATS rail treatment, with active route surfaces in white and assigned-site accent applied only to selected icons, focus, primary actions, tabs, and filter states.
- Home remains the recruiter operations landing page: Today's Work is dominant, one metric strip follows, and Recruitment Records is the single tabbed work surface.
- Dashboard remains the Vacancy Waterfall reporting surface. The ATS system applies to the report header, control layout, export buttons, and secondary reveal panels, but chart colors, connectors, print CSS, and calculations stay unchanged.
- Workspace is the hiring-case command surface. The selected group/requisition context stays sticky, with compact section tabs and one dominant embedded work area.
- Requisitions, Candidates, and Offers use shared sticky desktop table viewports and neutral mobile cards.
- Pipeline keeps the horizontal process board. Stage columns and cards are neutral-first; red is reserved for aging or failed risk states.

Do not treat the demo information architecture in section 4 as a replacement for the GFPT route map unless a product change explicitly requests it.
