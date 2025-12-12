# Vercel Database Connection Setup Guide

## Problem
Your Vercel deployment is losing database connections because the `DATABASE_URL` is incorrectly configured. The error shows Prisma is trying to connect to port 5432 (direct connection) instead of port 6543 (pooled connection).

## Solution: Configure Supabase Connection Pooling

### Step 1: Get Your Supabase Connection URLs

1. Go to your Supabase Dashboard
2. Navigate to **Settings** → **Database**
3. Find the **Connection Pooling** section

### Step 2: Set Environment Variables in Vercel

You need to set **two** environment variables in Vercel:

#### 1. `DATABASE_URL` (for queries - REQUIRED)
- Use the **Connection Pooling** → **Transaction mode** URL
- Format: `postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true`
- **Important**: Must use port **6543** (not 5432)
- **Important**: Must include `?pgbouncer=true` parameter

#### 2. `DIRECT_URL` (for migrations - OPTIONAL but recommended)
- Use the **Connection String** → **URI** (direct connection)
- Format: `postgresql://postgres:[password]@aws-0-[region].pooler.supabase.com:5432/postgres`
- This is used only for migrations (`prisma migrate`)

### Step 3: Verify Your Configuration

After setting the environment variables, check your Vercel deployment logs. You should see:

✅ **Correct configuration:**
- No errors about port 5432
- Connection pooler URL with port 6543

❌ **Wrong configuration (what you likely have now):**
- Error: "DATABASE_URL uses pooler hostname but wrong port (5432)"
- Connection errors: "Can't reach database server"

### Example Correct URLs

**DATABASE_URL (pooled - for queries):**
```
postgresql://postgres.abcdefghijklmnop:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true
```

**DIRECT_URL (direct - for migrations):**
```
postgresql://postgres:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:5432/postgres
```

## Why This Matters

- **Port 6543**: Supabase's connection pooler (PgBouncer) - optimized for serverless
- **Port 5432**: Direct PostgreSQL connection - not suitable for Vercel serverless
- **Connection Pooling**: Prevents connection exhaustion in serverless environments
- **Retry Logic**: The code now includes automatic retry logic for connection failures

## Additional Improvements Made

1. ✅ **Connection Retry Logic**: Automatic retry with exponential backoff (3 attempts)
2. ✅ **Connection Health Checks**: Validates connection URL on startup
3. ✅ **Better Error Logging**: Production logs now show connection errors
4. ✅ **Connection Reuse**: Prisma client is reused across serverless invocations

## Testing

After updating your Vercel environment variables:

1. Redeploy your application
2. Check Vercel logs for any connection warnings
3. Test database queries - they should work reliably now
4. Monitor for connection errors in production

## Troubleshooting

If you still see connection errors:

1. **Verify DATABASE_URL format**: Must have `:6543` and `?pgbouncer=true`
2. **Check Supabase Dashboard**: Ensure connection pooling is enabled
3. **Check Vercel Logs**: Look for the validation messages on startup
4. **Test Connection**: Try connecting manually with the pooled URL

## Need Help?

Check your Vercel deployment logs for specific error messages. The code now provides detailed warnings about incorrect configuration.

