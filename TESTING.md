# Local Server Testing Guide

This guide will help you set up and test the server on your local device.

## Prerequisites

Before testing, ensure you have:

1. **Node.js 18+** installed
   ```bash
   node --version  # Should be 18.x or higher
   ```

2. **PostgreSQL database** running locally or accessible
   - Install PostgreSQL: https://www.postgresql.org/download/
   - Or use Docker: `docker run --name postgres -e POSTGRES_PASSWORD=password -p 5432:5432 -d postgres`

3. **npm** or **yarn** package manager

## Step 1: Install Dependencies

```bash
npm install
```

This will also run `postinstall` which formats and generates Prisma client.

## Step 2: Set Up Environment Variables

Create a `.env.local` file in the root directory with the following variables:

```env
# Database
DATABASE_URL="postgresql://username:password@localhost:5432/multisig"

# Blockfrost API Keys (get from https://blockfrost.io/)
NEXT_PUBLIC_BLOCKFROST_API_KEY_MAINNET="your-mainnet-api-key"
NEXT_PUBLIC_BLOCKFROST_API_KEY_PREPROD="your-preprod-api-key"

# Vercel Blob Storage (get from https://vercel.com/dashboard)
BLOB_READ_WRITE_TOKEN="your-blob-token"

# GitHub Token (for API access if needed)
GITHUB_TOKEN="your-github-token"

# Optional: Skip environment validation during development
# SKIP_ENV_VALIDATION=true
```

### Getting API Keys:

1. **Blockfrost API Keys**:
   - Visit https://blockfrost.io/
   - Sign up for a free account
   - Create projects for both Mainnet and Preprod networks
   - Copy the API keys

2. **Vercel Blob Token**:
   - Visit https://vercel.com/dashboard
   - Go to Storage → Blob
   - Create a new blob store
   - Copy the read/write token

3. **GitHub Token** (optional):
   - Visit https://github.com/settings/tokens
   - Generate a new token with appropriate permissions

## Step 3: Set Up Database

### Option A: Using Prisma Migrate (Recommended)

```bash
# Push schema to database
npm run db:push

# Generate Prisma client
npm run db:generate
```

### Option B: Using Prisma Migrate

```bash
# Run migrations
npm run db:migrate

# Generate Prisma client
npm run db:generate
```

### Verify Database Connection

You can use Prisma Studio to verify the database:

```bash
npm run db:studio
```

This will open a browser at `http://localhost:5555` where you can view and edit your database.

## Step 4: Start the Development Server

```bash
npm run dev
```

The server should start on `http://localhost:3000`

### Expected Output:

```
✓ Ready in Xms
○ Compiling / ...
✓ Compiled / in XXXms
```

## Step 5: Test the Server

### 1. **Check Server Health**

Open your browser and navigate to:
- **Main Application**: http://localhost:3000
- **API Documentation**: http://localhost:3000/api-docs (if available)

### 2. **Test Wallet Connection**

1. Open http://localhost:3000
2. Click "Connect Wallet" button
3. Select a Cardano wallet extension (Nami, Eternl, etc.)
4. Verify the connection works

### 3. **Test API Endpoints**

You can test API endpoints using curl or a tool like Postman:

```bash
# Test health endpoint (if available)
curl http://localhost:3000/api/health

# Test wallet list endpoint
curl http://localhost:3000/api/v1/walletIds
```

### 4. **Check Console for Errors**

Open browser DevTools (F12) and check:
- Console tab for JavaScript errors
- Network tab for failed API requests
- Application tab for localStorage/sessionStorage issues

## Step 6: Test Production Build (Optional)

To test the production build locally:

```bash
# Build the application
npm run build

# Start production server
npm run start
```

The production server will also run on `http://localhost:3000`

## Troubleshooting

### Issue: Environment Variables Not Found

**Error**: `Missing required environment variable: DATABASE_URL`

**Solution**: 
- Ensure `.env.local` file exists in the root directory
- Check that all required variables are set
- Restart the development server after adding variables

### Issue: Database Connection Failed

**Error**: `Can't reach database server`

**Solution**:
- Verify PostgreSQL is running: `pg_isready` or check Docker container
- Check DATABASE_URL format: `postgresql://user:password@host:port/database`
- Ensure database exists: `createdb multisig` (if using PostgreSQL CLI)

### Issue: Prisma Client Not Generated

**Error**: `@prisma/client did not initialize yet`

**Solution**:
```bash
npm run db:generate
```

### Issue: Port Already in Use

**Error**: `Port 3000 is already in use`

**Solution**:
- Find and kill the process: `lsof -ti:3000 | xargs kill`
- Or use a different port: `PORT=3001 npm run dev`

### Issue: Wallet Connection Fails

**Error**: Wallet not detected or connection fails

**Solution**:
- Ensure you have a Cardano wallet extension installed (Nami, Eternl, etc.)
- Check browser console for errors
- Try refreshing the page
- Clear browser cache and localStorage

### Issue: Blockfrost API Errors

**Error**: `401 Unauthorized` or API rate limit errors

**Solution**:
- Verify API keys are correct
- Check Blockfrost dashboard for rate limits
- Ensure you're using the correct network (mainnet vs preprod)

## Testing Checklist

- [ ] Dependencies installed (`npm install`)
- [ ] Environment variables configured (`.env.local`)
- [ ] Database set up and connected
- [ ] Prisma client generated
- [ ] Development server starts without errors
- [ ] Application loads in browser
- [ ] Wallet connection works
- [ ] API endpoints respond correctly
- [ ] No console errors
- [ ] Database operations work (create wallet, transaction, etc.)

## Additional Testing Commands

```bash
# Run linter
npm run lint

# Run tests (if available)
npm test

# Type check
npx tsc --noEmit

# Format code
npx prettier --write .
```

## Next Steps

Once the server is running locally:

1. **Create a test wallet** to verify wallet creation flow
2. **Test transaction creation** to verify transaction flow
3. **Test multi-signature signing** to verify signing flow
4. **Check API documentation** at `/api-docs` (if available)
5. **Test on different networks** (Preprod vs Mainnet)

## Getting Help

If you encounter issues:

1. Check the browser console for errors
2. Check the terminal output for server errors
3. Verify all environment variables are set correctly
4. Ensure database is running and accessible
5. Check the README.md for additional setup instructions

