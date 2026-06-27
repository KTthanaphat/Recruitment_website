# Recruitment Website Deployment Guide

> Current cloud deployment documentation lives in `docs/DEPLOYMENT.md`.
> The content below is the legacy Python/SQLite deployment reference retained for historical context.

Last updated: 2026-06-15

## Purpose

This project is an internal recruitment tracking website. It is designed for HR/recruitment users to manage requisitions, candidates, recruitment process logs, offers, position groups, and audit history.

## Current Stack

- Backend: Python standard library HTTP server in `app.py`
- Database: SQLite file `recruitment_tracking.db`
- Frontend: static HTML/CSS/JavaScript in `web/`
- Version control: GitHub repository `KTthanaphat/Recruitment_website`
- Local development URL: `http://127.0.0.1:8010/`

## Local Run

```powershell
cd "C:\Users\thanaphat-krea\OneDrive - GFPT Public Company Limited\HR_database\recruitment_website"
python app.py
```

The default port is `8010`.

To use another port:

```powershell
$env:PORT="8011"
python app.py
```

## Git Branch Model

Use two long-running branches:

- `main`: live/stable version
- `develop`: development/testing version

Normal workflow:

```powershell
git switch develop
# make and test changes
git add .
git commit -m "Describe the change"
git push
```

When tested and ready for live:

```powershell
git switch main
git merge develop
git push
git switch develop
```

## Database Handling

The live data file is:

```text
recruitment_tracking.db
```

This file is intentionally ignored by Git because it may contain sensitive HR/recruitment data.

Do not upload live database files to GitHub.

Ignored local database/runtime files include:

```text
*.db
*.db-journal
*.sqlite
*.sqlite3
*.wal
*.shm
```

## Recommended Internal Deployment

Recommended setup for company intranet use:

```text
GitHub repository
  -> application code

Internal server
  -> runs app.py
  -> stores recruitment_tracking.db on server local disk
  -> exposes internal URL to users
```

Example internal URL:

```text
http://hr-recruitment-server:8010/
```

Recommended database location on server:

```text
D:\RecruitmentWebsite\data\recruitment_tracking.db
```

Recommended application location:

```text
D:\RecruitmentWebsite\app\
```

## Important: Do Not Use OneDrive As Live Database Storage

OneDrive is acceptable for code backup and personal file syncing, but it is not recommended as the live SQLite database location for multiple users.

Risk:

- SQLite needs reliable file locking.
- OneDrive sync can lock or rewrite files while the app writes data.
- This can cause failed writes, missing updates, or database corruption.

Better options:

- SQLite on the internal server local disk for light usage.
- SQL Server, PostgreSQL, or MySQL for heavier multi-user usage.

## Backup Recommendation

For SQLite deployment, IT should back up the live database file regularly.

Minimum recommendation:

```text
Daily backup of recruitment_tracking.db
Keep at least 14-30 days of backups
Test restore procedure before go-live
```

Before any schema or deployment change:

```text
Stop app
Copy recruitment_tracking.db to backup location
Deploy code
Start app
Verify dashboard loads
```

## Serverless Option

Serverless can work for low-usage internal tools, but not with a writable local SQLite file.

Serverless-friendly architecture:

```text
Browser
  -> Serverless Python API
  -> Hosted database
```

Use one of these hosted databases:

- PostgreSQL
- SQL Server / Azure SQL
- Supabase
- Neon
- Cloud SQL

Use serverless only if the database is moved away from local SQLite.

## Production Checklist

Before giving access to users:

- Confirm the app runs on the internal server.
- Confirm users can reach the internal URL.
- Confirm `recruitment_tracking.db` is stored outside OneDrive.
- Confirm database backups are scheduled.
- Confirm GitHub does not contain real database files.
- Confirm `main` branch is the deployed branch.
- Confirm browser loads `/api/dashboard` successfully.
- Confirm create/change forms work.
- Confirm drag/drop process update opens the full process form.
- Confirm Thai/English language switch works.

## Documentation Maintenance Rule

Every functional, UI, database, deployment, or workflow change should update documentation in the same change set:

- Update this file when deployment, hosting, database, environment, or Git workflow changes.
- Update `WEBSITE_STRUCTURE.md` when pages, UI flows, files, APIs, database tables, or user journeys change.
