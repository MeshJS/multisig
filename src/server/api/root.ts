import { createCallerFactory, createTRPCRouter } from "@/server/api/trpc";
import { userRouter } from "./routers/users";
import { walletRouter } from "./routers/wallets";
import { transactionRouter } from "./routers/transactions";
import { signableRouter } from "./routers/signable";
import { ballotRouter } from "./routers/ballot";

import { crowdfundRouter } from "./routers/crowdfunds";

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
  transaction: transactionRouter,
  user: userRouter,
  wallet: walletRouter,
  signable: signableRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;

/**
 * Create a server-side caller for the tRPC API.
 * @example
 * const trpc = createCaller(createContext);
 * const res = await trpc.post.all();
 *       ^? Post[]
 */
export const createCaller = createCallerFactory(appRouter);
