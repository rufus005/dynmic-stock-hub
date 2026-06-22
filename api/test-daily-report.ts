import { DEFAULT_DAILY_REPORT_RECIPIENTS, isAuthorizedRequest, runDailyReportEmail } from './_dailyReport';
import { formatIstDate } from '../src/lib/dailySalesReport';

function isLocalRequest(request: any): boolean {
  const host = String(request.headers.host || '');
  return host.startsWith('localhost') || host.startsWith('127.0.0.1');
}

export default async function handler(request: any, response: any) {
  if (!isLocalRequest(request) && !isAuthorizedRequest(request)) {
    response.status(401).json({ error: 'Unauthorized. Add ?secret=YOUR_CRON_SECRET or send Authorization: Bearer YOUR_CRON_SECRET.' });
    return;
  }

  try {
    const result = await runDailyReportEmail({
      date: formatIstDate(),
      recipients: DEFAULT_DAILY_REPORT_RECIPIENTS,
      trigger: 'test',
    });
    response.status(200).json({
      ...result,
      message: 'Temporary test daily report sent.',
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      date: formatIstDate(),
      recipients: DEFAULT_DAILY_REPORT_RECIPIENTS,
      envDetected: {
        RESEND_API_KEY: Boolean(process.env.RESEND_API_KEY),
        RESEND_FROM_EMAIL: Boolean(process.env.RESEND_FROM_EMAIL),
        CRON_SECRET: Boolean(process.env.CRON_SECRET),
      },
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
