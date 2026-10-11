/* Clarity Journal admin — tiny SVG charts.
   Line/area and bar charts with a recessive grid, one y-axis, thin marks,
   a hover crosshair + tooltip, and a screen-reader table. No dependencies. */
(function(){
  const NS = 'http://www.w3.org/2000/svg';
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || v;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function niceMax(v){
    if(v <= 0) return 4;
    const exp = Math.pow(10, Math.floor(Math.log10(v)));
    const f = v / exp;
    const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
    const m = nf * exp;
    return m < 4 && Number.isInteger(v) ? 4 : m;
  }
  const compact = (n) => n >= 1e6 ? (n/1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/,'') + 'M'
    : n >= 1e3 ? (n/1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/,'') + 'k' : String(Math.round(n * 100) / 100);

  /* opts: { data:[{...}], x:'key', series:[{key,label,color}], type:'line'|'area'|'bar',
             xFormat(v), tipTitle(d), yFormat(n), height } */
  function render(el, opts){
    el.__chart = opts;
    if(!el.__ro){
      el.__ro = new ResizeObserver(() => draw(el));
      el.__ro.observe(el);
    }
    draw(el);
  }

  function draw(el){
    const o = el.__chart; if(!o) return;
    const W = el.clientWidth, H = el.clientHeight;
    if(!W || !H) return;
    const data = o.data || [];
    const series = o.series;
    const stacked = o.type === 'bar' && o.stacked;
    const vals = data.map(d => stacked ? series.reduce((a,s) => a + (+d[s.key] || 0), 0) : Math.max(0, ...series.map(s => +d[s.key] || 0)));
    const yMax = niceMax(Math.max(0, ...vals));
    const fmtY = o.yFormat || compact;
    const yTicks = 4;
    const tickLabels = Array.from({length: yTicks + 1}, (_, i) => fmtY(yMax / yTicks * i));
    const padL = Math.max(...tickLabels.map(t => t.length)) * 6.6 + 10;
    const pad = {t: 8, r: 6, b: 24, l: padL};
    const iw = Math.max(10, W - pad.l - pad.r), ih = Math.max(10, H - pad.t - pad.b);
    const n = data.length;
    const isBar = o.type === 'bar';
    const band = n ? iw / n : iw;
    const xAt = (i) => isBar ? pad.l + band * i + band / 2 : pad.l + (n <= 1 ? iw / 2 : iw * i / (n - 1));
    const yAt = (v) => pad.t + ih - (v / yMax) * ih;

    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.label || '')}">`;
    // grid + y labels
    s += '<g class="axis">';
    for(let i = 0; i <= yTicks; i++){
      const y = Math.round(yAt(yMax / yTicks * i)) + .5;
      s += `<line class="${i === 0 ? 'baseline' : 'gridline'}" x1="${pad.l}" x2="${W - pad.r}" y1="${y}" y2="${y}"/>`;
      s += `<text x="${pad.l - 8}" y="${y + 3.5}" text-anchor="end">${esc(tickLabels[i])}</text>`;
    }
    // x labels: ~6 evenly spaced, never colliding
    const maxLabels = Math.max(2, Math.floor(iw / 72));
    const step = Math.max(1, Math.ceil(n / maxLabels));
    for(let i = 0; i < n; i += step){
      const anchor = !isBar && i === 0 ? 'start' : 'middle';
      s += `<text x="${xAt(i)}" y="${H - 6}" text-anchor="${anchor}">${esc(o.xFormat ? o.xFormat(data[i][o.x], i) : data[i][o.x])}</text>`;
    }
    s += '</g>';

    if(isBar){
      const bw = Math.max(2, Math.min(28, band - Math.max(2, band * 0.28)));
      data.forEach((d, i) => {
        let base = 0;
        series.forEach((ser, si) => {
          const v = +d[ser.key] || 0;
          if(!v) return;
          const y0 = yAt(base), y1 = yAt(base + v);
          const h = Math.max(1, y0 - y1 - (stacked && si > 0 ? 2 : 0));
          const x = xAt(i) - bw / 2;
          const r = Math.min(4, bw / 2, h);
          const top = y0 - h;
          // rounded top only, anchored to the baseline
          s += `<path fill="${css(ser.color)}" d="M${x},${y0} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${y0} Z"/>`;
          base += v;
        });
      });
    } else {
      series.forEach(ser => {
        const pts = data.map((d, i) => [xAt(i), yAt(+d[ser.key] || 0)]);
        if(!pts.length) return;
        const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
        const color = css(ser.color);
        if(o.type === 'area'){
          const gid = 'g' + Math.random().toString(36).slice(2, 8);
          s += `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".22"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>`;
          s += `<path d="${line} L${pts[pts.length-1][0]},${yAt(0)} L${pts[0][0]},${yAt(0)} Z" fill="url(#${gid})"/>`;
        }
        s += `<path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
      });
    }
    s += `<line class="crosshair" x1="0" x2="0" y1="${pad.t}" y2="${pad.t + ih}" visibility="hidden"/>`;
    s += `<g class="dots"></g>`;
    s += `<rect class="hit" x="${pad.l}" y="${pad.t}" width="${iw}" height="${ih}" fill="transparent"/>`;
    s += '</svg>';

    // screen-reader table
    const table = `<table class="sr-only"><caption>${esc(o.label || '')}</caption><thead><tr><th>${esc(o.xLabel || 'Date')}</th>${series.map(x => `<th>${esc(x.label)}</th>`).join('')}</tr></thead><tbody>${
      data.map(d => `<tr><td>${esc(o.tipTitle ? o.tipTitle(d) : d[o.x])}</td>${series.map(x => `<td>${esc(d[x.key])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    el.innerHTML = s + '<div class="chart-tip" hidden></div>' + table;

    // hover layer
    const svg = el.querySelector('svg');
    const hit = svg.querySelector('.hit');
    const cross = svg.querySelector('.crosshair');
    const dots = svg.querySelector('.dots');
    const tip = el.querySelector('.chart-tip');
    const move = (ev) => {
      const rect = svg.getBoundingClientRect();
      const px = (ev.clientX - rect.left) * (W / rect.width);
      let i = isBar ? Math.floor((px - pad.l) / band) : Math.round((px - pad.l) / (n <= 1 ? 1 : iw / (n - 1)));
      i = Math.max(0, Math.min(n - 1, i));
      const d = data[i]; if(!d) return;
      const x = xAt(i);
      cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('visibility', 'visible');
      dots.innerHTML = isBar ? '' : series.map(ser => `<circle cx="${x}" cy="${yAt(+d[ser.key] || 0)}" r="4" fill="${css(ser.color)}" stroke="${css('--panel')}" stroke-width="2"/>`).join('');
      tip.innerHTML = `<div class="tt-title">${esc(o.tipTitle ? o.tipTitle(d) : d[o.x])}</div>` +
        series.slice().reverse().map(ser => `<div class="tt-row"><span class="sw" style="background:${css(ser.color)}"></span>${esc(ser.label)}<b>${esc((o.tipFormat || fmtY)(+d[ser.key] || 0))}</b></div>`).join('');
      tip.hidden = false;
      const topV = stacked ? series.reduce((a, ser) => a + (+d[ser.key] || 0), 0) : Math.max(...series.map(ser => +d[ser.key] || 0));
      const left = Math.min(Math.max(x / W * rect.width, 70), rect.width - 70);
      tip.style.left = left + 'px';
      tip.style.top = Math.max(yAt(topV) / H * rect.height, 40) + 'px';
    };
    const leave = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); dots.innerHTML = ''; };
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', leave);
  }

  window.Charts = { render, compact };
})();
