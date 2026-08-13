import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import type { AuthCtx } from "@/server/api/trpc";

const requireSessionAddress = (ctx: AuthCtx) => {
  const address = ctx.session?.user?.id ?? ctx.sessionAddress;
  if (!address) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return address;
};

const assertWalletAccess = async (
  ctx: AuthCtx,
  walletId: string,
  requester: string | string[],
) => {
  const wallet = await ctx.db.wallet.findUnique({ where: { id: walletId } });
  if (!wallet) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Wallet not found" });
  }
  const requesters = Array.isArray(requester) ? requester : [requester];
  const sessionWallets: string[] = ctx.sessionWallets ?? [];
  const allRequesters = [...requesters, ...sessionWallets];
  const isSigner =
    Array.isArray(wallet.signersAddresses) &&
    wallet.signersAddresses.some((addr: string) => allRequesters.includes(addr));
  // Wallet model does not include ownerAddress; signer membership is the access control source.
  if (!isSigner) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized for this wallet" });
  }
  return wallet;
};

const getUserIdForAddress = async (ctx: AuthCtx, address: string) => {
  const user = await ctx.db.user.findUnique({ where: { address } });
  if (!user) {
    throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
  }
  return user.id;
};

const assertProxyAccess = async (
  ctx: AuthCtx,
  proxy: { walletId: string | null; userId: string | null },
  requesterAddresses: string[],
) => {
  if (proxy.walletId) {
    let hasWalletAccess = false;
    for (const addr of requesterAddresses) {
      try {
        await assertWalletAccess(ctx, proxy.walletId, addr);
        hasWalletAccess = true;
        break;
      } catch {
        // Continue checking with remaining addresses
      }
    }
    if (hasWalletAccess) return;
  }

  if (proxy.userId) {
    for (const addr of requesterAddresses) {
      try {
        const requesterUserId = await getUserIdForAddress(ctx, addr);
        if (requesterUserId === proxy.userId) {
          return;
        }
      } catch {
        // Continue checking with remaining addresses
      }
    }
  }

  throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized for this proxy" });
};

const getRequesterAddresses = (ctx: AuthCtx): string[] => {
  const sessionWallets: string[] = ctx.sessionWallets ?? [];
  return sessionWallets.length ? sessionWallets : [requireSessionAddress(ctx)];
};

/**
 * Every address the caller can act as: connected wallets plus the session
 * address. Membership is keyed by address, so a member who signs in with a
 * different connected wallet than the one they were invited with still matches.
 */
const getAllRequesterAddresses = (ctx: AuthCtx): string[] => {
  const addresses = new Set<string>(ctx.sessionWallets ?? []);
  const sessionAddress = ctx.session?.user?.id ?? ctx.sessionAddress;
  if (sessionAddress) {
    addresses.add(sessionAddress);
  }
  if (addresses.size === 0) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return [...addresses];
};

export const PROXY_MEMBER_ROLES = ["manager", "viewer"] as const;
type ProxyMemberRole = (typeof PROXY_MEMBER_ROLES)[number];

/**
 * Loose bech32 shape check. The full check needs the Mesh serialization stack,
 * which we keep out of the server bundle; the client validates properly before
 * submitting and a malformed address here only ever creates a dead grant.
 */
const CARDANO_ADDRESS_PATTERN = /^addr(_test)?1[02-9ac-hj-np-z]{20,150}$/;

const proxyAddressSchema = z
  .string()
  .trim()
  .refine((value) => CARDANO_ADDRESS_PATTERN.test(value), {
    message: "Not a valid Cardano payment address",
  });

const hasOwnerProxyAccess = async (
  ctx: AuthCtx,
  proxy: { walletId: string | null; userId: string | null },
  addresses: string[],
) => {
  try {
    await assertProxyAccess(ctx, proxy, addresses);
    return true;
  } catch {
    return false;
  }
};

type ProxyPermissions = {
  canRead: boolean;
  canManage: boolean;
  role: "owner" | ProxyMemberRole | null;
};

/**
 * Resolves what the caller may do with a proxy.
 *
 * Owners (signers of the controlling multisig, or the proxy's own user) always
 * get full access. Everyone else gets whatever their ProxyMember row grants:
 * `manager` can also change the member list, `viewer` is read-only.
 */
const resolveProxyPermissions = async (
  ctx: AuthCtx,
  proxy: { walletId: string | null; userId: string | null },
  proxyId: string,
  addresses: string[],
): Promise<ProxyPermissions> => {
  if (await hasOwnerProxyAccess(ctx, proxy, addresses)) {
    return { canRead: true, canManage: true, role: "owner" };
  }

  const memberships = await ctx.db.proxyMember.findMany({
    where: { proxyId, address: { in: addresses } },
  });
  if (memberships.length === 0) {
    return { canRead: false, canManage: false, role: null };
  }

  const canManage = memberships.some((member) => member.role === "manager");
  return { canRead: true, canManage, role: canManage ? "manager" : "viewer" };
};

