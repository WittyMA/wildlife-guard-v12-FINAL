/**
 * tRPC router for ranger contacts and FCM token management
 */

import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import {
  createRangerContact,
  getRangerContactsByUserId,
  getRangerContactById,
  updateRangerContact,
  getAllActiveRangerContacts,
} from "../db";
import { nanoid } from "nanoid";

export const rangerRouter = router({
  // Register FCM token for a device
  registerToken: publicProcedure
    .input(
      z.object({
        fcmToken: z.string(),
        deviceName: z.string().optional(),
        deviceId: z.string(),
        userId: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      const contact = await createRangerContact({
        id: nanoid(),
        userId: input.userId,
        fcmToken: input.fcmToken,
        deviceName: input.deviceName,
        deviceId: input.deviceId,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      return contact;
    }),

  // Get all devices for a user
  getAllDevices: protectedProcedure.query(async ({ ctx }) => {
    return getRangerContactsByUserId(ctx.user.id);
  }),

  // Deactivate a device
  deactivateDevice: protectedProcedure
    .input(z.object({ deviceId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const device = await getRangerContactById(input.deviceId);
      if (!device || device.userId !== ctx.user.id) {
        throw new Error("Device not found or unauthorized");
      }
      await updateRangerContact(input.deviceId, {
        isActive: false,
        updatedAt: new Date(),
      });
      return { success: true };
    }),

  // Reactivate a device
  reactivateDevice: protectedProcedure
    .input(z.object({ deviceId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const device = await getRangerContactById(input.deviceId);
      if (!device || device.userId !== ctx.user.id) {
        throw new Error("Device not found or unauthorized");
      }
      await updateRangerContact(input.deviceId, {
        isActive: true,
        updatedAt: new Date(),
      });
      return { success: true };
    }),

  // Remove a device
  removeDevice: protectedProcedure
    .input(z.object({ deviceId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const device = await getRangerContactById(input.deviceId);
      if (!device || device.userId !== ctx.user.id) {
        throw new Error("Device not found or unauthorized");
      }
      // In a real app, you'd delete the device here
      // For now, we'll just deactivate it
      await updateRangerContact(input.deviceId, {
        isActive: false,
        updatedAt: new Date(),
      });
      return { success: true };
    }),

  // Get all active ranger contacts (admin only)
  getAllActive: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== "admin") {
      throw new Error("Only admins can access all ranger contacts");
    }
    return getAllActiveRangerContacts();
  }),

  // Update device last used timestamp
  updateLastUsed: publicProcedure
    .input(z.object({ deviceId: z.string() }))
    .mutation(async ({ input }) => {
      await updateRangerContact(input.deviceId, {
        lastUsed: new Date(),
      });
      return { success: true };
    }),
});
