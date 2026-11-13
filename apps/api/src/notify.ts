import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { env } from './env.ts';

const ses = new SESv2Client({});

export interface Recipient {
  email: string;
  pushTokens: string[];
}

/**
 * Sends an update by email and, where the person has the mobile app, by push
 * notification. Failures are logged and never block the request that caused
 * the notification.
 */
export async function notify(recipients: Recipient[], title: string, body: string, data: Record<string, string> = {}): Promise<void> {
  const jobs: Promise<unknown>[] = [];

  if (env.EMAIL_FROM) {
    for (const { email } of recipients) {
      jobs.push(
        ses.send(
          new SendEmailCommand({
            FromEmailAddress: env.EMAIL_FROM,
            Destination: { ToAddresses: [email] },
            Content: { Simple: { Subject: { Data: title }, Body: { Text: { Data: body } } } },
          }),
        ),
      );
    }
  }

  const tokens = recipients.flatMap((r) => r.pushTokens);
  if (tokens.length > 0) {
    // Expo's push service delivers to both iOS and Android.
    jobs.push(
      fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tokens.map((to) => ({ to, title, body, data, sound: 'default' }))),
      }),
    );
  }

  const results = await Promise.allSettled(jobs);
  for (const result of results) {
    if (result.status === 'rejected') console.error('Notification failed', result.reason);
  }
}
