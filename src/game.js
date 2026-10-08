// Shadow Clash — fighting game engine. Combat runs on a fixed 60 Hz timestep;
// rendering lives in render.js and sound in audio.js.
import { VIEW, GRAVITY, MOVE_SPEED, JUMP_V, STEP, ROUND_TIME, WINS_NEEDED } from './config.js';
import { renderGame } from './render.js';
import { sfx, initAudio } from './audio.js';

const KEYMAP = {
  KeyA: 'p1.left', KeyD: 'p1.right', KeyW: 'p1.up', KeyS: 'p1.down',
  KeyF: 'p1.punch', KeyG: 'p1.kick', KeyR: 'p1.special',
  ArrowLeft: 'p2.left', ArrowRight: 'p2.right', ArrowUp: 'p2.up', ArrowDown: 'p2.down',
  KeyJ: 'p2.punch', KeyK: 'p2.kick', KeyL: 'p2.special',
};

const ATTACKS = {
  punch: { startup: 0.06, active: 0.08, recovery: 0.13, damage: 6, reach: 52, top: 106, h: 30, kb: 130, hitstun: 0.16 },
  kick: { startup: 0.13, active: 0.10, recovery: 0.22, damage: 11, reach: 72, top: 82, h: 36, kb: 250, hitstun: 0.26 },
};

