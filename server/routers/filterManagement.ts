import { TRPCError } from "@trpc/server";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { parse as parseCookie } from "cookie";
import { and, asc, desc, eq, gte, inArray, isNotNull, like, lte, ne, or } from "drizzle-orm";
import { z } from "zod";
import { normalizeEvidenceDataUrl, isSupportedEvidenceMime } from "../utils/evidence";
import {
  cashTransactions,
  customers,
  inventoryItems,
  inventoryMovements,
  notificationSettings,
  serviceTypeItems,
  serviceTypes,
  visitItems,
  reminders,
  visits,
  users,
  allowedTechnicianAccounts,
  technicianLocations,
  workOrderProofs,
} from "../../drizzle/schema";
import {
  isReminderAlertActive,
  needsAutomaticReminder,
  visitTypes,
} from "../../shared/filterBusiness";

