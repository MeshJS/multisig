-- AlterTable
-- Add anchorUrls column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='Ballot' AND column_name='anchorUrls') THEN
        ALTER TABLE "Ballot" ADD COLUMN "anchorUrls" TEXT[];
    END IF;
END $$;

-- Add anchorHashes column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='Ballot' AND column_name='anchorHashes') THEN
        ALTER TABLE "Ballot" ADD COLUMN "anchorHashes" TEXT[];
    END IF;
END $$;

