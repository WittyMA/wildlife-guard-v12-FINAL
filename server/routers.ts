import { getSessionCookieOptions } from "./_core/cookies";
import { authService } from "./_core/authService";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { detectionRouter } from "./routers/detection";
import { stationRouter } from "./routers/stations";
import { syncRouter } from "./routers/sync";
import { rangerRouter } from "./routers/rangers";
import { fcmRouter } from "./routers/fcm";
import { missionsRouter } from "./routers/missions";
import { monitoringRouter } from "./routers/monitoring";
import { aiVisionRouter } from "./routers/aiVision";

export const appRouter = router({
  // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(authService.getCookieName(), cookieOptions);
      return {
        success: true,
      } as const;
    }),
  }),

  detection: detectionRouter,
  stations: stationRouter,
  sync: syncRouter,
  rangers: rangerRouter,
  fcm: fcmRouter,
  missions: missionsRouter,
  monitoring: monitoringRouter,
  aiVision: aiVisionRouter,
});

export type AppRouter = typeof appRouter;
