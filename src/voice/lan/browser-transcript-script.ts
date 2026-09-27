// Adapted from the approved mobile preview model/view; no fixture or demo adapter.
export const LAN_VOICE_BROWSER_TRANSCRIPT_SCRIPT = String.raw`
class Transcript {
  constructor() { this.epoch = null; this.rows = new Map(); }
  reset(epoch) {
    if (typeof epoch !== 'string' || epoch.length > 100 || epoch === this.epoch) return false;
    this.epoch = epoch; this.rows.clear(); return true;
  }
  apply({ epoch, message: m }) {
    if (epoch !== this.epoch || !m || typeof m.messageId !== 'string' || m.messageId.length > 100 ||
        !Number.isSafeInteger(m.revision) || m.revision < 1 || !Number.isSafeInteger(m.seq) || m.seq < 1 ||
        !['user','assistant'].includes(m.role) || !['text','voice','pi'].includes(m.source) ||
        !['streaming','final'].includes(m.status) || typeof m.text !== 'string') return false;
    const previous = this.rows.get(m.messageId);
    if (previous && (m.seq !== previous.seq || m.revision <= previous.revision || (previous.status === 'final' && m.status !== 'final'))) return false;
    // IDs older than the retained window cannot resurrect evicted records.
    if (!previous && this.rows.size && m.seq <= this.list()[0].seq) return false;
    let text = m.text, bytes = new TextEncoder().encode(text);
    if (bytes.length > 16384) text = new TextDecoder('utf-8', {fatal:false}).decode(bytes.subarray(0,16380)).replace(/\uFFFD$/, '') + '…';
    this.rows.set(m.messageId, {messageId:m.messageId, seq:m.seq, revision:m.revision, role:m.role, source:m.source, status:m.status, text});
    const size = () => new TextEncoder().encode(JSON.stringify(this.list())).length;
    while (this.rows.size > 30 || size() > 131072) this.rows.delete(this.list()[0].messageId);
    return true;
  }
  list() { return [...this.rows.values()].sort((a,b) => a.seq-b.seq); }
}
function mountTranscript(root) {
  const $ = s => root.querySelector(s), history = $('#history'), messages = $('#messages'), bottom = $('#bottom'), older = $('#older');
  const model = new Transcript(); let unread = 0, visible = 10;
  const pinned = () => history.scrollHeight - history.clientHeight - history.scrollTop < 48;
  const anchor = () => { const top = history.getBoundingClientRect().top; const el = [...messages.children].find(e => e.getBoundingClientRect().bottom > top); return el ? [el.dataset.id, el.getBoundingClientRect().top] : null; };
  const restore = a => { const el = a && [...messages.children].find(e => e.dataset.id === a[0]); if (el) history.scrollTop += el.getBoundingClientRect().top - a[1]; };
  function render() {
    const rows = model.list();
    messages.replaceChildren(...rows.slice(-visible).map(m => {
      const el = document.createElement('article'); el.dataset.id = m.messageId; el.className = m.role;
      const text = document.createElement('p'); text.textContent = m.text; el.append(text);
      if (m.status !== 'final') { const status = document.createElement('small'); status.textContent = '正在回复…'; el.append(status); }
      return el;
    }));
    older.hidden = rows.length <= visible;
    bottom.hidden = unread === 0; bottom.textContent = '回到底部 · ' + unread + ' 次更新';
    $('#history-note').hidden = rows.length > 0;
  }
  const down = () => { history.scrollTop = history.scrollHeight; unread = 0; bottom.hidden = true; };
  older.onclick = () => { const a = anchor(); visible = Math.min(30, visible + 10); render(); restore(a); };
  bottom.onclick = down;
  history.addEventListener('scroll', () => { if (pinned()) { unread=0; bottom.hidden=true; } });
  render();
  return { handle(event) {
    if (event.type === 'transcript.epoch') {
      if (model.reset(event.epoch)) { visible=10; unread=0; render(); down(); }
    } else if (event.type === 'transcript.message') {
      const stay = pinned(), a = anchor(), isNew = !model.rows.has(event.message?.messageId);
      if (!model.apply(event)) return;
      if (!stay) { unread++; if (isNew) visible=Math.min(30,visible+1); }
      render(); if (stay) down(); else restore(a);
    }
  } };
}
`;
