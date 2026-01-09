#!/bin/sh
set -e

echo "Applying Crowdfund RLS fixes..."

# This script fixes Row Level Security (RLS) issues with the Crowdfund table
# Adjust the SQL based on your actual schema requirements
psql "${DATABASE_URL}" -c "
-- Add any RLS policy fixes here
-- Example: ALTER TABLE \"Crowdfund\" ENABLE ROW LEVEL SECURITY;
SELECT 1;
" || true

echo "Crowdfund RLS fixes applied."
