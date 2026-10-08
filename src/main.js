import './style.css';
import { CHARACTERS, getCharacter } from './characters.js';
import { Game } from './game.js';
import { initAudio, setMuted, isMuted, sfx } from './audio.js';

const app = document.getElementById('app');

const state = {
  p1: null,
  p2: null,
  cpu: true,
  difficulty: 'normal',
  slot: 'p1',
  focus: 0,
  game: null,
};

const DIFFICULTIES = ['easy', 'normal', 'hard'];
const nameOf = (id) => (id ? getCharacter(id).name : 'Choose fighter');

let menuKeyHandler = null;

function setMenuKeys(handler) {
  if (menuKeyHandler) window.removeEventListener('keydown', menuKeyHandler);
  menuKeyHandler = handler;
  if (handler) window.addEventListener('keydown', handler);
}

function renderMenu() {
  app.innerHTML = `
    <div class="menu">
      <header class="menu-head">
        <h1>SHADOW <span>CLASH</span></h1>
        <p>8 fighters &middot; unique abilities &middot; best of 3 rounds</p>
      </header>

      <div class="menu-bar">
        <div class="slot ${state.slot === 'p1' ? 'active' : ''}" data-slot="p1">
          <span class="slot-label">PLAYER 1</span>
          <span class="slot-name">${nameOf(state.p1)}</span>
        </div>
        <div class="vs">VS</div>
        <div class="slot ${state.slot === 'p2' ? 'active' : ''}" data-slot="p2">
          <span class="slot-label">${state.cpu ? 'CPU' : 'PLAYER 2'}</span>
          <span class="slot-name">${nameOf(state.p2)}</span>
        </div>
        <button class="mode" id="mode">${state.cpu ? 'vs CPU' : '2 Players'}</button>
      </div>

      <div class="difficulty">
        <span class="difficulty-label">CPU Difficulty</span>
        <div class="difficulty-opts" id="difficulty">
          ${DIFFICULTIES.map(
            (d) => `<button class="diff ${state.difficulty === d ? 'on' : ''}" data-diff="${d}">${d}</button>`
          ).join('')}
        </div>
      </div>

      <div class="roster" id="roster"></div>

      <div class="menu-actions">
        <button class="start" id="start" ${state.p1 && state.p2 ? '' : 'disabled'}>FIGHT</button>
      </div>

      <div class="controls-help">
        <div class="ctrl-col">
          <h3>Player 1</h3>
          <p><b>A</b> / <b>D</b> move &middot; double-tap to dash</p>
          <p><b>W</b> jump &middot; <b>S</b> block</p>
          <p><b>F</b> punch &middot; <b>G</b> kick &middot; <b>R</b> special</p>
        </div>
        <div class="ctrl-col">
          <h3>Player 2</h3>
          <p><b>←</b> / <b>→</b> move &middot; double-tap to dash</p>
          <p><b>↑</b> jump &middot; <b>↓</b> block</p>
          <p><b>J</b> punch &middot; <b>K</b> kick &middot; <b>L</b> special</p>
        </div>
        <div class="ctrl-col">
          <h3>Menu &amp; Match</h3>
          <p><b>Arrows</b> navigate &middot; <b>Enter</b> select</p>
          <p><b>Tab</b> switch slot &middot; <b>M</b> CPU / 2P</p>
          <p><b>Esc</b> or <b>P</b> pause &middot; <b>Enter</b> rematch</p>
        </div>
      </div>
    </div>`;

  const roster = document.getElementById('roster');
  CHARACTERS.forEach((c, i) => {
    const card = document.createElement('button');
    card.className = 'card' + (state.focus === i ? ' focused' : '');
    card.style.setProperty('--c', c.color);
    card.style.setProperty('--a', c.accent);
    const badge = state.p1 === c.id ? 'P1' : state.p2 === c.id ? (state.cpu ? 'CPU' : 'P2') : '';
    card.innerHTML = `
      <div class="card-art"><span class="card-initial">${c.name[0]}</span></div>
      <div class="card-body">
        <div class="card-name">${c.name}${badge ? `<em>${badge}</em>` : ''}</div>
        <div class="card-title">${c.title}</div>
        <div class="card-special">★ ${c.specialName}</div>
        <div class="card-blurb">${c.blurb}</div>
      </div>`;
    card.addEventListener('click', () => selectCharacter(c.id));
    card.addEventListener('mouseenter', () => {
      state.focus = i;
      document.querySelectorAll('.card').forEach((el, j) => el.classList.toggle('focused', j === i));
    });
    roster.appendChild(card);
  });

  document.querySelectorAll('.slot').forEach((el) => {
    el.addEventListener('click', () => {
      state.slot = el.dataset.slot;
      renderMenu();
    });
  });

  document.getElementById('mode').addEventListener('click', () => {
    initAudio();
    sfx.select();
    state.cpu = !state.cpu;
    renderMenu();
  });

  document.querySelectorAll('.diff').forEach((btn) => {
    btn.addEventListener('click', () => {
      initAudio();
      sfx.select();
      state.difficulty = btn.dataset.diff;
      renderMenu();
    });
  });

  const startBtn = document.getElementById('start');
  if (state.p1 && state.p2) startBtn.addEventListener('click', startFight);

  // Keyboard navigation for the menu.
  setMenuKeys((e) => {
    const keys = ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'KeyM'];
    if (!keys.includes(e.code)) return;
    e.preventDefault();
    if (e.code === 'Tab') {
      state.slot = state.slot === 'p1' ? 'p2' : 'p1';
      sfx.select();
      renderMenu();
      return;
    }
    if (e.code === 'KeyM') {
      state.cpu = !state.cpu;
      renderMenu();
      return;
    }
    if (e.code === 'Enter') {
      if (state.p1 && state.p2 && state.focus === -1) startFight();
      else selectCharacter(CHARACTERS[state.focus].id);
      return;
    }
    const delta = e.code === 'ArrowRight' ? 1 : e.code === 'ArrowLeft' ? -1 : e.code === 'ArrowDown' ? 4 : -4;
    state.focus = Math.max(0, Math.min(CHARACTERS.length - 1, state.focus + delta));
    sfx.select();
    document.querySelectorAll('.card').forEach((el, j) => el.classList.toggle('focused', j === state.focus));
  });
}

