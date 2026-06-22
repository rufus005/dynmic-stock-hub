import { runDailyReportEmail } from './_dailyReport';

function isSameOriginRequest(request: any): boolean {
  const host = String(request.headers.host || '');
  const origin = String(request.headers.origin || '');
  if (!origin) return host.startsWith('localhost') || host.startsWith('127.0.0.1');
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export default async function handler(request: any, response: any) {
  if (request.method !== 'POST') {
    response.status(405).json({ ok: false, error: 'Method not allowed. Use POST.' });
    return;
  }

  if (!isSameOriginRequest(request)) {
    response.status(401).json({ ok: false, error: 'Unauthorized manual daily report request.' });
    return;
  }

  try {
    const result = await runDailyReportEmail({ triggeredBy: 'manual' });
    response.status(200).json(result);
  } catch (error) {
    response.status(500).json({
      ok: false,
      triggeredBy: 'manual',
      envDetected: {
        RESEND_API_KEY: Boolean(process.env.RESEND_API_KEY),
        RESEND_FROM_EMAIL: Boolean(process.env.RESEND_FROM_EMAIL),
        CRON_SECRET: Boolean(process.env.CRON_SECRET),
      },
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
