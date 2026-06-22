import { useEffect, useMemo, useState } from 'react';
import AppLayout from '@/components/AppLayout';
import { useData } from '@/contexts/DataContext';
import { Mail, Plus, Save, Send, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export default function AdminSettingsPage() {
  const { dailyEmailRecipients, updateDailyEmailRecipients } = useData();
  const [recipients, setRecipients] = useState<string[]>(dailyEmailRecipients);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendMessage, setSendMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    setRecipients(dailyEmailRecipients);
  }, [dailyEmailRecipients]);

  const validationMessage = useMemo(() => {
    if (recipients.length === 0) return 'At least one recipient is required.';
    const invalid = recipients.find(email => !isValidEmail(email));
    return invalid ? `Invalid email: ${invalid}` : '';
  }, [recipients]);

  const updateRecipient = (index: number, value: string) => {
    setRecipients(current => current.map((email, itemIndex) => itemIndex === index ? value : email));
  };

  const addRecipient = () => {
    setRecipients(current => [...current, '']);
  };

  const removeRecipient = (index: number) => {
    setRecipients(current => current.filter((_, itemIndex) => itemIndex !== index));
  };

  const saveRecipients = async () => {
    if (validationMessage) {
      toast.error(validationMessage);
      return;
    }

    setSaving(true);
    try {
      await updateDailyEmailRecipients(recipients);
      toast.success('Daily email recipients updated.');
    } catch (error) {
      console.error('Failed to update email recipients:', error);
      toast.error('Unable to update recipients. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const sendEmailNow = async () => {
    const configuredRecipients = dailyEmailRecipients.filter(isValidEmail);
    if (configuredRecipients.length === 0) {
      const message = 'Add and save at least one valid recipient before sending.';
      setSendMessage({ type: 'error', text: message });
      toast.error(message);
      return;
    }

    setSending(true);
    setSendMessage(null);
    try {
      const response = await fetch('/api/send-daily-report-now', { method: 'POST' });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || `Request failed with ${response.status}`);
      }
      const text = `Email sent to ${payload.recipients?.join(', ') || configuredRecipients.join(', ')} with ${payload.attachedPdfCount} PDFs.`;
      setSendMessage({ type: 'success', text });
      toast.success('Daily email report sent.');
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Unable to send daily report.';
      setSendMessage({ type: 'error', text });
      toast.error(text);
    } finally {
      setSending(false);
    }
  };

  return (
    <AppLayout title="Admin Settings">
      <div className="space-y-6">
        <div className="glass-card rounded-xl p-5">
          <div className="flex items-center justify-between gap-4 mb-4">
            <div>
              <h3 className="font-semibold flex items-center gap-2">
                <Mail className="w-5 h-5 text-primary" />
                Daily Email Reports
              </h3>
              <p className="text-sm text-muted-foreground mt-1">Reports are sent daily at 11:00 PM IST.</p>
            </div>
            <button
              onClick={addRecipient}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-muted/50 text-foreground text-sm font-medium hover:bg-muted transition-colors"
            >
              <Plus className="w-4 h-4" /> Add Email
            </button>
          </div>

          <div className="space-y-3">
            {recipients.map((email, index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  type="email"
                  value={email}
                  onChange={event => updateRecipient(index, event.target.value)}
                  className="flex-1 px-3 py-2 rounded-lg bg-muted/50 border border-border outline-none focus:border-primary text-foreground text-sm"
                  placeholder="recipient@example.com"
                />
                <button
                  onClick={() => removeRecipient(index)}
                  className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  aria-label="Remove recipient"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>

          {validationMessage && <p className="text-sm text-destructive mt-3">{validationMessage}</p>}

          <div className="flex justify-end mt-5">
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={sendEmailNow}
                disabled={sending}
                className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg border border-border bg-muted/50 text-foreground font-medium text-sm hover:bg-muted transition-colors disabled:opacity-50"
              >
                <Send className="w-4 h-4" /> {sending ? 'Sending...' : 'Send Email Now'}
              </button>
              <button
                onClick={saveRecipients}
                disabled={saving || Boolean(validationMessage)}
                className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg gradient-primary text-primary-foreground font-medium text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save Settings'}
              </button>
            </div>
          </div>
          {sendMessage && (
            <p className={`text-sm mt-3 ${sendMessage.type === 'success' ? 'text-emerald-600' : 'text-destructive'}`}>
              {sendMessage.text}
            </p>
          )}
        </div>

        <div className="glass-card rounded-xl p-5">
          <h3 className="font-semibold mb-2">Server Environment</h3>
          <p className="text-sm text-muted-foreground">
            Configure <span className="font-mono text-foreground">RESEND_API_KEY</span>, <span className="font-mono text-foreground">RESEND_FROM_EMAIL</span>, and <span className="font-mono text-foreground">CRON_SECRET</span> in the deployment environment.
          </p>
        </div>
      </div>
    </AppLayout>
  );
}
