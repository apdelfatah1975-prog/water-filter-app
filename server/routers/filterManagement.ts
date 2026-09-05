import { router, protectedProcedure } from "../_core/trpc";
import { z } from "zod";
import { db } from "../../drizzle/db";
import { filters } from "../../drizzle/schema";

export const filterManagementRouter = router({
  list: protectedProcedure.query(async () => {
    const allFilters = await db.select().from(filters);
    return allFilters;
  }),
});