const DIFFICULTY = {
  easy: { interval: 0.30, aggression: 0.45, blockChance: 0.18, specialChance: 0.14 },
  normal: { interval: 0.19, aggression: 0.64, blockChance: 0.34, specialChance: 0.28 },
  hard: { interval: 0.11, aggression: 0.80, blockChance: 0.52, specialChance: 0.44 },
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const hurtbox = (f) => ({ x: f.x - 26, y: f.y - 122, w: 52, h: 122 });

function attackHitbox(f, d) {
  const x = f.facing > 0 ? f.x : f.x - d.reach;
  return { x, y: f.y - d.top, w: d.reach, h: d.h };
}

function applyDamage(game, target, attacker, dmg, stun, opts = {}) {
  if (target.invuln > 0 || target.hp <= 0) return false;
  const attackerInFront = (attacker.x - target.x) * target.facing > 0;
  const blocking = target.blocking && attackerInFront && target.grounded;
  let damage = dmg * (attacker ? attacker.powerMul : 1);
  let kb = opts.kb ?? 200;
  let st = stun;

  if (blocking) {
    damage *= 0.2;
    st *= 0.3;
    kb *= 0.4;
  } else if (target.armor > 0) {
    damage *= 0.5;
    st = 0;
    kb *= 0.3;
  }

  target.hp = Math.max(0, target.hp - damage);
  target.hurtFlash = 0.16;
  if (st > 0) target.stun = Math.max(target.stun, st);
  const away = target.x >= attacker.x ? 1 : -1;
  target.vx = away * kb;

  if (blocking) {
    sfx.block();
    game.spawnHit(target.x + target.facing * 24, target.y - 98, '#e2e8f0', 6);
  } else {
    if (opts.freeze) {
      target.stun = Math.max(target.stun, 1.1);
      target.frozen = 1.1;
    }
    sfx.hit();
    game.hitStop = Math.max(game.hitStop, 0.055);
    game.shake = Math.min(14, game.shake + 7);
    game.flash = Math.min(0.35, game.flash + 0.12);
    game.spawnHit((target.x + attacker.x) / 2, target.y - 98, attacker.accent, 10);
    game.popup((target.x + attacker.x) / 2, target.y - 140, `-${Math.round(damage)}`, attacker.accent);

    // Combo tracking.
    if (attacker) {
      attacker.comboCount = attacker.comboTimer > 0 ? attacker.comboCount + 1 : 1;
      attacker.comboTimer = 0.9;
    }
  }
  return true;
}

class Fighter {
  constructor(def, opts) {
    this.def = def;
    this.name = def.name;
    this.color = def.color;
    this.accent = def.accent;
    this.maxHp = def.hp;
    this.speedMul = def.speed;
    this.powerMul = def.power;
    this.isCPU = !!opts.isCPU;
    this.player = opts.player;
    this.difficulty = DIFFICULTY[opts.difficulty] || DIFFICULTY.normal;
    this.reset(opts.x, opts.facing);
  }

  reset(x, facing) {
    this.x = x;
    this.y = VIEW.GROUND;
    this.vx = 0;
    this.vy = 0;
    this.facing = facing;
    this.hp = this.maxHp;
    this.hpDisplay = this.maxHp;
    this.grounded = true;
    this.attack = null;
    this.cooldown = 0;
    this.stun = 0;
    this.frozen = 0;
    this.blocking = false;
    this.heldDown = false;
    this.armor = 0;
    this.invuln = 0;
    this.regenLeft = 0;
    this.regenRate = 0;
    this.hurtFlash = 0;
    this.walkPhase = 0;
    this.dashTime = 0;
    this.dashDir = 0;
    this.tap = { left: -1, right: -1 };
    this.comboCount = 0;
    this.comboTimer = 0;
    this.ko = false;
    this.koAngle = 0;
    this.aiTimer = 0;
    this.ai = { move: 0, block: false, act: null, jump: false };
  }

  canAct() {
    return this.stun <= 0 && !this.ko;
  }

  update(dt, opp, game, active) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.armor = Math.max(0, this.armor - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    this.frozen = Math.max(0, this.frozen - dt);
    this.dashTime = Math.max(0, this.dashTime - dt);
    if (this.stun > 0) this.stun = Math.max(0, this.stun - dt);

    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.comboCount = 0;
    }

    if (this.regenLeft > 0) {
      this.hp = Math.min(this.maxHp, this.hp + this.regenRate * dt);
      this.regenLeft -= dt;
    }

    // Health bar eases down toward the real value.
    if (this.hp > this.hpDisplay) this.hpDisplay = this.hp;
    else this.hpDisplay += (this.hp - this.hpDisplay) * Math.min(1, dt * 4);

    if (this.ko) {
      this.updateKO(dt);
      return;
    }

    if (active && this.canAct()) {
      if (this.isCPU) this.aiUpdate(dt, opp, game);
      else this.handleInput(opp, game, game.input);
    }

    if (this.attack) this.updateAttack(dt, opp, game);

    if (this.grounded && !this.attack && this.canAct() && this.dashTime <= 0) {
      this.facing = opp.x >= this.x ? 1 : -1;
    }

    this.blocking = this.grounded && this.canAct() && !this.attack && this.heldDown;

    // Physics.
    if (this.dashTime > 0) {
      this.vx = this.dashDir * 640;
    }
    this.vy += GRAVITY * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    if (this.y >= VIEW.GROUND) {
      if (!this.grounded) game.spawnDust(this.x, VIEW.GROUND, 5);
      this.y = VIEW.GROUND;
      this.vy = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }

    if (this.grounded) {
      if (Math.abs(this.vx) > 20) this.walkPhase += dt * 13;
      else this.walkPhase = 0;
    }
  }

  updateKO(dt) {
    this.vy += GRAVITY * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vx *= 0.94;
    if (this.y >= VIEW.GROUND) {
      this.y = VIEW.GROUND;
      this.vy = 0;
      this.vx = 0;
      this.koAngle += (Math.PI / 2) * dt * 3;
      if (this.koAngle > Math.PI / 2) this.koAngle = Math.PI / 2;
    } else {
      this.koAngle += dt * 6;
    }
  }

  handleInput(opp, game, input) {
    const p = this.player;
    const held = (a) => input.held.has(`${p}.${a}`);
    const consume = (a) => input.consume(`${p}.${a}`);

    this.heldDown = held('down');

    if (this.dashTime > 0) return;

    if (!this.attack) {
      const now = game.time;
      if (consume('right')) {
        if (now - this.tap.right < 0.28) this.startDash(1, game);
        this.tap.right = now;
      }
      if (consume('left')) {
        if (now - this.tap.left < 0.28) this.startDash(-1, game);
        this.tap.left = now;
      }
      const dir = (held('right') ? 1 : 0) - (held('left') ? 1 : 0);
      if (this.grounded) {
        if (this.heldDown) this.vx *= 0.5;
        else if (dir !== 0) this.vx = dir * MOVE_SPEED * this.speedMul;
        else this.vx *= 0.55;
      }
      if (consume('up') && this.grounded) {
        this.vy = JUMP_V;
        this.grounded = false;
        sfx.jump();
      }
      if (consume('punch')) this.startAttack('punch');
      else if (consume('kick')) this.startAttack('kick');
      else if (consume('special')) this.startSpecial(opp, game);
    } else {
      this.heldDown = false;
    }
  }

  startDash(dir, game) {
    this.dashTime = 0.2;
    this.dashDir = dir;
    this.invuln = Math.max(this.invuln, 0.12);
    game.spawnDust(this.x, VIEW.GROUND, 6);
    sfx.whoosh();
  }

  aiUpdate(dt, opp, game) {
    if (this.attack || this.dashTime > 0) return;
    const d = this.difficulty;
    const dist = opp.x - this.x;
    const adist = Math.abs(dist);

    // Reactive blocking.
    if (opp.attack && adist < 140 && Math.random() < d.blockChance * 0.12) {
      this.ai.block = true;
      this.aiTimer = 0.25;
    }

    this.aiTimer -= dt;
    if (this.aiTimer <= 0) {
      this.aiTimer = d.interval + Math.random() * 0.16;
      const r = Math.random();
      this.ai = { move: 0, block: false, act: null, jump: false };
      if (adist > 170) {
        this.ai.move = Math.sign(dist);
      } else if (adist < 64) {
        if (r < d.aggression) this.ai.act = Math.random() < 0.5 ? 'punch' : 'kick';
        else this.ai.move = -Math.sign(dist);
      } else if (r < d.aggression) {
        this.ai.act = Math.random() < 0.45 ? 'punch' : 'kick';
      } else if (r < d.aggression + 0.16) {
        this.ai.block = true;
      } else {
        this.ai.move = -Math.sign(dist);
      }
      if (this.cooldown <= 0 && adist < 440 && Math.random() < d.specialChance) this.ai.act = 'special';
      if (adist > 140 && this.grounded && Math.random() < 0.16) this.ai.jump = true;
    }

    this.heldDown = this.ai.block && this.grounded;
    if (this.grounded && !this.heldDown) {
      if (this.ai.move !== 0) this.vx = this.ai.move * MOVE_SPEED * this.speedMul * 0.9;
      else this.vx *= 0.6;
    }
    if (this.ai.jump && this.grounded) {
      this.vy = JUMP_V;
      this.grounded = false;
      sfx.jump();
      this.ai.jump = false;
    }
    if (this.ai.act) {
      const act = this.ai.act;
      this.ai.act = null;
      if (act === 'special') this.startSpecial(opp, game);
      else this.startAttack(act);
    }
  }

  startAttack(name) {
    if (this.attack || !this.grounded || !this.canAct()) return;
    this.attack = { name, def: ATTACKS[name], t: 0, phase: 'startup', hasHit: false };
    sfx[name]();
  }

  startSpecial(opp, game) {
    if (this.cooldown > 0 || this.attack || !this.canAct()) return;
    this.cooldown = this.def.specialCost;
    const type = this.def.special;

    if (type === 'dash') {
      this.attack = {
        name: 'special',
        def: { startup: 0.05, active: 0.16, recovery: 0.26, damage: 14, reach: 78, top: 110, h: 64, kb: 340, hitstun: 0.3 },
        t: 0, phase: 'startup', hasHit: false, dash: true,
      };
      this.invuln = 0.3;
      sfx.special();
      return;
    }
    if (type === 'teleport') {
      const behind = opp.x + (this.facing > 0 ? 64 : -64);
      this.x = clamp(behind, 44, VIEW.W - 44);
      this.facing = opp.x < this.x ? -1 : 1;
      this.invuln = 0.26;
      game.spawnDust(this.x, VIEW.GROUND, 8);
      sfx.whoosh();
      this.attack = {
        name: 'special',
        def: { startup: 0.05, active: 0.12, recovery: 0.3, damage: 13, reach: 66, top: 114, h: 68, kb: 280, hitstun: 0.32 },
        t: 0, phase: 'startup', hasHit: false,
      };
      return;
    }
    if (type === 'heal') {
      this.regenLeft = 2.2;
      this.regenRate = 16;
      this.attack = { name: 'special', def: { startup: 0.3, active: 0.05, recovery: 0.3, damage: 0, reach: 0, top: 0, h: 0, kb: 0, hitstun: 0 }, t: 0, phase: 'startup', hasHit: false };
      sfx.special();
      return;
    }
    if (type === 'slam') {
      this.armor = 1.2;
      this.attack = {
        name: 'special',
        def: { startup: 0.24, active: 0.14, recovery: 0.42, damage: 15, reach: 120, top: 66, h: 46, kb: 380, hitstun: 0.4 },
        t: 0, phase: 'startup', hasHit: false, slam: true, spawned: false,
      };
      sfx.special();
      return;
    }
    this.attack = {
      name: 'special',
      def: { startup: 0.18, active: 0.03, recovery: 0.3, damage: 0, reach: 0, top: 0, h: 0, kb: 0, hitstun: 0 },
      t: 0, phase: 'startup', hasHit: false, type, spawned: false,
    };
    sfx.special();
  }

  updateAttack(dt, opp, game) {
    const a = this.attack;
    if (!a) return;
    a.t += dt;
    const d = a.def;
    const total = d.startup + d.active + d.recovery;
    if (a.t >= d.startup + d.active) a.phase = 'recovery';
    else if (a.t >= d.startup) a.phase = 'active';

    if (a.phase === 'active') {
      if (a.dash) this.x = clamp(this.x + this.facing * 780 * dt, 44, VIEW.W - 44);
      if (a.slam && !a.spawned) {
        a.spawned = true;
        spawnSlam(this, game);
      }
      if (a.type && !a.spawned) {
        a.spawned = true;
        spawnSpecial(a.type, this, game);
      }
      if (!a.hasHit && d.reach > 0 && opp.hp > 0) {
        if (overlap(attackHitbox(this, d), hurtbox(opp))) {
          a.hasHit = true;
          applyDamage(game, opp, this, d.damage, d.hitstun, { kb: d.kb });
        }
      }
    }
    if (a.t >= total) this.attack = null;
  }
}

