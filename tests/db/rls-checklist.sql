-- Run these checks manually in Supabase SQL Editor after applying migrations.
-- They document the expected database security behavior for v1.

-- 1. Anonymous access should not return recruitment data through exposed APIs.
-- 2. Authenticated viewer profiles should pass select policies only.
-- 3. Recruiter/admin profiles should use RPC functions for writes.
-- 4. Direct table writes should stay blocked for authenticated users.
-- 5. Every RPC write should create a row in public.change_logs.
