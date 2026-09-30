// FloatView flip clock: builds the DOM once, then only flips the cards whose value changed.
//   const clock = new FlipClock(el, { hour12: false, seconds: true, date: 'short' });
//   clock.setTheme(theme);   // an entry from assets/themes/themes.json
//   clock.start();           // live time; or clock.show({ a: '24', b: '59', c: null, meta: 'FOCUS' }) for timers
(function (root) {
  const pad = (n) => String(n).padStart(2, '0');

  function card(small) {
    const el = document.createElement('div');
    el.className = 'fc-card' + (small ? ' fc-small' : '');
    el.innerHTML = '<div class="fc-half fc-top"><span></span></div><div class="fc-half fc-bottom"><span></span></div>'
      + '<div class="fc-flap fc-flap-top"><span></span></div><div class="fc-flap fc-flap-bottom"><span></span></div>';
    el._value = null;
    return el;
  }

  function setCard(el, value, animate) {
    if (el._value === value) return;
    const [top, bottom, flapTop, flapBottom] = el.querySelectorAll('span');
    const old = el._value ?? value;
    el._value = value;
    if (!animate || old === value) {
      top.textContent = bottom.textContent = flapTop.textContent = flapBottom.textContent = value;
      return;
    }
    // Static top shows the new value (revealed as the flap falls); static bottom keeps the old one until the flap lands.
    top.textContent = value;
    bottom.textContent = old;
    flapTop.textContent = old;
    flapBottom.textContent = value;
    el.classList.remove('flipping');
    void el.offsetWidth; // restart the animation
    el.classList.add('flipping');
    clearTimeout(el._t);
    el._t = setTimeout(() => {
      bottom.textContent = value;
      el.classList.remove('flipping');
    }, parseFloat(getComputedStyle(el).getPropertyValue('--fc-flip-ms')) || 520);
  }

  class FlipClock {
    constructor(el, opts = {}) {
      this.el = el;
      this.opts = { hour12: false, seconds: false, date: 'off', animate: true, ...opts };
      el.classList.add('fc');
      el.innerHTML = '';
      this.row = document.createElement('div');
      this.row.className = 'fc-row';
      this.cards = { a: card(false), b: card(false), c: card(true) };
      this.seps = [document.createElement('div'), document.createElement('div')];
      this.seps.forEach((s) => { s.className = 'fc-sep'; s.innerHTML = '<i></i><i></i>'; });
      this.ampm = document.createElement('div');
      this.ampm.className = 'fc-ampm';
      this.row.append(this.cards.a, this.seps[0], this.cards.b, this.seps[1], this.cards.c, this.ampm);
      this.meta = document.createElement('div');
      this.meta.className = 'fc-meta';
      el.append(this.row, this.meta);
      this._timer = null;
    }

    setTheme(t) {
      const s = this.el.style;
      const c = t.colors || {};
      this.el.dataset.kind = t.kind || 'flip';
      this.el.dataset.theme = t.id;
      s.setProperty('--fc-font', `'${t.font.family}', monospace`);
      s.setProperty('--fc-weight', t.font.weight);
      s.setProperty('--fc-tracking', t.font.tracking || '0');
      const map = { digit: '--fc-digit', cardTop: '--fc-card-top', cardBottom: '--fc-card-bottom', hinge: '--fc-hinge',
        accent: '--fc-accent', muted: '--fc-muted' };
      for (const [k, v] of Object.entries(map)) if (c[k]) s.setProperty(v, c[k]);
      s.setProperty('--fc-glow', c.glow || 'none');
      s.setProperty('--fc-scale', t.font.scale || 1);
      if (t.font.metaFamily) s.setProperty('--fc-meta-font', `'${t.font.metaFamily}', sans-serif`); else s.removeProperty('--fc-meta-font');
      if (c.meta) s.setProperty('--fc-meta', c.meta); else s.removeProperty('--fc-meta');
      this.el.dataset.sep = t.separator || (t.kind === 'flip' ? 'none' : 'colon');
      s.setProperty('--fc-shadow', t.card?.shadow || 'none');
      s.setProperty('--fc-r', t.card?.radius ?? 0.08);
    }

    // Values for the 3 cards (c = small seconds card, or null to hide it) plus a meta line.
    show({ a, b, c = null, ampm = '', meta = '' }) {
      const animate = this.opts.animate && this._shown;
      setCard(this.cards.a, a, animate);
      setCard(this.cards.b, b, animate);
      const hasC = c !== null;
      this.cards.c.hidden = !hasC;
      this.seps[1].hidden = !hasC;
      if (hasC) setCard(this.cards.c, c, animate);
      this.ampm.textContent = ampm;
      this.ampm.hidden = !ampm;
      if (this.meta.innerHTML !== meta) this.meta.innerHTML = meta;
      this.meta.hidden = !meta;
      this._shown = true;
    }

    tick(now = new Date()) {
      let h = now.getHours();
      let ampm = '';
      if (this.opts.hour12) { ampm = h < 12 ? 'AM' : 'PM'; h = h % 12 || 12; }
      const d = this.opts.date;
      const meta = d === 'off' ? '' : now.toLocaleDateString('en-US', d === 'full'
        ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
        : { weekday: 'short', day: 'numeric', month: 'short' });
      this.show({ a: pad(h), b: pad(now.getMinutes()), c: this.opts.seconds ? pad(now.getSeconds()) : null, ampm, meta });
    }

    start() {
      this.stop();
      const loop = () => {
        this.tick();
        this._timer = setTimeout(loop, 1000 - (Date.now() % 1000) + 5); // align to the second
      };
      loop();
    }

    stop() { clearTimeout(this._timer); }
  }

  root.FlipClock = FlipClock;
})(typeof window !== 'undefined' ? window : globalThis);
