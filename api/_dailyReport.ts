import { get, push, ref, set } from 'firebase/database';
import {
  DAILY_EMAIL_REPORT_SETTINGS_PATH,
  EMAIL_REPORT_LOGS_PATH,
  PRODUCT_PRICING_PATH,
  PRODUCTS_PATH,
  PRODUCTION_HISTORY_PATH,
  TRANSFER_HISTORY_PATH,
  db,
} from '../src/lib/firebase';
import {
  createFullDailyReportPackage,
  formatIstDate,
  normalizeBranchesFromFirebase,
  normalizeProductionHistoryFromFirebase,
  normalizeProductPricingFromFirebase,
  normalizeTransferHistoryFromFirebase,
} from '../src/lib/dailySalesReport';

export const DEFAULT_DAILY_REPORT_RECIPIENTS = ['rufus090420@gmail.com'];

type EmailReportLog = {
  triggeredBy: 'manual' | 'cron' | 'test';
  date: string;
  time: string;
  status: 'success' | 'failure';
  attempt: number;
  recipientEmails: string[];
  attachmentNames: string[];
  attachedPdfCount: number;
  resendResponseId?: string;
  resendResponse?: unknown;
  errorMessage?: string;
};

export function getRecipients(settings: unknown): string[] {
  if (!settings) return DEFAULT_DAILY_REPORT_RECIPIENTS;
  const recipients = Array.isArray((settings as { recipients?: unknown[] }).recipients)
    ? (settings as { recipients: unknown[] }).recipients
    : [];
  const cleaned = Array.from(new Set(
    recipients
      .filter((email): email is string => typeof email === 'string')
      .map(email => email.trim())
      .filter(email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  ));
  return cleaned;
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

export async function runDailyReportEmail(options: {
  date?: string;
  recipients?: string[];
  triggeredBy: 'manual' | 'cron' | 'test';
}) {
  const reportDate = options.date || formatIstDate();
  let recipients = options.recipients || DEFAULT_DAILY_REPORT_RECIPIENTS;
  let attachedPdfCount = 0;
  let attachmentNames: string[] = [];

  try {
    const [productsSnapshot, pricingSnapshot, settingsSnapshot, productionSnapshot, transferSnapshot] = await Promise.all([
      get(ref(db, PRODUCTS_PATH)),
      get(ref(db, PRODUCT_PRICING_PATH)),
      get(ref(db, DAILY_EMAIL_REPORT_SETTINGS_PATH)),
      get(ref(db, PRODUCTION_HISTORY_PATH)),
      get(ref(db, TRANSFER_HISTORY_PATH)),
    ]);

    const branches = normalizeBranchesFromFirebase(productsSnapshot.val());
    const pricing = normalizeProductPricingFromFirebase(pricingSnapshot.val());
    const productionHistory = normalizeProductionHistoryFromFirebase(productionSnapshot.val());
    const transferHistory = normalizeTransferHistoryFromFirebase(transferSnapshot.val());
    recipients = options.recipients || getRecipients(settingsSnapshot.val());
    if (recipients.length === 0) {
      throw new Error('No daily email report recipients configured.');
    }
    const reportPackage = createFullDailyReportPackage({
      branches,
      productionHistory,
      transferHistory,
      date: reportDate,
      pricing,
    });
    const attachments = reportPackage.attachments;
    attachedPdfCount = attachments.length;
    attachmentNames = attachments.map(attachment => attachment.filename);

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const resendResponse = await sendWithResend({ recipients, date: reportDate, attachments });
        await writeEmailReportLog({
          triggeredBy: options.triggeredBy,
          date: reportDate,
          time: new Date().toISOString(),
          status: 'success',
          attempt,
          recipientEmails: recipients,
          attachmentNames,
          attachedPdfCount,
          resendResponseId: typeof resendResponse?.id === 'string' ? resendResponse.id : undefined,
          resendResponse,
        });
        return {
          ok: true,
          date: reportDate,
          triggeredBy: options.triggeredBy,
          recipients,
          attachmentNames,
          attachedPdfCount,
          branchCount: reportPackage.salesReport.branches.length,
          branchesWithNoSales: reportPackage.salesReport.branches.filter(branch => branch.noSales).map(branch => branch.branchName),
          envDetected: {
            RESEND_API_KEY: Boolean(process.env.RESEND_API_KEY),
            RESEND_FROM_EMAIL: Boolean(process.env.RESEND_FROM_EMAIL),
            CRON_SECRET: Boolean(process.env.CRON_SECRET),
          },
          resendResponse,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await writeEmailReportLog({
          triggeredBy: options.triggeredBy,
          date: reportDate,
          time: new Date().toISOString(),
          status: 'failure',
          attempt,
          recipientEmails: recipients,
          attachmentNames,
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
        triggeredBy: options.triggeredBy,
        date: reportDate,
        time: new Date().toISOString(),
        status: 'failure',
        attempt: 1,
        recipientEmails: recipients,
        attachmentNames,
        attachedPdfCount,
        errorMessage,
      }).catch(logError => console.error('Failed to log email report error:', logError));
    }
    throw error;
  }

  throw new Error('Daily report email did not complete.');
}

export function isAuthorizedRequest(request: any, options: { allowVercelCronHeader?: boolean } = {}): boolean {
  const cronHeader = request.headers['x-vercel-cron'];
  const userAgent = String(request.headers['user-agent'] || '').toLowerCase();
  const expectedSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.authorization || request.headers.Authorization;
  const querySecret = request.query?.secret;

  if (expectedSecret && (authHeader === `Bearer ${expectedSecret}` || querySecret === expectedSecret)) return true;
  return options.allowVercelCronHeader === true && (cronHeader === '1' || userAgent.includes('vercel-cron'));
}
