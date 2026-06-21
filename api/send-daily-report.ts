import { get, push, ref, set } from 'firebase/database';
import {
  DAILY_EMAIL_REPORT_SETTINGS_PATH,
  EMAIL_REPORT_LOGS_PATH,
  PRODUCT_PRICING_PATH,
  PRODUCTS_PATH,
  db,
} from '../src/lib/firebase';
import {
  buildDailySalesReport,
  createDailySalesPdfAttachments,
  formatIstDate,
  normalizeBranchesFromFirebase,
  normalizeProductPricingFromFirebase,
} from '../src/lib/dailySalesReport';

const DEFAULT_RECIPIENTS = ['rufus090420@gmail.com'];

type EmailReportLog = {
  date: string;
  time: string;
  status: 'success' | 'error';
  attempt: number;
  recipientList: string[];
  attachedPdfCount: number;
  successResponse?: unknown;
  errorMessage?: string;
};

function isAuthorized(request: any): boolean {
  const cronHeader = request.headers['x-vercel-cron'];
  const userAgent = String(request.headers['user-agent'] || '').toLowerCase();
  const expectedSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.authorization || request.headers.Authorization;

  if (expectedSecret && authHeader === `Bearer ${expectedSecret}`) return true;
  return cronHeader === '1' || userAgent.includes('vercel-cron');
}

function getRecipients(settings: unknown): string[] {
  const recipients = Array.isArray((settings as { recipients?: unknown[] } | null)?.recipients)
    ? (settings as { recipients: unknown[] }).recipients
    : DEFAULT_RECIPIENTS;
  const cleaned = Array.from(new Set(
    recipients
      .filter((email): email is string => typeof email === 'string')
      .map(email => email.trim())
      .filter(email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  ));
  return cleaned.length > 0 ? cleaned : DEFAULT_RECIPIENTS;
}

async function writeEmailReportLog(log: EmailReportLog) {
  const logRef = push(ref(db, EMAIL_REPORT_LOGS_PATH));
  await set(logRef, log);
}

async function sendWithResend(input: {
  recipients: string[];
  date: string;
  attachments: { filename: string; content: ArrayBuffer }[];
}) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey) throw new Error('Missing RESEND_API_KEY environment variable.');
  if (!from) throw new Error('Missing RESEND_FROM_EMAIL environment variable.');

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: input.recipients,
      subject: `DYNAMIC Daily Sales Report - ${input.date}`,
      html: `<p>Attached are the Daily Sales Report PDFs for ${input.date}.</p><p>This email includes the overall report and separate branch-wise reports.</p>`,
      attachments: input.attachments.map(attachment => ({
        filename: attachment.filename,
        content: Buffer.from(attachment.content).toString('base64'),
      })),
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Resend failed with ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

export default async function handler(request: any, response: any) {
  if (!isAuthorized(request)) {
    response.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const reportDate = typeof request.query?.date === 'string' ? request.query.date : formatIstDate();
  const startedAt = new Date().toISOString();
  let recipients = DEFAULT_RECIPIENTS;
  let attachedPdfCount = 0;

  try {
    const [productsSnapshot, pricingSnapshot, settingsSnapshot] = await Promise.all([
      get(ref(db, PRODUCTS_PATH)),
      get(ref(db, PRODUCT_PRICING_PATH)),
      get(ref(db, DAILY_EMAIL_REPORT_SETTINGS_PATH)),
    ]);

    const branches = normalizeBranchesFromFirebase(productsSnapshot.val());
    const pricing = normalizeProductPricingFromFirebase(pricingSnapshot.val());
    recipients = getRecipients(settingsSnapshot.val());
    const report = buildDailySalesReport(branches, reportDate, pricing);
    const attachments = createDailySalesPdfAttachments(report, pricing);
    attachedPdfCount = attachments.length;

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const resendResponse = await sendWithResend({ recipients, date: reportDate, attachments });
        await writeEmailReportLog({
          date: reportDate,
          time: new Date().toISOString(),
          status: 'success',
          attempt,
          recipientList: recipients,
          attachedPdfCount,
          successResponse: resendResponse,
        });
        response.status(200).json({
          ok: true,
          date: reportDate,
          recipients,
          attachedPdfCount,
          resendResponse,
        });
        return;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await writeEmailReportLog({
          date: reportDate,
          time: new Date().toISOString(),
          status: 'error',
          attempt,
          recipientList: recipients,
          attachedPdfCount,
          errorMessage,
        });
        if (attempt === 2) throw error;
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (attachedPdfCount === 0) {
      await writeEmailReportLog({
        date: reportDate,
        time: new Date().toISOString(),
        status: 'error',
        attempt: 1,
        recipientList: recipients,
        attachedPdfCount,
        errorMessage,
      }).catch(logError => console.error('Failed to log email report error:', logError));
    }
    response.status(500).json({
      ok: false,
      date: reportDate,
      startedAt,
      error: errorMessage,
    });
  }
}
