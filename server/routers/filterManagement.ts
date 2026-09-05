import { router, protectedProcedure } from "../_core/trpc";
import { z } from "zod";
import { db } from "../../../drizzle/db";
import { filters } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

export const filterManagementRouter = router({
  list: protectedProcedure.query(async () => {
    try {
      const allFilters = await db.select().from(filters);
      return allFilters;
    } catch (error) {
      console.error("Error fetching filters:", error);
      throw new Error("Failed to fetch filters");
    }
  }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string(),
        type: z.string(),
        location: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const [newFilter] = await db
          .insert(filters)
          .values({
            name: input.name,
            type: input.type,
            location: input.location || "",
          })
          .$returningId();
        return { success: true, filterId: newFilter };
      } catch (error) {
        console.error("Error creating filter:", error);
        throw new Error("Failed to create filter");
      }
    }),
});
```eof