function selectCharacter(id) {
  initAudio();
  sfx.select();
  if (state.slot === 'p1') {
    state.p1 = id;
    state.slot = 'p2';
  } else {
    state.p2 = id;
    state.slot = 'p1';
  }
  renderMenu();
}

function startFight() {
  setMenuKeys(null);
  app.innerHTML = `
    <div class="arena">
      <div class="canvas-wrap"><canvas id="stage" width="960" height="540"></canvas></div>
      <div class="arena-bar">
        <div class="touch" id="touch"></div>
        <button class="sound" id="sound">${isMuted() ? '🔇 Sound off' : '🔊 Sound on'}</button>
      </div>
    </div>`;

  const canvas = document.getElementById('stage');
  state.game = new Game(canvas, {
    p1: getCharacter(state.p1),
    p2: getCharacter(state.p2),
    cpu: state.cpu,
    difficulty: state.difficulty,
  });
  state.game.onMatchEnd = showResult;
  state.game.start();
  buildTouchControls(document.getElementById('touch'));

  const soundBtn = document.getElementById('sound');
  soundBtn.addEventListener('click', () => {
    setMuted(!isMuted());
    soundBtn.textContent = isMuted() ? '🔇 Sound off' : '🔊 Sound on';
  });
}

function buildTouchControls(root) {
  const makeGroup = (player, label) => {
    const group = document.createElement('div');
    group.className = 'tgroup';
    group.innerHTML = `<div class="tname">${label}</div>`;
    const pad = document.createElement('div');
    pad.className = 'tpad';
    const buttons = [
      ['◀', 'left'], ['▶', 'right'], ['▲', 'up'], ['▼', 'block'],
      ['P', 'punch'], ['K', 'kick'], ['★', 'special'],
    ];
    for (const [text, action] of buttons) {
      const b = document.createElement('button');
      b.className = 'tbtn';
      b.textContent = text;
      b.dataset.action = `${player}.${action}`;
      pad.appendChild(b);
    }
    group.appendChild(pad);
    return group;
  };

  root.appendChild(makeGroup('p1', 'Player 1'));
  if (!state.cpu) root.appendChild(makeGroup('p2', 'Player 2'));

  root.querySelectorAll('.tbtn').forEach((b) => {
    const action = b.dataset.action;
    const down = (e) => {
      e.preventDefault();
      if (state.game) state.game.press(action);
      b.classList.add('on');
    };
    const up = (e) => {
      e.preventDefault();
      if (state.game) state.game.release(action);
      b.classList.remove('on');
    };
    b.addEventListener('pointerdown', down);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointerleave', up);
    b.addEventListener('pointercancel', up);
  });
}

function showResult(text) {
  const arena = app.querySelector('.arena');
  if (!arena || arena.querySelector('.overlay')) return;
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <h2>${text}</h2>
    <div class="overlay-actions">
      <button id="rematch">Rematch (Enter)</button>
      <button id="to-menu">Character Select</button>
    </div>`;
  arena.appendChild(overlay);

  const rematch = () => {
    window.removeEventListener('keydown', onKey);
    state.game.destroy();
    startFight();
  };
  const toMenu = () => {
    window.removeEventListener('keydown', onKey);
    state.game.destroy();
    state.game = null;
    renderMenu();
  };
  const onKey = (e) => {
    if (e.code === 'Enter') {
      e.preventDefault();
      rematch();
    } else if (e.code === 'Escape') {
      e.preventDefault();
      toMenu();
    }
  };
  window.addEventListener('keydown', onKey);
  overlay.querySelector('#rematch').addEventListener('click', rematch);
  overlay.querySelector('#to-menu').addEventListener('click', toMenu);
}

renderMenu();
