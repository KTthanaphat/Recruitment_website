# Seed Data

Use seed SQL only for anonymized demo data. Do not place live candidate, employee, phone, or offer data in this folder.

For first setup:

1. Create the first user in Supabase Auth.
2. Run this SQL in Supabase SQL Editor, replacing the email:

```sql
update public.profiles
set role = 'admin'
where email = 'your-admin-email@example.com';
```

3. Sign in to the app and create recruiter/viewer accounts from Setup.
