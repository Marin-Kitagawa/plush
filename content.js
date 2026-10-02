/*  Plush · content script
    volume boost (Web Audio) · locked playback speed · regex find  */

(() => {
  if (window.__plush) return;
  Object.defineProperty(window, '__plush', { value: true });

  const IS_TOP = window === window.top;

  /* ---------------- shared state ---------------- */
  let boost = 1;   // gain multiplier (1 = untouched)
  let speed = 1;   // locked playback rate (1 = hands off)

  const graphs   = new WeakMap();  // media el -> { ctx, gain } | { failed }
  const contexts = new Set();
  const watched  = new WeakSet();

  /* ---------- discovery (incl. open shadow roots) ---------- */
  function findMedia(root, out = []) {
    try {
      if (root instanceof Element && /^(VIDEO|AUDIO)$/.test(root.tagName)) out.push(root);
      if (root.querySelectorAll) {
        root.querySelectorAll('video, audio').forEach(el => out.push(el));
        root.querySelectorAll('*').forEach(el => { if (el.shadowRoot) findMedia(el.shadowRoot, out); });
      }
    } catch (e) { /* odd documents — shrug */ }
    return out;
  }

  /* sites love to snap playbackRate back; we snap it forward */
  function watch(el) {
    if (watched.has(el)) return;
    watched.add(el);
    el.addEventListener('ratechange', () => {
      if (speed === 1) return;
      if (Math.abs(el.playbackRate - speed) > 0.01) {
        try { el.playbackRate = speed; } catch (e) {}
      }
    });
  }

  function boostEl(el) {
    if (boost <= 1.001) {
      const g = graphs.get(el);
      if (g && g.gain) g.gain.gain.value = 1;
      return;
    }
    let g = graphs.get(el);
    if (!g) {
      try {
        const ctx  = new (window.AudioContext || window.webkitAudioContext)();
        const src  = ctx.createMediaElementSource(el);
        const gain = ctx.createGain();
        src.connect(gain).connect(ctx.destination);
        g = { ctx, gain };
        graphs.set(el, g);
        contexts.add(ctx);
      } catch (e) {
        graphs.set(el, { failed: true });
        return;
      }
    }
    if (g.gain) {
      g.gain.gain.value = boost;
      if (g.ctx.state === 'suspended') g.ctx.resume().catch(() => {});
    }
  }

  function touch(el) {
    watch(el);
    boostEl(el);
    if (speed !== 1 && Math.abs(el.playbackRate - speed) > 0.01) {
      try { el.playbackRate = speed; } catch (e) {}
    }
  }

  function scanAll() { findMedia(document).forEach(touch); }

  /* keep up with the page */
  let moTimer;
  new MutationObserver(muts => {
    if (!muts.some(m => m.addedNodes.length)) return;
    clearTimeout(moTimer);
    moTimer = setTimeout(() => {
      const fresh = [];
      muts.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1) findMedia(n, fresh); }));
      fresh.forEach(touch);
    }, 250);
  }).observe(document.documentElement, { childList: true, subtree: true });

  /* gentle safety net */
  setInterval(() => document.querySelectorAll('video, audio').forEach(touch), 3000);

  /* browsers suspend audio contexts until a gesture — pounce on one */
  const wake = () => contexts.forEach(c => c.state === 'suspended' && c.resume().catch(() => {}));
  ['pointerdown', 'keydown', 'touchstart'].forEach(t =>
    document.addEventListener(t, wake, { capture: true, passive: true }));

  scanAll();

  /* ---------------- toolbar badge ---------------- */
  function reportBadge() {
    if (!IS_TOP) return;
    let text = '';
    if (boost > 1.001)    text = Math.round(boost * 100) + '%';
    else if (speed !== 1) text = (Math.round(speed * 100) / 100) + '\u00d7';
    try { chrome.runtime.sendMessage({ type: 'badge', text }); } catch (e) {}
  }

  /* ---------------- regex find (top frame only) ---------------- */
  const find = (() => {
    if (!IS_TOP) return { open: () => ({ ok: false }) };

    const MAX_MATCHES = 2000, MAX_RECTS = 6000;
    const SKIP = new Set(['SCRIPT','STYLE','NOSCRIPT','TEXTAREA','TEMPLATE','IFRAME',
                          'OBJECT','EMBED','SVG','MATH','CANVAS','HEAD','TITLE','OPTION','SELECT']);

    let bar, input, info, err, layer, caseBtn;
    let ranges = [], marks = [], byRange = [];
    let idx = -1, caseOn = false, trunc = false;
    let tInput = 0, tReflow = 0;

    const HEART = '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>';
    const PREV  = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>';
    const NEXT  = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>';
    const CLOSE = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

    const CSS = `
      #plush-hl-layer{position:absolute;left:0;top:0;width:0;height:0;overflow:visible;pointer-events:none;z-index:2147483646;}
      .plush-hl{position:absolute;background:rgba(222,124,105,.34);border-radius:3px;mix-blend-mode:multiply;border:0;margin:0;padding:0;}
      .plush-hl-on{background:rgba(236,183,94,.75);box-shadow:0 0 0 1.5px rgba(180,87,74,.55);}
      #plush-bar{position:fixed;right:18px;bottom:18px;z-index:2147483647;width:322px;background:#FFFDF8;
        border:1.5px solid #F0D3C5;border-radius:18px;padding:12px 14px 9px;line-height:1.4;text-align:left;
        box-shadow:0 14px 40px rgba(96,52,42,.26),0 3px 10px rgba(96,52,42,.13);
        color:#4A342E;font-family:'Quicksand',ui-rounded,'Trebuchet MS',sans-serif;font-size:13px;
        animation:plushPop .3s cubic-bezier(.2,1.4,.4,1);}
      #plush-bar *{box-sizing:border-box;margin:0;padding:0;font-family:inherit;letter-spacing:normal;}
      @keyframes plushPop{from{transform:translateY(12px) scale(.95);opacity:0;}to{transform:none;opacity:1;}}
      .plush-row{display:flex;align-items:center;gap:6px;margin-bottom:9px;}
      .plush-logo{display:grid;place-items:center;width:22px;height:22px;color:#D97A6C;}
      .plush-title{font-family:'Fraunces',Georgia,serif;font-style:italic;font-weight:600;font-size:16px;margin-right:auto;}
      .plush-ic{display:grid;place-items:center;min-width:27px;height:27px;padding:0 6px;border-radius:10px;
        border:1.5px solid #F0D3C5;background:#F7E4D9;color:#8A6A5F;font-size:11.5px;font-weight:700;cursor:pointer;
        transition:transform .15s,background .15s,color .15s,border-color .15s;}
      .plush-ic:hover{border-color:#D97A6C;color:#B4574A;transform:translateY(-1px);}
      .plush-ic.on{background:#D97A6C;border-color:#D97A6C;color:#fff;}
      #plush-in{width:100%;padding:9px 12px;border-radius:12px;border:1.5px solid #F0D3C5;background:#F7E4D9;
        color:#4A342E;font-size:13.5px;font-weight:600;outline:none;transition:border-color .16s,background .16s,box-shadow .16s;}
      #plush-in:focus{border-color:#D97A6C;background:#fff;box-shadow:0 0 0 3.5px rgba(217,122,108,.16);}
      #plush-in::placeholder{color:#C7A89A;}
      .plush-foot{display:flex;align-items:baseline;margin-top:8px;min-height:15px;}
      #plush-info{margin-left:auto;font-size:11.5px;font-weight:700;color:#B4574A;}
      #plush-err{margin-left:auto;font-size:10.5px;font-weight:600;color:#C0564A;max-width:270px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    `;

    function ensure() {
      if (bar) return;

      /* adopted stylesheets slip past page CSP; fall back to a <style> tag */
      try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(CSS);
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      } catch (e) {
        const st = document.createElement('style');
        st.textContent = CSS;
        (document.head || document.documentElement).appendChild(st);
      }

      try {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@1,9..144,600&family=Quicksand:wght@500;600;700&display=swap';
        (document.head || document.documentElement).appendChild(link);
      } catch (e) {}

      layer = document.createElement('div');
      layer.id = 'plush-hl-layer';
      document.documentElement.appendChild(layer);

      bar = document.createElement('div');
      bar.id = 'plush-bar';
      bar.hidden = true;
      bar.innerHTML =
        '<div class="plush-row">' +
          '<span class="plush-logo">' + HEART + '</span>' +
          '<span class="plush-title">plush find</span>' +
          '<button class="plush-ic" data-a="case" title="match case">Aa</button>' +
          '<button class="plush-ic" data-a="prev" title="previous (shift + enter)">' + PREV + '</button>' +
          '<button class="plush-ic" data-a="next" title="next (enter)">' + NEXT + '</button>' +
          '<button class="plush-ic" data-a="close" title="close (esc)">' + CLOSE + '</button>' +
        '</div>' +
        '<input id="plush-in" placeholder="regex \u2014 try \\d{4} or /colou?r/i" spellcheck="false">' +
        '<div class="plush-foot"><span id="plush-info">type a pattern \u00b7 enter jumps</span><span id="plush-err" hidden></span></div>';
      document.documentElement.appendChild(bar);

      input   = bar.querySelector('#plush-in');
      info    = bar.querySelector('#plush-info');
      err     = bar.querySelector('#plush-err');
      caseBtn = bar.querySelector('[data-a="case"]');

      bar.addEventListener('click', e => {
        const b = e.target.closest('[data-a]');
        if (!b) return;
        e.preventDefault();
        const a = b.dataset.a;
        if (a === 'next') step(1);
        else if (a === 'prev') step(-1);
        else if (a === 'close') hide();
        else if (a === 'case') { caseOn = !caseOn; caseBtn.classList.toggle('on', caseOn); run(); }
        input.focus();
      });

      input.addEventListener('input', () => { clearTimeout(tInput); tInput = setTimeout(run, 160); });
      input.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
        else if (e.key === 'Escape') { e.preventDefault(); hide(); }
      });

      addEventListener('resize', () => {
        clearTimeout(tReflow);
        tReflow = setTimeout(() => { if (!bar.hidden && input.value) run(); }, 200);
      });

      /* page reflowed under us? re-measure (ignoring our own highlight nodes) */
      new MutationObserver(muts => {
        if (bar.hidden || !input.value) return;
        if (muts.every(m => layer.contains(m.target) || bar.contains(m.target))) return;
        clearTimeout(tReflow);
        tReflow = setTimeout(run, 350);
      }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    }

    function clearMarks() {
      marks.forEach(d => d.remove());
      marks = []; ranges = []; byRange = [];
    }

    function run() {
      clearMarks();
      err.hidden = true; info.hidden = false;
      trunc = false; idx = -1;

      const raw = input.value.trim();
      if (!raw) { info.textContent = 'type a pattern \u00b7 enter jumps'; return; }

      let re;
      try {
        let src = raw, fl = caseOn ? 'i' : '';
        const lit = raw.match(/^\/(.*)\/([dgimsuvy]*)$/s);   /* /pattern/flags form */
        if (lit) { src = lit[1]; fl += lit[2]; }
        fl = [...new Set((fl + 'g').split(''))].filter(f => f !== 'y').join('');
        re = new RegExp(src, fl);
      } catch (e) {
        info.hidden = true; err.hidden = false;
        err.textContent = e.message.replace(/^Invalid regular expression:\s*/, '');
        return;
      }

      const sx = scrollX, sy = scrollY;
      const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT, {
        acceptNode(n) {
          const p = n.parentElement;
          if (!p || SKIP.has(p.tagName) || (p.closest && p.closest('#plush-bar'))) return NodeFilter.FILTER_REJECT;
          return n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
      });

      const frag = document.createDocumentFragment();
      let rectCount = 0, node;

      outer:
      while ((node = walker.nextNode())) {
        const text = node.nodeValue;
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(text))) {
          if (!m[0]) { re.lastIndex++; continue; }
          const r = document.createRange();
          try { r.setStart(node, m.index); r.setEnd(node, m.index + m[0].length); } catch (e) { break; }
          ranges.push(r); byRange.push([]);
          for (const cr of r.getClientRects()) {
            if (cr.width < 0.5 && cr.height < 0.5) continue;
            const d = document.createElement('div');
            d.className = 'plush-hl';
            d.style.left   = (cr.left + sx) + 'px';
            d.style.top    = (cr.top  + sy) + 'px';
            d.style.width  = cr.width  + 'px';
            d.style.height = cr.height + 'px';
            frag.appendChild(d); marks.push(d); byRange[byRange.length - 1].push(d);
            if (++rectCount >= MAX_RECTS) { trunc = true; break outer; }
          }
          if (ranges.length >= MAX_MATCHES) { trunc = true; break outer; }
        }
      }
      layer.appendChild(frag);

      if (ranges.length) { idx = 0; paint(); }
      else info.textContent = 'no matches \u2014 try a softer pattern';
    }

    function paint() {
      byRange.forEach(a => a.forEach(d => d.classList.remove('plush-hl-on')));
      (byRange[idx] || []).forEach(d => d.classList.add('plush-hl-on'));
      info.textContent = (idx + 1) + ' / ' + (trunc ? MAX_MATCHES + '+' : ranges.length);
    }

    function step(dir) {
      if (!ranges.length) return;
      idx = (idx + dir + ranges.length) % ranges.length;
      paint();
      const cr = ranges[idx].getClientRects()[0];
      if (cr) scrollTo({ top: Math.max(0, cr.top + scrollY - innerHeight * 0.38), behavior: 'smooth' });
    }

    function open(pattern) {
      ensure();
      bar.hidden = false;
      if (typeof pattern === 'string') input.value = pattern;
      input.focus();
      if (input.value) run();
      return { ok: true, count: ranges.length };
    }

    function hide() {
      if (!bar || bar.hidden) return;
      bar.hidden = true;
      clearMarks();
      input.blur();
      try { chrome.storage.local.set({ findPattern: input.value }); } catch (e) {}
    }

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && bar && !bar.hidden) hide();
    }, true);

    return { open };
  })();

  /* Ctrl/Cmd + F belongs to Plush now — that was the promise */
  document.addEventListener('keydown', e => {
    if (IS_TOP && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'f' || e.key === 'F')) {
      e.preventDefault();
      e.stopPropagation();
      find.open();
    }
  }, true);

  /* ---------------- messages from the popup ---------------- */
  chrome.runtime.onMessage.addListener((msg, sender, respond) => {
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case 'hello':
        if (IS_TOP) respond({ ok: true, boost: Math.round(boost * 100), speed });
        break;
      case 'boost': {
        boost = Math.min(6, Math.max(0, (Number(msg.value) || 100) / 100));
        wake();
        scanAll();
        reportBadge();
        break;
      }
      case 'speed': {
        speed = Math.min(16, Math.max(0.0625, Number(msg.value) || 1));
        if (speed === 1) findMedia(document).forEach(el => { try { el.playbackRate = 1; } catch (e) {} });
        scanAll();
        reportBadge();
        break;
      }
      case 'find':
        if (IS_TOP) respond(find.open(msg.pattern));
        break;
    }
  });
})();
