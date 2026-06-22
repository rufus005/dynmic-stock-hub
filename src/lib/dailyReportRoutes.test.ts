import { beforeEach, describe, expect, it, vi } from 'vitest';
import cronHandler from '../../api/send-daily-report';
import manualHandler from '../../api/send-daily-report-now';
import { isAuthorizedRequest, runDailyReportEmail } from '../../api/_dailyReport';

vi.mock('../../api/_dailyReport', () => ({
  isAuthorizedRequest: vi.fn(() => true),
  runDailyReportEmail: vi.fn(async (options: { triggeredBy: string }) => ({
    ok: true,
    triggeredBy: options.triggeredBy,
    attachedPdfCount: 7,
  })),
}));

function createResponse() {
  return {
    statusCode: 200,
    payload: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.payload = payload;
      return this;
    },
  };
}

describe('daily email report API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isAuthorizedRequest).mockReturnValue(true);
    vi.mocked(runDailyReportEmail).mockResolvedValue({ ok: true, attachedPdfCount: 7 } as never);
  });

  it('manual send route works through the shared report function', async () => {
    const response = createResponse();

    await manualHandler(
      { method: 'POST', headers: { host: 'example.com', origin: 'https://example.com' } },
      response
    );

    expect(runDailyReportEmail).toHaveBeenCalledWith({ triggeredBy: 'manual' });
    expect(response.statusCode).toBe(200);
    expect(response.payload).toMatchObject({ ok: true, attachedPdfCount: 7 });
  });

  it('cron route uses the same shared report function', async () => {
    const response = createResponse();

    await cronHandler(
      { headers: { 'x-vercel-cron': '1' }, query: {} },
      response
    );

    expect(isAuthorizedRequest).toHaveBeenCalledWith(
      expect.objectContaining({ headers: expect.any(Object), query: {} }),
      { allowVercelCronHeader: true }
    );
    expect(runDailyReportEmail).toHaveBeenCalledWith({ date: undefined, triggeredBy: 'cron' });
    expect(response.statusCode).toBe(200);
    expect(response.payload).toMatchObject({ ok: true, attachedPdfCount: 7 });
  });
});
