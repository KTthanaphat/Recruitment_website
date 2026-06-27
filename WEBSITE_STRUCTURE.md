# Recruitment Website Structure

> Current cloud prototype documentation lives in `docs/WEBSITE_STRUCTURE.md`.
> The content below is the legacy Python/SQLite reference retained for historical context.

Last updated: 2026-06-15

## Overview

The recruitment website has four main layers:

```text
Browser UI
  -> JavaScript state and interactions
  -> Python API server
  -> SQLite database
```

The browser never reads the database directly. The browser calls API routes in `app.py`, and `app.py` reads/writes `recruitment_tracking.db`.

## Folder Structure

```text
recruitment_website/
  app.py
  schema.sql
  recruitment_tracking.db
  recruitment_tracking.pdf
  DEPLOYMENT.md
  WEBSITE_STRUCTURE.md
  .gitignore
  web/
    index.html
    styles.css
    script.js
```

## File Responsibilities

### `app.py`

Backend server and API layer.

Main responsibilities:

- Starts the local/internal web server.
- Serves files from `web/`.
- Connects to `recruitment_tracking.db`.
- Initializes/migrates the SQLite schema.
- Provides API routes.
- Validates create/change mode.
- Blocks duplicate create operations.
- Auto-generates IDs.
- Stores change/audit logs.
- Updates requisition status automatically when offers fill headcount.

Default port:

```text
8010
```

Environment override:

```powershell
$env:PORT="8011"
python app.py
```

### `schema.sql`

Database schema definition.

Use this file to understand the table structure and rebuild a fresh database.

### `recruitment_tracking.db`

SQLite database containing live recruitment records.

This file is local/private and should not be committed to GitHub.

### `web/index.html`

Frontend structure.

Defines:

- App shell
- Sidebar navigation
- Dashboard page
- Requisition page
- Candidate page
- Pipeline page
- Offers page
- Setup page
- Audit page
- Form dialogs
- Detail dialogs
- Confirmation dialog
- Datalist containers for searchable existing values

### `web/styles.css`

Frontend visual design.

Controls:

- Color palette
- Sidebar layout
- Dashboard cards
- Tables
- Pipeline columns/cards
- Status tags
- Searchable dropdown panels
- Detail drawers
- Form dialogs
- Validation states
- Responsive layout

Current color palette is based on `Color_palette_sheet.png`:

```text
Primary Blue   #0A3CDC
Electric Blue  #146EFA
Deep Navy      #0B132B
Off White      #FAFAFC
Light Gray     #F1F5F9
Emerald Green  #00B894
Energy Orange  #FF8A00
Scarlet        #FF3B30
Amber          #FFC107
```

### `web/script.js`

Frontend behavior and state management.

Controls:

- Fetching data from `/api/dashboard`
- Rendering dashboard metrics
- Rendering work queue items
- Rendering requisition/candidate/offer/audit tables
- Rendering pipeline columns and cards
- Searchable existing-value dropdown behavior
- Form submission and confirmation
- New/change mode behavior
- Drag/drop pipeline process update
- Thai/English language switch
- Saved filter preferences
- Requisition detail drawer
- Candidate detail drawer
- Required-field validation feedback

## API Routes

### Read API

```text
GET /api/dashboard
```

Returns all data needed by the frontend:

- `requisitions`
- `position_groups`
- `groups`
- `candidates`
- `requisition_logs`
- `recruitment_logs`
- `offers`
- `change_logs`

### Write APIs

```text
POST /api/requisitions
POST /api/requisition-logs
POST /api/groups
POST /api/group-matches
POST /api/candidates
POST /api/recruitment-logs
POST /api/offers
```

## Database Tables

### `requisitions`

Stores hiring requests.

Important fields:

- `doc_id`
- `pr_approved_date`
- `site`
- `position`
- `department`
- `section`
- `level`
- `head_count`
- `person_in_charge`
- `line_manager`
- `status`

Allowed status values:

```text
ongoing
filled
cancel
```

The `filled` status can be set automatically when accepted offers reach `head_count`.

### `requisition_logs`

Stores status history for requisitions.

### `position_groups`

Stores reusable position groups and sourcing channel settings.

`group_id` is auto-generated.

Example:

```text
GRP-0001
```