function spawnSpecial(type, f, game) {
  const dir = f.facing;
  const px = f.x + dir * 48;
  const py = f.y - 98;
  const mk = (o) =>
    game.projectiles.push(
      Object.assign(
        {
          x: px, y: py, vx: dir * 440, vy: 0, w: 34, h: 34, owner: f,
          damage: 9, stun: 0.18, freeze: false, gravity: 0, life: 2.2,
          kind: type, color: f.color, accent: f.accent,
        },
        o
      )
    );
  switch (type) {
    case 'fireball':
      mk({ damage: 9, stun: 0.18, vx: dir * 470, w: 40, h: 40 });
      break;
    case 'ice':
      mk({ damage: 6, stun: 1.1, freeze: true, vx: dir * 330, w: 30, h: 30 });
      break;
    case 'rock':
      mk({ damage: 13, stun: 0.5, vx: dir * 360, vy: -320, gravity: 950, w: 34, h: 34, life: 3 });
      break;
    case 'gust':
      for (let i = -1; i <= 1; i++) {
        mk({ damage: 5, stun: 0.12, vx: dir * 540, vy: i * 150, w: 28, h: 28, life: 1.1 });
      }
      break;
  }
}

function spawnSlam(f, game) {
  for (const dir of [-1, 1]) {
    game.projectiles.push({
      x: f.x + dir * 40, y: VIEW.GROUND - 18, vx: dir * 540, vy: 0, w: 46, h: 36,
      owner: f, damage: 12, stun: 0.35, freeze: false, gravity: 0, life: 1.1,
      kind: 'shock', color: f.color, accent: f.accent,
    });
  }
  game.spawnDust(f.x, VIEW.GROUND, 14);
  game.shake = Math.min(18, game.shake + 12);
  game.spawnHit(f.x, VIEW.GROUND - 20, f.accent, 10);
}

