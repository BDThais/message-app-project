import { describe, expect, it } from 'vitest';
import { getMailer } from '../../src/lib/mailer';
import { outbox } from '../helpers/mailer';

// Not a test of the app: it guards the wiring in test/setup.ts that every
// later mail test relies on. The two tests depend on running in this order.
describe('the test setup mail outbox', () => {
  it('is the app mailer, and keeps what is sent', async () => {
    await getMailer().send({ to: 'a@example.com', subject: 'Hello', text: 'Body' });

    expect(outbox.sent).toEqual([{ to: 'a@example.com', subject: 'Hello', text: 'Body' }]);
  });

  it('is emptied before every test', () => {
    expect(outbox.sent).toEqual([]);
  });
});
