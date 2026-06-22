import { isAuthorizedRequest, runDailyReportEmail } from './_dailyReport';

export default async function handler(request: any, response: any) {
  if (!isAuthorizedRequest(request, { allowVercelCronHeader: true })) {
    response.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const result = await runDailyReportEmail({
      date: typeof request.query?.date === 'string' ? request.query.date : undefined,
      triggeredBy: 'cron',
    });
    response.status(200).json(result);
  } catch (error) {
    response.status(500).json({
      ok: false,
      envDetected: {
        RESEND_API_KEY: Boolean(process.env.RESEND_API_KEY),
        RESEND_FROM_EMAIL: Boolean(process.env.RESEND_FROM_EMAIL),
        CRON_SECRET: Boolean(process.env.CRON_SECRET),
      },
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
