export const LAN_VOICE_BROWSER_EVENTS_SCRIPT = String.raw `
function connectBrowserEvents({ clientId, connection, activityState, transcript, composer, audio }) {
  const events = new EventSource('/api/events?client=' + encodeURIComponent(clientId));
  events.onopen = () => {
    connection.classList.add('online');
    connection.lastElementChild.textContent = 'Connected';
  };
  events.onerror = () => {
    connection.classList.remove('online');
    connection.lastElementChild.textContent = 'Reconnecting';
  };
  events.onmessage = (event) => {
    try {
      const command = JSON.parse(event.data);
      audio.handleServerCommand(command);
      transcript.handle(command);
      if (command.type === 'draft') composer.applyDraft(command);
      if (command.type === 'sent') composer.markSent();
      if (command.type === 'activity') activityState.textContent = command.state === 'working' ? 'Working…' : '';
    } catch {}
  };
  return events;
}
`;
