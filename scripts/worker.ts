import { db, jobs, patchJob, transaction, setSetting } from '../src/lib/db';
import { processJob } from '../src/lib/worker';
import { stopMediaProcesses } from '../src/lib/export';

let stopping = false;
process.on('SIGINT', () => {
  stopping = true;
});
process.on('SIGTERM', () => {
  stopping = true;
});
process.on('message', (message) => {
  if (message && typeof message === 'object' && 'type' in message && message.type === 'shutdown')
    stopping = true;
});
process.on('disconnect', () => {
  stopMediaProcesses();
  process.exit(0);
});
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

console.log(
  'Frame worker running. Durable local queue; generation submissions are never automatically retried.',
);
if (process.send) process.send({ type: 'ready' });
async function main() {
  while (!stopping) {
    try {
      setSetting('workerHeartbeat', String(Date.now()));
      const job = transaction(() => {
        const all = jobs();
        for (const j of all) {
          if (
            ['submitting', 'rendering'].includes(j.status) &&
            Date.now() - (j.heartbeat || Date.parse(j.updatedAt)) > 120000
          ) {
            patchJob(j.id, {
              status: j.kind === 'export' ? 'failed' : 'submission_unknown',
              error:
                'Worker interrupted. Generation submissions are not automatically retried; reconcile using the provider job ID.',
            });
          }
        }
        // Only one worker owns a processing lease at a time. Expired leases recover after a crash.
        const leaseRow = db.prepare('SELECT value FROM settings WHERE key=?').get('workerLease') as
          { value: string } | undefined;
        if (leaseRow && Number(leaseRow.value) > Date.now()) return;
        const candidate = all
          .reverse()
          .find(
            (j) =>
              j.status === 'queued' ||
              (['generating', 'downloading'].includes(j.status) && j.nextPollAt <= Date.now()),
          );
        if (!candidate) return;
        setSetting('workerLease', String(Date.now() + 120000));
        return patchJob(candidate.id, {
          status:
            candidate.status === 'queued'
              ? candidate.kind === 'export'
                ? 'rendering'
                : 'submitting'
              : candidate.status,
          heartbeat: Date.now(),
        });
      });
      if (job) {
        const heartbeat = setInterval(() => {
          setSetting('workerHeartbeat', String(Date.now()));
          setSetting('workerLease', String(Date.now() + 120000));
          patchJob(job.id, { heartbeat: Date.now() });
        }, 10000);
        try {
          await processJob(job);
        } finally {
          clearInterval(heartbeat);
          setSetting('workerLease', '0');
        }
      }
    } catch (e) {
      console.error('Worker:', (e as Error).message);
    }
    await sleep(2000);
  }
  console.log('Worker stopped.');
  if (process.connected) process.disconnect();
}
void main();