### `document_groups`

Matches a requisition document ID to a position group.

`doc_group_id` is auto-generated.

Example:

```text
DGRP-0001
```

### `candidates`

Stores candidate master data.

`candidate_id` is auto-generated.

Example:

```text
CAN-0001
```

### `recruitment_logs`

Stores candidate process updates.

Used by:

- Candidate timeline
- Latest process shown in candidate table
- Pipeline column placement
- Drag/drop process update

Process values:

```text
First Contact
Phone Screen
HR Interview
Line Interview
Test
Reference Check
Offer
Rejected
Withdrawn
```

### `offers`

Stores offer details.

Accepted offers affect requisition headcount status.

### `change_logs`

Stores audit history for create/change/auto-status actions.

## Main User Journey

### Dashboard Journey

```text
User opens Dashboard
  -> Reviews KPI cards
  -> Checks Needs Action
  -> Clicks a work item
  -> Opens requisition or candidate detail drawer
  -> Takes action from the detail drawer or navigates to the relevant page
```

Dashboard includes:

- Active requisitions
- Candidate count
- Accepted offers
- Open headcount
- Needs action work queue
- Recent activity
- Pipeline preview

### Requisition Journey

```text
Open Requisitions
  -> Click Doc ID
  -> View requisition detail drawer
  -> Review headcount, candidates, and offers
  -> Edit requisition if needed
```

### Candidate Journey

```text
Open Candidates or Pipeline
  -> Click candidate ID/name/card
  -> View candidate detail drawer
  -> Review profile, timeline, and offer information
  -> Add process update if needed
```

### Pipeline Journey

```text
Open Pipeline
  -> Candidate appears in latest process column
  -> Drag candidate card forward only
  -> Full Process Update dialog opens
  -> User fills all process details
  -> User saves
  -> Confirmation appears
  -> API writes recruitment log
  -> Dashboard reloads
```

Pipeline cards show:

- Candidate status tag
- Candidate name
- Candidate ID and position group
- Site tag
- Person in charge tag
- Last update date

### Offer Journey

```text
Open Offers
  -> Add offer
  -> If accepted_date is set, offer counts toward requisition headcount
  -> If accepted offers >= head_count, requisition status becomes filled
```

## UI Modes

### New Mode

Creates a new record.

Server rejects creation if the key already exists.

### Change Mode

Updates an existing record.

Server rejects change if the record does not exist.

### Thai/English Mode

The top-right language button switches UI text between English and Thai.

Implementation detail:

- UI labels are translated in `web/script.js`.
- Stored database values remain stable, mostly English process/status values.
- The selected language is saved in browser `localStorage`.

## Filters

Global filters:

- Site
- Person in charge

Filters affect:

- Dashboard metrics
- Work queue
- Tables
- Pipeline
- Select options

Filter values are saved in browser `localStorage`.

## Searchable Existing Values

Inputs with a `list` attribute use custom searchable suggestion panels.

Examples:

- Site
- Position
- Department
- Section
- Person in charge
- Line manager
- Candidate channel
- Interviewer
- Offer type

Users can select an existing value or type a new one.

## Change Logging

Backend creates change log records for important changes.

Tracked examples:

- New/change requisition
- New/change candidate
- New/change offer
- New/change position group
- New recruitment process log
- Automatic requisition status update

## Current UX Improvements

Implemented as of 2026-06-15:

- Clickable dashboard work queue.
- Requisition detail drawer.
- Candidate detail drawer.
- Candidate process timeline.
- Richer pipeline cards with site, owner, status, and last update.
- Forward-only pipeline drag/drop.
- Full Process Update form after pipeline drop.
- Required-field validation feedback.
- Saved global filters.
- Thai/English switch.
- Color palette aligned to `Color_palette_sheet.png`.

## Documentation Maintenance Rule

Whenever the website changes, update this document in the same work session.

Update this file when changing:

- Page structure
- Form fields
- Dialogs or drawers
- Dashboard behavior
- Pipeline behavior
- API routes
- Database tables
- User journeys
- Translation behavior
- Color palette or visual system

Update `DEPLOYMENT.md` when changing:

- Hosting model
- Git workflow
- Environment variables
- Port/server behavior
- Database location
- Backup/deployment instructions
