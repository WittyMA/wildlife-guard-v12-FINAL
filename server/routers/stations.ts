/**
 * tRPC router for camera station management
 */

import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import {
  createCameraStation,
  getCameraStations,
  getCameraStationById,
  updateCameraStation,
} from "../db";
import { nanoid } from "nanoid";

export const stationRouter = router({
  // Get all camera stations
  list: publicProcedure.query(async () => {
    const stations = await getCameraStations();
    // Always return at least a default station for field operation
    if (!stations || stations.length === 0) {
      return [{
        id: 'default',
        name: 'Field Station (Default)',
        latitude: 0,
        longitude: 0,
        status: 'online',
        sensitivity: 'high',
        alertThreshold: 0.60,
        createdAt: new Date(),
        updatedAt: new Date(),
      }];
    }
    return stations;
  }),

  // Get a specific station by ID
  getById: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      return getCameraStationById(input.id);
    }),

  // Create a new camera station
  create: protectedProcedure
    .input(
      z.object({
        name: z.string(),
        latitude: z.number(),
        longitude: z.number(),
        sensitivity: z.enum(["low", "medium", "high"]).default("medium"),
        alertThreshold: z.number().default(0.85),
      })
    )
    .mutation(async ({ input }) => {
      const station = await createCameraStation({
        id: nanoid(),
        ...input,
        status: "offline",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      return station;
    }),

  // Update a camera station
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        status: z.enum(["online", "offline", "error"]).optional(),
        sensitivity: z.enum(["low", "medium", "high"]).optional(),
        alertThreshold: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await updateCameraStation(id, {
        ...data,
        updatedAt: new Date(),
      });
      return { success: true };
    }),

  // Update station status
  updateStatus: publicProcedure
    .input(
      z.object({
        id: z.string(),
        status: z.enum(["online", "offline", "error"]),
      })
    )
    .mutation(async ({ input }) => {
      await updateCameraStation(input.id, {
        status: input.status,
        updatedAt: new Date(),
      });
      return { success: true };
    }),
});
