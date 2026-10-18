/**
 * Email Routing catch-all entry point.
 * Until ingestion is implemented (Phase 3), every message is rejected so nothing is accepted silently.
 */
export async function handleEmail(
  message: ForwardableEmailMessage,
  _env: Env,
  _ctx: ExecutionContext,
): Promise<void> {
  message.setReject('Mailbox unavailable')
}
