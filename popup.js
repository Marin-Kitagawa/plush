/* Plush · popup logic */

const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const boostSlider = $('#boost'), speedSlider = $('#speed');
const boostVal = $('#boostVal'), speedVal = $('#speedVal');
const pat = $('#pattern');

let tabId = null, alive = false, tSend = 0;

const sendAll = msg => { if (tabId != null) chrome.tabs.sendMessage(tabId, msg).catch(() => {}); };
const sendTop = msg => chrome.tabs.sendMessage(tabId, msg, { frameId: 0 }).catch(() => {});

function pop(el) {
  el.animate(
    [{ transform: 'scale(1.16)' }, { transform: 'scale(1)' }],
    { duration: 240, easing: 'cubic-bezier(.2,1.7,.45,1)' }
  );
}

function paintBoost(v, animate) {
  boostSlider.value = v;
  boostSlider.style.setProperty('--fill', ((v - 100) / 5) + '%');
  boostVal.firstChild.nodeValue = v;
  $$('#boostChips button').forEach(b => b.classList.toggle('on', +b.dataset.v === v));
  /* steam gets livelier as the volume climbs */
  document.documentElement.style.setProperty('--steam-d', (3.6 - (v - 100) / 500 * 2.5).toFixed(2) + 's');
  if (animate) pop(boostVal);
}

function paintSpeed(v, animate) {
  speedSlider.value = v;
  speedSlider.style.setProperty('--fill', ((v - 0.25) / 15.75 * 100) + '%');
  speedVal.firstChild.nodeValue = v.toFixed(2);
  $$('#speedChips button').forEach(b => b.classList.toggle('on', +b.dataset.v === v));
  /* the pressed flower whirls at the chosen tempo */
  document.documentElement.style.setProperty('--dur', Math.max(0.32, 11 / v).toFixed(2) + 's');
  if (animate) pop(speedVal);
}

boostSlider.addEventListener('input', () => {
  const v = +boostSlider.value;
  paintBoost(v, true);
  clearTimeout(tSend);
  tSend = setTimeout(() => sendAll({ type: 'boost', value: v }), 60);
});

speedSlider.addEventListener('input', () => {
  const v = +speedSlider.value;
  paintSpeed(v, true);
  clearTimeout(tSend);
  tSend = setTimeout(() => sendAll({ type: 'speed', value: v }), 60);
});

 $('#boostChips').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  paintBoost(+b.dataset.v, true);
  sendAll({ type: 'boost', value: +b.dataset.v });
});

 $('#speedChips').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  paintSpeed(+b.dataset.v, true);
  sendAll({ type: 'speed', value: +b.dataset.v });
});

function findNow() {
  const p = pat.value.trim();
  if (!p || !alive) return;
  try { chrome.storage.local.set({ findPattern: p }); } catch (e) {}
  sendTop({ type: 'find', pattern: p });
  setTimeout(() => window.close(), 160);
}

 $('#go').addEventListener('click', findNow);
pat.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); findNow(); } });

(async () => {
  try {
    const { findPattern } = await chrome.storage.local.get('findPattern');
    if (findPattern) pat.value = findPattern;
  } catch (e) {}

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab && tab.id;
    const st = await chrome.tabs.sendMessage(tabId, { type: 'hello' }, { frameId: 0 });
    if (st && st.ok) {
      alive = true;
      paintBoost(st.boost, false);
      paintSpeed(st.speed, false);
      return;
    }
  } catch (e) {}

  document.body.classList.add('nap');
  $('#statusTxt').textContent = 'napping';
  $('#nap').hidden = false;
})();
