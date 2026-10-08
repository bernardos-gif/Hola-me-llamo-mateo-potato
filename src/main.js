import './style.css';
import { CHARACTERS, getCharacter } from './characters.js';
import { Game } from './game.js';

const app = document.getElementById('app');

const state = {
  p1: null,
  p2: null,
  cpu: true,
  slot: 'p1',
  game: null,
};

const nameOf = (id) => (id ? getCharacter(id).name : 'Choose fighter');

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

      <div class="roster" id="roster"></div>

      <div class="menu-actions">
        <button class="start" id="start" ${state.p1 && state.p2 ? '' : 'disabled'}>FIGHT</button>
      </div>
      <p class="hint">Click a fighter to place them in the highlighted slot. Move with <b>A/D</b>, jump <b>W</b>, block <b>S</b>, punch <b>F</b>, kick <b>G</b>, special <b>R</b>.</p>
    </div>`;

  const roster = document.getElementById('roster');
  for (const c of CHARACTERS) {
    const card = document.createElement('button');
    card.className = 'card';
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
    roster.appendChild(card);
  }

  document.querySelectorAll('.slot').forEach((el) => {
    el.addEventListener('click', () => {
      state.slot = el.dataset.slot;
      renderMenu();
    });
  });
  document.getElementById('mode').addEventListener('click', () => {
    state.cpu = !state.cpu;
    renderMenu();
  });
  const startBtn = document.getElementById('start');
  if (state.p1 && state.p2) startBtn.addEventListener('click', startFight);
}

function selectCharacter(id) {
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
  app.innerHTML = `
    <div class="arena">
      <div class="canvas-wrap"><canvas id="stage" width="960" height="540"></canvas></div>
      <div class="touch" id="touch"></div>
    </div>`;

  const canvas = document.getElementById('stage');
  state.game = new Game(canvas, {
    p1: getCharacter(state.p1),
    p2: getCharacter(state.p2),
    cpu: state.cpu,
  });
  state.game.onMatchEnd = showResult;
  state.game.start();
  buildTouchControls(document.getElementById('touch'));
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
      <button id="rematch">Rematch</button>
      <button id="to-menu">Character Select</button>
    </div>`;
  arena.appendChild(overlay);
  overlay.querySelector('#rematch').addEventListener('click', () => {
    state.game.destroy();
    startFight();
  });
  overlay.querySelector('#to-menu').addEventListener('click', () => {
    state.game.destroy();
    state.game = null;
    renderMenu();
  });
}

renderMenu();
