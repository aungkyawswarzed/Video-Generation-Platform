// The server cannot outlive the desktop process, including after an unexpected desktop crash.
process.on('disconnect', () => process.exit(0));
process.on('message', (message) => {
  if (message?.type === 'shutdown') process.exit(0);
});
import('./web/server.js').catch((error) => {
  console.error(error);
  process.exit(1);
});