const requireManageableProxy = async (
  ctx: AuthCtx,
  proxyId: string,
  addresses: string[],
) => {
  const proxy = await ctx.db.proxy.findUnique({ where: { id: proxyId } });
  if (!proxy) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Proxy not found" });
  }
  const permissions = await resolveProxyPermissions(ctx, proxy, proxyId, addresses);
  if (!permissions.canManage) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Not authorized to manage access for this proxy",
    });
  }
  return { proxy, permissions };
};

const assertWalletAccessForAnyAddress = async (
  ctx: AuthCtx,
  walletId: string,
  addresses: string[],
) => {
  for (const addr of addresses) {
    try {
      await assertWalletAccess(ctx, walletId, addr);
      return;
    } catch {
      // continue checking next address
    }
  }
  throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized for this wallet" });
};

const listActiveProxiesByUserAddress = async (ctx: AuthCtx, userAddress: string) => {
  return ctx.db.$queryRaw<Array<{
    id: string;
    walletId: string | null;
    proxyAddress: string;
    authTokenId: string;
    paramUtxo: string;
    description: string | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    userId: string | null;
  }>>`
    SELECT p.*
    FROM "Proxy" p
    INNER JOIN "User" u ON p."userId" = u.id
    WHERE u.address = ${userAddress}
      AND p."isActive" = true
    ORDER BY p."createdAt" DESC
  `;
};

const assertProxyManageAccess = async (
  ctx: AuthCtx,
  proxy: { walletId: string | null; userId: string | null },
  sessionAddress: string,
) => {
  if (proxy.walletId) {
    await assertWalletAccess(ctx, proxy.walletId, sessionAddress);
  }
  if (proxy.userId) {
    const sessionUserId = await getUserIdForAddress(ctx, sessionAddress);
    if (sessionUserId !== proxy.userId) {
      throw new TRPCError({ code: "FORBIDDEN", message: "User mismatch" });
    }
  }
};

