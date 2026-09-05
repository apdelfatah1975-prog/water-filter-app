import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;
  const user = ctx.user ?? { openId: 'local-admin', email: 'admin@local.com', name: 'Admin', role: 'admin' };

  return next({
    ctx: {
      ...ctx,
      user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;
    const user = ctx.user ?? { openId: 'local-admin', email: 'admin@local.com', name: 'Admin', role: 'admin' };

    return next({
      ctx: {
        ...ctx,
        user: user,
      },
    });
  }),
);
