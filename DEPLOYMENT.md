# Recruitment Website Deployment Notes

## Can this be serverless?

Yes, for an internal site that is not used frequently, serverless can be a good fit because the app only runs when someone opens it.

The important constraint is the database:

- Serverless functions do not reliably keep local files between starts.
- A SQLite file bundled with the app is usually read-only or temporary.
- If users update recruitment records, use a hosted database such as PostgreSQL, SQL Server, Supabase, Neon, Azure SQL, or Cloud SQL.

Recommended serverless architecture:

```text
Browser
  -> Serverless Python API
  -> Hosted database
```

Use this when you want low maintenance, HTTPS, and occasional internal usage.

## If you want to keep SQLite

Use a small internal web service instead of true serverless:

```text
Browser
  -> Internal VM / company PC / Render-style web service
  -> recruitment_tracking.db
```

This is simpler, but you must keep the server running and back up `recruitment_tracking.db`.

## Current local run command

```powershell
cd "C:\Users\thanaphat-krea\OneDrive - GFPT Public Company Limited\HR_database\recruitment_website"
python app.py
```

The local app defaults to:

```text
http://127.0.0.1:8010/
```
