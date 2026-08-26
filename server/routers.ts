import { COOKIE_NAME } from "@shared/const";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { eq, isNotNull } from "drizzle-orm";
import { clearLocalSessionCookie, hashPassword, setLocalSessionCookie, verifyPassword } from "./_core/localAuth";
import { getDb, getUserByEmail, upsertUser } from "./db";
import { users } from "../drizzle/schema";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { filterManagementRouter } from "./routers/filterManagement";

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    login: publicProcedure.input(z.object({ email: z.string().trim().email("أدخل بريدًا إلكترونيًا صحيحًا").max(320), password: z.string().min(8).max(128) })).mutation(async ({ ctx, input }) => {
      const user = await getUserByEmail(input.email);
      if (!user?.passwordHash || !(await verifyPassword(input.password, user.passwordHash))) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "البريد الإلكتروني أو كلمة المرور غير صحيحة." });
      }
      await upsertUser({ openId: user.openId, lastSignedIn: new Date() });
      const current = (await getUserByEmail(input.email)) ?? user;
      await setLocalSessionCookie(ctx.req, ctx.res, current);
      return { success: true, user: current } as const;
    }),
    register: publicProcedure.input(z.object({ name: z.string().trim().min(2).max(160), email: z.string().trim().email().max(320), password: z.string().min(8).max(128) })).mutation(async ({ ctx, input }) => {
      const email = input.email.toLowerCase();
      if (await getUserByEmail(email)) throw new TRPCError({ code: "CONFLICT", message: "هذا البريد مستخدم بالفعل." });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "قاعدة البيانات غير متاحة." });
      const existingLocal = await db.select({ id: users.id }).from(users).where(isNotNull(users.passwordHash)).limit(1);
      const openId = `local-${crypto.randomUUID()}`;
      const inserted = await db.insert(users).values({ openId, name: input.name.trim(), email, passwordHash: await hashPassword(input.password), loginMethod: "local-password", role: existingLocal.length ? "user" : "admin", lastSignedIn: new Date() });
      const created = await db.select().from(users).where(eq(users.id, Number(inserted[0].insertId))).limit(1);
      if (!created[0]) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذر إنشاء الحساب." });
      await setLocalSessionCookie(ctx.req, ctx.res, created[0]);
      return { success: true, user: created[0] } as const;
    }),
    logout: publicProcedure.mutation(({ ctx }) => {
      clearLocalSessionCookie(ctx.req, ctx.res);
      return { success: true } as const;
    }),
  }),
  filters: filterManagementRouter,
});

export type AppRouter = typeof appRouter;