export const proxyRouter = createTRPCRouter({
  getUserByAddress: protectedProcedure
    .input(z.object({ address: z.string() }))
    .query(async ({ ctx, input }) => {
      const sessionAddress = requireSessionAddress(ctx);
      if (sessionAddress !== input.address) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Address mismatch" });
      }
      return ctx.db.user.findUnique({
        where: {
          address: input.address,
        },
      });
    }),
  createProxy: protectedProcedure
    .input(
      z.object({
        walletId: z.string().optional(),
        userId: z.string().optional(),
        proxyAddress: z.string(),
        authTokenId: z.string(),
        paramUtxo: z.string(),
        description: z.string().optional(),
      }).refine(
        (data) => data.walletId || data.userId,
        {
          message: "Either walletId or userId must be provided",
        }
      ),
    )
    .mutation(async ({ ctx, input }) => {
      const sessionAddress = requireSessionAddress(ctx);
      if (input.walletId) {
        await assertWalletAccess(ctx, input.walletId, sessionAddress);
      }
      if (input.userId) {
        const sessionUserId = await getUserIdForAddress(ctx, sessionAddress);
        if (sessionUserId !== input.userId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "User mismatch" });
        }
      }
      return ctx.db.proxy.create({
        data: {
          walletId: input.walletId,
          userId: input.userId,
          proxyAddress: input.proxyAddress,
          authTokenId: input.authTokenId,
          paramUtxo: input.paramUtxo,
          description: input.description,
        },
      });
    }),

  // Read-only queries require authenticated session whose address is a signer/owner
  getProxiesByWallet: protectedProcedure
    .input(z.object({ walletId: z.string() }))
    .query(async ({ ctx, input }) => {
      const sessionAddress = requireSessionAddress(ctx);
      await assertWalletAccess(ctx, input.walletId, sessionAddress);
      return ctx.db.proxy.findMany({
        where: {
          walletId: input.walletId,
          isActive: true,
        },
        orderBy: {
          createdAt: "desc",
        },
      });
    }),

  getProxiesByUser: protectedProcedure
    .input(z.object({ userAddress: z.string() }))
    .query(async ({ ctx, input }) => {
      const addresses = getRequesterAddresses(ctx);
      if (!addresses.includes(input.userAddress)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Address mismatch" });
      }
      return listActiveProxiesByUserAddress(ctx, input.userAddress);
    }),

  getProxiesByUserOrWallet: protectedProcedure
    .input(z.object({ 
      walletId: z.string().optional(),
      userAddress: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const addresses = getRequesterAddresses(ctx);
      // Prefer fetching by walletId when available (already optimized with index)
      if (input.walletId) {
        await assertWalletAccessForAnyAddress(ctx, input.walletId, addresses);
        return ctx.db.proxy.findMany({
          where: {
            walletId: input.walletId,
            isActive: true,
          },
          orderBy: { createdAt: "desc" },
        });
      }

      // Fallback: fetch by user address if provided
      // Optimized: Use a single query with raw SQL to avoid N+1
      if (input.userAddress) {
        if (!addresses.includes(input.userAddress)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Address mismatch" });
        }
        return listActiveProxiesByUserAddress(ctx, input.userAddress);
      }

      // No criteria provided
      return [];
    }),

  getProxyById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const proxy = await ctx.db.proxy.findUnique({
        where: {
          id: input.id,
        },
      });
      if (!proxy) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Proxy not found" });
      }

      const addresses = getAllRequesterAddresses(ctx);
      const permissions = await resolveProxyPermissions(
        ctx,
        proxy,
        proxy.id,
        addresses,
      );
      if (!permissions.canRead) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Not authorized for this proxy",
        });
      }

      return proxy;
    }),

  updateProxy: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        description: z.string().optional(),
        isActive: z.boolean().optional(),
        walletId: z.string().optional(),
        userId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const sessionAddress = requireSessionAddress(ctx);
      const proxy = await ctx.db.proxy.findUnique({ where: { id: input.id } });
      if (!proxy) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Proxy not found" });
      }
      await assertProxyManageAccess(ctx, proxy, sessionAddress);

      if (input.walletId !== undefined || input.userId !== undefined) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Changing proxy ownership is not allowed in updateProxy. Use transferProxies or recreate the proxy.",
        });
      }

      return ctx.db.proxy.update({
        where: {
          id: input.id,
        },
        data: {
          description: input.description,
          isActive: input.isActive,
        },
      });
    }),

  deleteProxy: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const sessionAddress = requireSessionAddress(ctx);
      const proxy = await ctx.db.proxy.findUnique({ where: { id: input.id } });
      if (!proxy) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Proxy not found" });
      }
      await assertProxyManageAccess(ctx, proxy, sessionAddress);
      return ctx.db.proxy.delete({
        where: {
          id: input.id,
        },
      });
    }),

  deactivateProxy: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const sessionAddress = requireSessionAddress(ctx);
      const proxy = await ctx.db.proxy.findUnique({ where: { id: input.id } });
      if (!proxy) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Proxy not found" });
      }
      await assertProxyManageAccess(ctx, proxy, sessionAddress);
      return ctx.db.proxy.update({
        where: {
          id: input.id,
        },
        data: {
          isActive: false,
        },
      });
    }),

  transferProxies: protectedProcedure
    .input(z.object({ 
      fromWalletId: z.string(),
      toWalletId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const sessionAddress = requireSessionAddress(ctx);
      await assertWalletAccess(ctx, input.fromWalletId, sessionAddress);
      await assertWalletAccess(ctx, input.toWalletId, sessionAddress);
      // Find all active proxies for the source wallet
      const proxies = await ctx.db.proxy.findMany({
        where: {
          walletId: input.fromWalletId,
          isActive: true,
        },
      });

      if (proxies.length === 0) {
        return { transferred: 0, message: "No proxies found to transfer" };
      }

      // Update all proxies to point to the new wallet
      const updatePromises = proxies.map(proxy =>
        ctx.db.proxy.update({
          where: { id: proxy.id },
          data: { walletId: input.toWalletId },
        })
      );

      await Promise.all(updatePromises);

      return {
        transferred: proxies.length,
        message: `Successfully transferred ${proxies.length} proxy${proxies.length !== 1 ? 'ies' : ''}`
      };
    }),

  /**
   * Batched member lookup for a set of proxies. Proxies the caller cannot read
   * are omitted rather than throwing, so a single call can back a whole list of
   * proxy cards.
   */
  listProxyMembers: protectedProcedure
    .input(z.object({ proxyIds: z.array(z.string()).min(1).max(50) }))
    .query(async ({ ctx, input }) => {
      const addresses = getAllRequesterAddresses(ctx);
      const proxyIds = [...new Set(input.proxyIds)];
      const proxies = await ctx.db.proxy.findMany({
        where: { id: { in: proxyIds } },
      });

      const permissionsByProxy = new Map<string, ProxyPermissions>();
      for (const proxy of proxies) {
        permissionsByProxy.set(
          proxy.id,
          await resolveProxyPermissions(ctx, proxy, proxy.id, addresses),
        );
      }

      const readableIds = proxies
        .filter((proxy) => permissionsByProxy.get(proxy.id)?.canRead)
        .map((proxy) => proxy.id);

      const members = readableIds.length
        ? await ctx.db.proxyMember.findMany({
            where: { proxyId: { in: readableIds } },
            orderBy: { createdAt: "asc" },
          })
        : [];

      return readableIds.map((proxyId) => ({
        proxyId,
        canManage: permissionsByProxy.get(proxyId)?.canManage ?? false,
        role: permissionsByProxy.get(proxyId)?.role ?? null,
        members: members
          .filter((member) => member.proxyId === proxyId)
          .map((member) => ({
            id: member.id,
            address: member.address,
            role: member.role,
            label: member.label,
            invitedBy: member.invitedBy,
            createdAt: member.createdAt,
            isSelf: addresses.includes(member.address),
          })),
      }));
    }),

  addProxyMembers: protectedProcedure
    .input(
      z.object({
        proxyId: z.string(),
        members: z
          .array(
            z.object({
              address: proxyAddressSchema,
              role: z.enum(PROXY_MEMBER_ROLES).default("viewer"),
              label: z.string().trim().max(120).optional(),
            }),
          )
          .min(1)
          .max(20),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const addresses = getAllRequesterAddresses(ctx);
      await requireManageableProxy(ctx, input.proxyId, addresses);

      const invitedBy = addresses[0]!;
      const seen = new Set<string>();
      const rows = input.members
        .filter((member) => {
          if (seen.has(member.address)) return false;
          seen.add(member.address);
          return true;
        })
        .map((member) => ({
          proxyId: input.proxyId,
          address: member.address,
          role: member.role,
          label: member.label && member.label.length > 0 ? member.label : null,
          invitedBy,
        }));

      const result = await ctx.db.proxyMember.createMany({
        data: rows,
        skipDuplicates: true,
      });

      return { added: result.count, requested: rows.length };
    }),

  updateProxyMember: protectedProcedure
    .input(
      z.object({
        proxyId: z.string(),
        address: proxyAddressSchema,
        role: z.enum(PROXY_MEMBER_ROLES).optional(),
        label: z.string().trim().max(120).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const addresses = getAllRequesterAddresses(ctx);
      await requireManageableProxy(ctx, input.proxyId, addresses);

      if (input.role === undefined && input.label === undefined) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Nothing to update",
        });
      }

      return ctx.db.proxyMember.update({
        where: {
          proxyId_address: { proxyId: input.proxyId, address: input.address },
        },
        data: {
          ...(input.role !== undefined ? { role: input.role } : {}),
          ...(input.label !== undefined
            ? { label: input.label && input.label.length > 0 ? input.label : null }
            : {}),
        },
      });
    }),

  removeProxyMember: protectedProcedure
    .input(z.object({ proxyId: z.string(), address: proxyAddressSchema }))
    .mutation(async ({ ctx, input }) => {
      const addresses = getAllRequesterAddresses(ctx);

      // Members can always remove themselves ("leave"), even as viewers.
      if (!addresses.includes(input.address)) {
        await requireManageableProxy(ctx, input.proxyId, addresses);
      }

      await ctx.db.proxyMember.deleteMany({
        where: { proxyId: input.proxyId, address: input.address },
      });

      return { removed: true };
    }),

  /** Active proxies shared with the caller through a ProxyMember grant. */
  getSharedProxies: protectedProcedure.query(async ({ ctx }) => {
    const addresses = getAllRequesterAddresses(ctx);
    const memberships = await ctx.db.proxyMember.findMany({
      where: { address: { in: addresses } },
      orderBy: { createdAt: "desc" },
    });
    if (memberships.length === 0) return [];

    const proxies = await ctx.db.proxy.findMany({
      where: {
        id: { in: memberships.map((member) => member.proxyId) },
        isActive: true,
      },
      orderBy: { createdAt: "desc" },
    });

    const membershipByProxy = new Map(
      memberships.map((member) => [member.proxyId, member]),
    );

    return proxies.map((proxy) => ({
      ...proxy,
      // The address the grant was issued to, so the member can revoke it.
      memberAddress: membershipByProxy.get(proxy.id)?.address ?? addresses[0]!,
      role: membershipByProxy.get(proxy.id)?.role ?? "viewer",
      label: membershipByProxy.get(proxy.id)?.label ?? null,
      invitedBy: membershipByProxy.get(proxy.id)?.invitedBy ?? null,
      sharedAt: membershipByProxy.get(proxy.id)?.createdAt ?? proxy.createdAt,
    }));
  }),
});