export class Game {
  constructor(canvas, config) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cpu = config.cpu;
    this.difficulty = config.difficulty || 'normal';
    this.p1 = new Fighter(config.p1, { x: 280, facing: 1, player: 'p1' });
    this.p2 = new Fighter(config.p2, {
      x: 680, facing: -1, player: 'p2', isCPU: config.cpu, difficulty: this.difficulty,
    });
    this.projectiles = [];
    this.effects = [];
    this.round = 1;
    this.wins = { p1: 0, p2: 0 };
    this.phase = 'intro';
    this.introTimer = 1.9;
    this.koTimer = 0;
    this.timer = ROUND_TIME;
    this.time = 0;
    this.hitStop = 0;
    this.shake = 0;
    this.flash = 0;
    this.paused = false;
    this.message = '';
    this.subMessage = '';
    this.onMatchEnd = null;
    this.input = {
      held: new Set(),
      pressed: new Set(),
      consume: (a) => {
        if (!this.input.pressed.has(a)) return false;
        this.input.pressed.delete(a);
        return true;
      },
    };
    this.acc = 0;
    this.last = 0;
    this._loop = this._loop.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
  }

  start() {
    initAudio();
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    this.last = performance.now();
    this.render();
    this.raf = requestAnimationFrame(this._loop);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
  }

  togglePause() {
    if (this.phase === 'over') return;
    this.paused = !this.paused;
  }

  press(action) {
    if (!this.input.held.has(action)) this.input.pressed.add(action);
    this.input.held.add(action);
  }

  release(action) {
    this.input.held.delete(action);
  }

  _onKeyDown(e) {
    if (e.code === 'Escape' || e.code === 'KeyP') {
      e.preventDefault();
      this.togglePause();
      return;
    }
    const a = KEYMAP[e.code];
    if (!a) return;
    e.preventDefault();
    this.press(a);
  }

  _onKeyUp(e) {
    const a = KEYMAP[e.code];
    if (!a) return;
    this.input.held.delete(a);
  }

  _loop(now) {
    this.raf = requestAnimationFrame(this._loop);
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= STEP && steps < 5) {
      this.step(STEP);
      this.acc -= STEP;
      steps++;
    }
    this.input.pressed.clear();
    this.render();
  }

  step(dt) {
    if (this.paused) return;

    this.time += dt;
    this.shake = Math.max(0, this.shake - dt * 45);
    this.flash = Math.max(0, this.flash - dt * 2.2);

    this.updateEffects(dt);

    if (this.hitStop > 0) {
      this.hitStop -= dt;
      return;
    }

    const active = this.phase === 'fight';

    if (this.phase === 'intro') {
      this.introTimer -= dt;
      if (this.introTimer <= 0) {
        this.phase = 'fight';
        this.timer = ROUND_TIME;
        sfx.round();
      }
    }
    if (this.phase === 'fight') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.timer = 0;
        this.timeUp();
      }
    }

    this.p1.update(dt, this.p2, this, active);
    this.p2.update(dt, this.p1, this, active);

    // Prevent overlap.
    const minDist = 54;
    const d = this.p2.x - this.p1.x;
    if (Math.abs(d) < minDist) {
      const push = ((minDist - Math.abs(d)) / 2) * (d >= 0 ? 1 : -1);
      this.p1.x -= push;
      this.p2.x += push;
    }
    this.p1.x = clamp(this.p1.x, 44, VIEW.W - 44);
    this.p2.x = clamp(this.p2.x, 44, VIEW.W - 44);

    // Projectiles.
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.vy += (p.gravity || 0) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.gravity && p.y > VIEW.GROUND - 8) {
        this.spawnDust(p.x, VIEW.GROUND, 8);
        p.life = 0;
      }
      const box = { x: p.x - p.w / 2, y: p.y - p.h / 2, w: p.w, h: p.h };
      for (const f of [this.p1, this.p2]) {
        if (f === p.owner || f.hp <= 0) continue;
        if (overlap(box, hurtbox(f))) {
          applyDamage(this, f, p.owner, p.damage, p.stun, { freeze: p.freeze, kb: 240 });
          p.life = 0;
          break;
        }
      }
      if (p.life <= 0 || p.x < -80 || p.x > VIEW.W + 80) this.projectiles.splice(i, 1);
    }

    this.checkKO(dt);
  }

  updateEffects(dt) {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      if (e.kind === 'text') {
        e.y += e.vy * dt;
        e.vy *= 0.94;
      } else {
        e.vy += 900 * dt;
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        e.vx *= 0.98;
      }
      e.life -= dt;
      if (e.life <= 0) this.effects.splice(i, 1);
    }
  }

  timeUp() {
    if (this.phase !== 'fight') return;
    this.phase = 'ko';
    this.koTimer = 2.6;
    const p1r = this.p1.hp / this.p1.maxHp;
    const p2r = this.p2.hp / this.p2.maxHp;
    this.p1.ko = true;
    this.p2.ko = true;
    if (Math.abs(p1r - p2r) < 0.001) {
      this.message = 'TIME UP';
      this.subMessage = 'Draw';
    } else if (p1r > p2r) {
      this.wins.p1++;
      this.message = 'TIME UP';
      this.subMessage = `${this.p1.name} wins on health`;
    } else {
      this.wins.p2++;
      this.message = 'TIME UP';
      this.subMessage = `${this.p2.name} wins on health`;
    }
    sfx.ko();
  }

  checkKO(dt) {
    if (this.phase === 'fight') {
      const p1Down = this.p1.hp <= 0;
      const p2Down = this.p2.hp <= 0;
      if (p1Down || p2Down) {
        this.phase = 'ko';
        this.koTimer = 2.6;
        this.hitStop = 0.18;
        this.shake = 20;
        this.flash = 0.4;
        sfx.ko();
        this.p1.ko = p1Down;
        this.p2.ko = p2Down;
        const away = p2Down ? 1 : -1;
        if (p1Down) this.p1.vx = -away * 220;
        if (p2Down) this.p2.vx = away * 220;
        if (p1Down && p2Down) {
          this.message = 'DOUBLE KO';
          this.subMessage = 'No points awarded';
        } else if (p2Down) {
          this.wins.p1++;
          this.message = `${this.p1.name} WINS`;
          this.subMessage = `Round ${this.round}`;
        } else {
          this.wins.p2++;
          this.message = `${this.p2.name} WINS`;
          this.subMessage = `Round ${this.round}`;
        }
      }
    } else if (this.phase === 'ko') {
      this.koTimer -= dt;
      if (this.koTimer <= 0) {
        if (this.wins.p1 >= WINS_NEEDED || this.wins.p2 >= WINS_NEEDED) {
          this.phase = 'over';
          const winner = this.wins.p1 >= WINS_NEEDED ? this.p1 : this.p2;
          this.message = `${winner.name} WINS THE MATCH`;
          this.subMessage = 'Press Enter for a rematch';
          if (this.onMatchEnd) this.onMatchEnd(`${winner.name} wins the match!`);
        } else {
          this.round++;
          this.p1.reset(280, 1);
          this.p2.reset(680, -1);
          this.projectiles.length = 0;
          this.effects.length = 0;
          this.phase = 'intro';
          this.introTimer = 1.8;
        }
      }
    }
  }

  spawnHit(x, y, color, count = 8) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 60 + Math.random() * 240;
      this.effects.push({
        kind: 'spark', x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 70,
        life: 0.35, max: 0.35, color, size: 3 + Math.random() * 4,
      });
    }
  }

  spawnDust(x, y, count = 6) {
    for (let i = 0; i < count; i++) {
      this.effects.push({
        kind: 'dust', x: x + (Math.random() - 0.5) * 40, y: y - Math.random() * 8,
        vx: (Math.random() - 0.5) * 160, vy: -Math.random() * 90,
        life: 0.5, max: 0.5, color: 'rgba(220,210,240,0.5)', size: 5 + Math.random() * 7,
      });
    }
  }

  popup(x, y, text, color) {
    this.effects.push({
      kind: 'text', x, y, vy: -70, life: 0.75, max: 0.75, text, color, size: 24,
    });
  }

  render() {
    renderGame(this.ctx, this);
  }
}
