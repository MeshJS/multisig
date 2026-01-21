import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";

export const authRouter = createTRPCRouter({
  getWalletSession: publicProcedure
    .input(z.object({ address: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      // Use wallet-session data already decoded into the tRPC context
      const wallets: string[] = (ctx as any).sessionWallets ?? [];
      const authorized = wallets.includes(input.address);

      return {
        authorized,
        wallets,
        primaryWallet: (ctx as any).primaryWallet ?? null,
      };
    }),
});


