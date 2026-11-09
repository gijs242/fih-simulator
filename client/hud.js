// DOM overlay: status bars, cooldowns, leaderboards, kill feed, evolution cards, floating labels.
import { SPECIES, SPECIES_INDEX, TIER_NAMES, stats } from '/shared/species.js';
import { zoneForDepth } from '/shared/world.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class Hud {
  constructor() {
    this.shownChoices = null;
    this.labelPool = [];
    this.labelsEl = $('labels');
    this.onChoose = null;
  }
  show(on) { $('hud').classList.toggle('hidden', !on); }

  update(me, depth, localCds) {
    if (!me) return;
    const sp = SPECIES[me.sp];
    $('spname').textContent = sp.name;
    $('lvl').textContent = `Level ${me.level} · ${TIER_NAMES[sp.tier]} · Score ${me.score}`;
    $('hpfill').style.width = `${Math.max(0, me.hp / me.maxHp * 100)}%`;
    $('hptext').textContent = `${Math.max(0, me.hp)} / ${me.maxHp}`;
    const xpk = me.xpNext ? me.xp / me.xpNext : 1;
    $('xpfill').style.width = `${xpk * 100}%`;
    $('xptext').textContent = me.xpNext ? `${me.xp} / ${me.xpNext} XP` : 'MAX LEVEL';
    $('a2name').textContent = sp.a2.name;
    this.cd('ab1', localCds.bite, sp.biteCd);
    this.cd('ab2', localCds.a2, sp.a2.cd);
    this.cd('ab3', localCds.dash, localCds.dashMax);
    const z = zoneForDepth(depth);
    $('zonename').textContent = z.name;
    $('depthval').textContent = `${Math.round(depth)} m`;
    this.evolve(me.choices);
  }
  cd(id, left, total) {
    const el = document.querySelector(`#${id} .cd`);
    el.style.height = `${Math.min(1, Math.max(0, left / total)) * 100}%`;
  }

  evolve(choices) {
    const key = choices ? choices.join(',') : null;
    if (key === this.shownChoices) return;
    this.shownChoices = key;
    const box = $('evolve');
    if (!choices) { box.classList.add('hidden'); return; }
    const cards = $('cards');
    cards.innerHTML = '';
    choices.forEach((id, i) => {
      const s = SPECIES[SPECIES_INDEX[id]];
      const st = stats(s.index, s.minLevel);
      const d = document.createElement('div');
      d.className = 'card';
      d.innerHTML = `<span class="key">${i + 1}</span><h4>${esc(s.name)}</h4><div class="role">${esc(s.role)} · ${esc(s.era)}</div>
        <p>${esc(s.desc)}</p><p><b>${esc(s.a2.name)}:</b> ${esc(s.a2.desc)}</p>
        <div class="stats">HP ${st.maxHp} · Bite ${Math.round(st.bite)} · Speed ${st.speed.toFixed(1)} · Size ${st.size.toFixed(1)}m</div>`;
      d.addEventListener('click', () => this.onChoose && this.onChoose(id));
      cards.appendChild(d);
    });
    box.classList.remove('hidden');
  }

  live(lb, myId) {
    $('live').innerHTML = lb.map(([name, score, spId, level, id]) =>
      `<li class="${id === myId ? 'me' : ''}">${esc(name)} <small>${esc(SPECIES[SPECIES_INDEX[spId]]?.name || '')} ${level} · ${score}</small></li>`).join('');
  }
  alltime(list) {
    $('alltime').innerHTML = list.length
      ? list.slice(0, 10).map((e) => `<li>${esc(e.name)} <small>${e.score} · ${esc(e.species)} Lv${e.level}</small></li>`).join('')
      : '<li class="muted">No legends yet</li>';
  }
  feed(msg) {
    const el = document.createElement('div');
    el.textContent = msg;
    $('feed').appendChild(el);
    setTimeout(() => el.remove(), 5000);
    while ($('feed').children.length > 6) $('feed').firstChild.remove();
  }
  hurt() {
    const h = $('hurt');
    h.style.opacity = '1';
    clearTimeout(this.hurtT);
    this.hurtT = setTimeout(() => { h.style.opacity = '0'; }, 120);
  }
  ink(on) { $('inkfx').style.opacity = on ? '1' : '0'; }

  // floating name/species labels; items: [{x,y,text,cls,hp}]
  labels(items) {
    while (this.labelPool.length < items.length) {
      const d = document.createElement('div');
      d.className = 'label';
      d.innerHTML = '<span></span><div class="lhp"><div></div></div>';
      this.labelsEl.appendChild(d);
      this.labelPool.push(d);
    }
    this.labelPool.forEach((d, i) => {
      const it = items[i];
      if (!it) { d.style.display = 'none'; return; }
      d.style.display = '';
      d.style.left = `${it.x}px`;
      d.style.top = `${it.y}px`;
      d.className = `label ${it.cls}`;
      const span = d.firstChild;
      if (span.textContent !== it.text) span.textContent = it.text;
      const bar = d.lastChild;
      bar.style.display = it.hp < 100 ? '' : 'none';
      bar.firstChild.style.width = `${it.hp}%`;
    });
  }
}
