(() => {
  if (location.origin !== 'https://dev--merry-chimera-49a1f3.netlify.app') return;
  let busy = false, again = false;
  async function refresh() {
    if (document.hidden || navigator.onLine===false || !['ADMIN','SUPER_ADMIN','ATENDENTE'].includes(document.body.dataset.sessionRole) || ![...document.querySelectorAll('[data-notification-count]')].some(el=>!el.closest('details:not([open])')&&el.getClientRects().length)) return; if (busy) { again = true; return; } busy = true;
    try {
      const response = await fetch('/api/v1/notifications/summary',{credentials:'same-origin',cache:'no-store'});
      if (!response.ok) { document.querySelectorAll('[data-notification-count]').forEach(el => el.textContent=''); return; } const { data } = await response.json();
      if (!Number.isSafeInteger(data?.unread) || data.unread < 0) return;
      document.querySelectorAll('[data-notification-count]').forEach(el => {el.textContent=data.unread ? '('+data.unread+')':'';});
    } catch {} finally { busy=false; if (again) {again=false;refresh();} }
  }
  refresh(); window.addEventListener('focus',refresh); window.addEventListener('online',refresh);window.addEventListener('livraria:stock-changed',refresh);window.addEventListener('livraria:schedule-changed',refresh);window.addEventListener('livraria:notifications-changed',refresh);setInterval(refresh,60000);
})();
