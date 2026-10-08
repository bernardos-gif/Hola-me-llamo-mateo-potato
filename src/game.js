// Shadow Clash — a compact 2D fighting game engine.
// Renders to a single <canvas>; combat runs on a fixed 60 Hz timestep.
import { CHARACTERS } from './characters.js';

export const VIEW = { W: 960, H: 540, GROUND: 470 };

const GRAVITY = 2400;
const MOVE_SPEED = 280;
const JUMP_V = -860;
const STEP = 1 / 60;

// Keyboard map. Player 1 and Player 2 use separate key clusters.
const KEYMAP = {
  KeyA: 'p1.left', KeyD: 'p1.right', KeyW: 'p1.up', KeyS: 'p1.down',
  KeyF: 'p1.punch', KeyG: 'p1.kick', KeyR: 'p1.special',
  ArrowLeft: 'p2.left', ArrowRight: 'p2.right', ArrowUp: 'p2.up', ArrowDown: 'p2.down',
  KeyJ: 'p2.punch', KeyK: 'p2.kick', KeyL: 'p2.special',
};

const ATTACKS = {
  punch: { startup: 0.06, active: 0.08, recovery: 0.13, damage: 6, reach: 50, top: 102, h: 30, kb: 130, hitstun: 0.14 },
  kick: { startup: 0.13, active: 0.10, recovery: 0.22, damage: 11, reach: 68, top: 80, h: 34, kb: 250, hitstun: 0.24 },
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
    game.spawnHit(target.x + target.facing * 22, target.y - 96, '#e2e8f0');
  } else {
    if (opts.freeze) {
      target.stun = Math.max(target.stun, 1.1);
      target.frozen = 1.1;
    }
    game.spawnHit((target.x + attacker.x) / 2, target.y - 96, attacker.accent);
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
    this.reset(opts.x, opts.facing);
  }

  reset(x, facing) {
    this.x = x;
    this.y = VIEW.GROUND;
    this.vx = 0;
    this.vy = 0;
    this.facing = facing;
    this.hp = this.maxHp;
    this.grounded = true;
    this.attack = null;
    this.cooldown = 0;
    this.stun = 0;
    this.frozen = 0;
    this.blocking = false;
    this.armor = 0;
    this.invuln = 0;
    this.regenLeft = 0;
    this.regenRate = 0;
    this.hurtFlash = 0;
    this.walkPhase = 0;
    this.aiTimer = 0;
    this.ai = { move: 0, block: false, act: null, jump: false };
  }

  get airborne() {
    return !this.grounded;
  }

  canAct() {
    return this.stun <= 0;
  }

  update(dt, opp, game, active) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.armor = Math.max(0, this.armor - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    this.frozen = Math.max(0, this.frozen - dt);
    if (this.stun > 0) this.stun = Math.max(0, this.stun - dt);

    if (this.regenLeft > 0) {
      const heal = this.regenRate * dt;
      this.hp = Math.min(this.maxHp, this.hp + heal);
      this.regenLeft -= dt;
    }

    if (active && this.canAct()) {
      if (this.isCPU) this.aiUpdate(dt, opp, game);
      else this.handleInput(opp, game, game.input);
    }

    if (this.attack) this.updateAttack(dt, opp, game);

    // Facing tracks the opponent while idle on the ground.
    if (this.grounded && !this.attack && this.canAct()) {
      this.facing = opp.x >= this.x ? 1 : -1;
    }

    // Blocking requires standing still and holding down.
    this.blocking = this.grounded && this.canAct() && !this.attack && this.heldDown;

    // Physics.
    this.vy += GRAVITY * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    if (this.y >= VIEW.GROUND) {
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

  handleInput(opp, game, input) {
    const p = this.player;
    const held = (a) => input.held.has(`${p}.${a}`);
    const consume = (a) => input.consume(`${p}.${a}`);

    this.heldDown = held('down');

    if (!this.attack) {
      const dir = (held('right') ? 1 : 0) - (held('left') ? 1 : 0);
      if (this.grounded) {
        if (this.heldDown) this.vx *= 0.5;
        else if (dir !== 0) this.vx = dir * MOVE_SPEED * this.speedMul;
        else this.vx *= 0.55;
      }
      if (consume('up') && this.grounded) {
        this.vy = JUMP_V;
        this.grounded = false;
      }
      if (consume('punch')) this.startAttack('punch');
      else if (consume('kick')) this.startAttack('kick');
      else if (consume('special')) this.startSpecial(opp, game);
    } else {
      this.heldDown = false;
    }
  }

  aiUpdate(dt, opp, game) {
    if (this.attack) return;
    const dist = opp.x - this.x;
    const adist = Math.abs(dist);

    // Reactive blocking when the opponent swings nearby.
    if (opp.attack && adist < 140 && Math.random() < 0.05) {
      this.ai.block = true;
      this.aiTimer = 0.25;
    }

    this.aiTimer -= dt;
    if (this.aiTimer <= 0) {
      this.aiTimer = 0.14 + Math.random() * 0.2;
      const r = Math.random();
      this.ai = { move: 0, block: false, act: null, jump: false };
      if (adist > 160) {
        this.ai.move = Math.sign(dist);
      } else if (adist < 66) {
        if (r < 0.55) this.ai.act = Math.random() < 0.5 ? 'punch' : 'kick';
        else this.ai.move = -Math.sign(dist);
      } else if (r < 0.62) {
        this.ai.act = Math.random() < 0.45 ? 'punch' : 'kick';
      } else if (r < 0.78) {
        this.ai.block = true;
      } else {
        this.ai.move = -Math.sign(dist);
      }
      if (this.cooldown <= 0 && adist < 430 && Math.random() < 0.3) this.ai.act = 'special';
      if (adist > 130 && this.grounded && Math.random() < 0.18) this.ai.jump = true;
    }

    this.heldDown = this.ai.block && this.grounded;
    if (this.grounded && !this.heldDown) {
      if (this.ai.move !== 0) this.vx = this.ai.move * MOVE_SPEED * this.speedMul * 0.9;
      else this.vx *= 0.6;
    }
    if (this.ai.jump && this.grounded) {
      this.vy = JUMP_V;
      this.grounded = false;
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
    const def = ATTACKS[name];
    this.attack = { name, def, t: 0, phase: 'startup', hasHit: false };
  }

  startSpecial(opp, game) {
    if (this.cooldown > 0 || this.attack || !this.canAct()) return;
    this.cooldown = this.def.specialCost;
    const type = this.def.special;

    if (type === 'dash') {
      this.attack = {
        name: 'special',
        def: { startup: 0.05, active: 0.16, recovery: 0.26, damage: 14, reach: 76, top: 108, h: 62, kb: 340, hitstun: 0.3 },
        t: 0, phase: 'startup', hasHit: false, dash: true,
      };
      this.invuln = 0.28;
      return;
    }
    if (type === 'teleport') {
      const behind = opp.x + (this.facing > 0 ? 64 : -64);
      this.x = clamp(behind, 44, VIEW.W - 44);
      this.facing = opp.x < this.x ? -1 : 1;
      this.invuln = 0.24;
      this.attack = {
        name: 'special',
        def: { startup: 0.05, active: 0.12, recovery: 0.3, damage: 13, reach: 64, top: 112, h: 66, kb: 280, hitstun: 0.32 },
        t: 0, phase: 'startup', hasHit: false,
      };
      return;
    }
    if (type === 'heal') {
      this.regenLeft = 2.2;
      this.regenRate = 16;
      this.attack = { name: 'special', def: { startup: 0.3, active: 0.05, recovery: 0.3, damage: 0, reach: 0, top: 0, h: 0, kb: 0, hitstun: 0 }, t: 0, phase: 'startup', hasHit: false };
      return;
    }
    if (type === 'slam') {
      this.armor = 1.2;
      this.attack = {
        name: 'special',
        def: { startup: 0.24, active: 0.14, recovery: 0.42, damage: 15, reach: 118, top: 64, h: 44, kb: 380, hitstun: 0.4 },
        t: 0, phase: 'startup', hasHit: false, slam: true, spawned: false,
      };
      return;
    }
    // Projectile-based specials (fireball / ice / rock / gust).
    this.attack = {
      name: 'special',
      def: { startup: 0.18, active: 0.03, recovery: 0.3, damage: 0, reach: 0, top: 0, h: 0, kb: 0, hitstun: 0 },
      t: 0, phase: 'startup', hasHit: false, type, spawned: false,
    };
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

// --- Special ability projectiles -----------------------------------------

function spawnSpecial(type, f, game) {
  const dir = f.facing;
  const px = f.x + dir * 46;
  const py = f.y - 96;
  const mk = (o) =>
    game.projectiles.push(
      Object.assign(
        {
          x: px, y: py, vx: dir * 440, vy: 0, w: 34, h: 34, owner: f,
          damage: 9, stun: 0.18, freeze: false, gravity: 0, life: 2.2,
          kind: type, color: f.color, accent: f.accent, spin: 0,
        },
        o
      )
    );
  switch (type) {
    case 'fireball':
      mk({ damage: 9, stun: 0.18, vx: dir * 460, w: 38, h: 38 });
      break;
    case 'ice':
      mk({ damage: 6, stun: 1.1, freeze: true, vx: dir * 330, w: 30, h: 30 });
      break;
    case 'rock':
      mk({ damage: 13, stun: 0.5, vx: dir * 360, vy: -300, gravity: 950, w: 34, h: 34, life: 3, spin: 8 });
      break;
    case 'gust':
      for (let i = -1; i <= 1; i++) {
        mk({ damage: 5, stun: 0.12, vx: dir * 520, vy: i * 150, w: 28, h: 28, life: 1.1 });
      }
      break;
  }
}

function spawnSlam(f, game) {
  for (const dir of [-1, 1]) {
    game.projectiles.push({
      x: f.x + dir * 40, y: VIEW.GROUND - 18, vx: dir * 540, vy: 0, w: 44, h: 34,
      owner: f, damage: 12, stun: 0.35, freeze: false, gravity: 0, life: 1.1,
      kind: 'shock', color: f.color, accent: f.accent, spin: 0,
    });
  }
  game.spawnHit(f.x, VIEW.GROUND - 20, f.accent);
}

// --- Game ----------------------------------------------------------------

export class Game {
  constructor(canvas, config) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.p1 = new Fighter(config.p1, { x: 280, facing: 1, player: 'p1' });
    this.p2 = new Fighter(config.p2, { x: 680, facing: -1, player: 'p2', isCPU: config.cpu });
    this.cpu = config.cpu;
    this.projectiles = [];
    this.effects = [];
    this.round = 1;
    this.wins = { p1: 0, p2: 0 };
    this.phase = 'intro';
    this.introTimer = 1.7;
    this.koTimer = 0;
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
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    this.last = performance.now();
    this.render(); // paint the opening frame immediately
    this.raf = requestAnimationFrame(this._loop);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
  }

  press(action) {
    if (!this.input.held.has(action)) this.input.pressed.add(action);
    this.input.held.add(action);
  }

  release(action) {
    this.input.held.delete(action);
  }

  _onKeyDown(e) {
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
    const active = this.phase === 'fight';

    if (this.phase === 'intro') {
      this.introTimer -= dt;
      if (this.introTimer <= 0) this.phase = 'fight';
    }

    this.p1.update(dt, this.p2, this, active);
    this.p2.update(dt, this.p1, this, active);

    // Keep fighters from overlapping.
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
        this.spawnHit(p.x, VIEW.GROUND - 10, p.accent || p.color);
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

    // Particles.
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.vy += 900 * dt;
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      e.life -= dt;
      if (e.life <= 0) this.effects.splice(i, 1);
    }

    this.checkKO(dt);
  }

  checkKO(dt) {
    if (this.phase === 'fight') {
      const p1Down = this.p1.hp <= 0;
      const p2Down = this.p2.hp <= 0;
      if (p1Down || p2Down) {
        this.phase = 'ko';
        this.koTimer = 2.4;
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
        if (this.wins.p1 >= 2 || this.wins.p2 >= 2) {
          this.phase = 'over';
          const winner = this.wins.p1 >= 2 ? this.p1 : this.p2;
          this.message = `${winner.name} WINS THE MATCH`;
          this.subMessage = '';
          if (this.onMatchEnd) this.onMatchEnd(`${winner.name} wins the match!`);
        } else {
          this.round++;
          this.p1.reset(280, 1);
          this.p2.reset(680, -1);
          this.projectiles.length = 0;
          this.effects.length = 0;
          this.phase = 'intro';
          this.introTimer = 1.6;
        }
      }
    }
  }

  spawnHit(x, y, color) {
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 60 + Math.random() * 220;
      this.effects.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 70,
        life: 0.35, max: 0.35,
        color, size: 3 + Math.random() * 4,
      });
    }
  }

  // --- Rendering ---------------------------------------------------------

  render() {
    const ctx = this.ctx;
    drawBackground(ctx);
    for (const f of [this.p1, this.p2]) drawFighter(ctx, f);
    for (const p of this.projectiles) drawProjectile(ctx, p);
    for (const e of this.effects) {
      ctx.globalAlpha = Math.max(0, e.life / e.max);
      ctx.fillStyle = e.color;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    drawHUD(ctx, this);
    drawMessages(ctx, this);
  }
}

// --- Drawing helpers -----------------------------------------------------

function drawBackground(ctx) {
  const g = ctx.createLinearGradient(0, 0, 0, VIEW.H);
  g.addColorStop(0, '#140a2e');
  g.addColorStop(0.55, '#2b1450');
  g.addColorStop(1, '#4b1f5e');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIEW.W, VIEW.H);

  // Moon.
  ctx.fillStyle = 'rgba(255, 236, 200, 0.9)';
  ctx.beginPath();
  ctx.arc(780, 110, 46, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 236, 200, 0.12)';
  ctx.beginPath();
  ctx.arc(780, 110, 90, 0, Math.PI * 2);
  ctx.fill();

  // Skyline.
  const buildings = [
    [40, 250, 90, 220], [140, 300, 70, 170], [220, 220, 110, 250],
    [340, 320, 80, 150], [430, 260, 100, 210], [540, 300, 70, 170],
    [620, 210, 120, 260], [760, 280, 90, 190], [860, 320, 80, 150],
  ];
  ctx.fillStyle = 'rgba(10, 6, 24, 0.85)';
  for (const [x, y, w, h] of buildings) ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(255, 210, 120, 0.35)';
  for (const [x, y, w, h] of buildings) {
    for (let wy = y + 14; wy < y + h - 10; wy += 26) {
      for (let wx = x + 10; wx < x + w - 10; wx += 22) {
        if ((wx + wy) % 3 === 0) ctx.fillRect(wx, wy, 8, 12);
      }
    }
  }

  // Ground.
  const gg = ctx.createLinearGradient(0, VIEW.GROUND, 0, VIEW.H);
  gg.addColorStop(0, '#2f2140');
  gg.addColorStop(1, '#150c22');
  ctx.fillStyle = gg;
  ctx.fillRect(0, VIEW.GROUND, VIEW.W, VIEW.H - VIEW.GROUND);
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, VIEW.GROUND);
  ctx.lineTo(VIEW.W, VIEW.GROUND);
  ctx.stroke();
}

function drawFighter(ctx, f) {
  const x = f.x;
  const feet = f.y;
  const dir = f.facing;
  const crouch = f.blocking ? 10 : 0;
  const hipY = feet - 60 + crouch;
  const shY = feet - 108 + crouch;
  const headY = feet - 130 + crouch;

  const body = f.hurtFlash > 0 ? '#ffffff' : f.color;
  const accent = f.accent;

  // Shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(x, VIEW.GROUND + 6, 36, 9, 0, 0, Math.PI * 2);
  ctx.fill();

  const moving = Math.abs(f.vx) > 20 && f.grounded && !f.attack && f.stun <= 0;
  const swing = Math.sin(f.walkPhase);
  let frontLeg = moving ? swing * 16 : 0;
  let backLeg = moving ? -swing * 16 : 0;
  if (!f.grounded) {
    frontLeg = 12;
    backLeg = -14;
  }

  ctx.lineCap = 'round';

  // Legs.
  const kicking = f.attack && f.attack.name === 'kick' && f.attack.phase === 'active';
  ctx.strokeStyle = body;
  ctx.lineWidth = 15;
  ctx.beginPath();
  ctx.moveTo(x - 8, hipY);
  ctx.lineTo(x - 10 + backLeg, feet);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + 8, hipY);
  if (kicking) ctx.lineTo(x + dir * 74, feet - 40);
  else ctx.lineTo(x + 10 + frontLeg, feet);
  ctx.stroke();

  // Torso.
  ctx.fillStyle = body;
  roundRect(ctx, x - 23, shY, 46, hipY - shY + 6, 12);
  ctx.fill();
  ctx.fillStyle = accent;
  ctx.fillRect(x - 23, hipY - 6, 46, 9);

  // Arms.
  const shFrontX = x + dir * 15;
  const shFrontY = shY + 14;
  ctx.strokeStyle = body;
  ctx.lineWidth = 13;
  const punching = f.attack && f.attack.name === 'punch' && f.attack.phase === 'active';
  const casting = f.attack && f.attack.name === 'special' && f.attack.phase !== 'recovery';
  if (punching) {
    ctx.beginPath();
    ctx.moveTo(shFrontX, shFrontY);
    ctx.lineTo(x + dir * 66, shFrontY);
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(x + dir * 70, shFrontY, 9, 0, Math.PI * 2);
    ctx.fill();
  } else if (casting) {
    ctx.beginPath();
    ctx.moveTo(shFrontX, shFrontY);
    ctx.lineTo(x + dir * 58, shFrontY - 10);
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.arc(x + dir * 62, shFrontY - 10, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  } else if (f.blocking) {
    ctx.beginPath();
    ctx.moveTo(shFrontX, shFrontY);
    ctx.lineTo(x + dir * 22, shFrontY - 26);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(shFrontX, shFrontY);
    ctx.lineTo(x + dir * 22, shFrontY + 28);
    ctx.stroke();
  }
  // Back arm.
  ctx.beginPath();
  ctx.moveTo(x - dir * 15, shFrontY);
  ctx.lineTo(x - dir * 24, shFrontY + 30);
  ctx.stroke();

  // Head.
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(x, headY, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = accent;
  ctx.fillRect(x - 18, headY - 6, 36, 8);
  ctx.fillStyle = '#0f0a1a';
  ctx.fillRect(x + dir * 4 - 3, headY + 1, 6, 6);

  // Frozen overlay.
  if (f.frozen > 0) {
    ctx.fillStyle = 'rgba(180, 230, 255, 0.45)';
    roundRect(ctx, x - 30, feet - 150, 60, 156, 12);
    ctx.fill();
    ctx.strokeStyle = 'rgba(220, 245, 255, 0.9)';
    ctx.lineWidth = 2;
    roundRect(ctx, x - 30, feet - 150, 60, 156, 12);
    ctx.stroke();
  }

  // Armor aura (Titan slam).
  if (f.armor > 0) {
    ctx.strokeStyle = 'rgba(253, 230, 138, 0.8)';
    ctx.lineWidth = 3;
    roundRect(ctx, x - 32, feet - 152, 64, 158, 14);
    ctx.stroke();
  }

  // Regen aura (Verdant).
  if (f.regenLeft > 0) {
    ctx.strokeStyle = 'rgba(134, 239, 172, 0.85)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, feet - 70, 46 + Math.sin(performance.now() / 120) * 4, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawProjectile(ctx, p) {
  ctx.save();
  ctx.translate(p.x, p.y);
  const isShock = p.kind === 'shock';
  if (isShock) {
    ctx.fillStyle = p.accent;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.moveTo(-p.w / 2, p.h / 2);
    ctx.lineTo(-p.w / 4, -p.h / 2);
    ctx.lineTo(0, 0);
    ctx.lineTo(p.w / 4, -p.h / 2);
    ctx.lineTo(p.w / 2, p.h / 2);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.fillStyle = p.color;
    ctx.globalAlpha = 0.95;
    ctx.beginPath();
    ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.accent;
    ctx.beginPath();
    ctx.arc(0, 0, p.w / 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.arc(0, 0, p.w, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawHUD(ctx, game) {
  const barW = 360;
  const barH = 26;
  drawHealthBar(ctx, 30, 30, barW, barH, game.p1, false);
  drawHealthBar(ctx, VIEW.W - 30 - barW, 30, barW, barH, game.p2, true);

  // Round pips.
  for (let i = 0; i < 2; i++) {
    ctx.fillStyle = i < game.wins.p1 ? '#fbbf24' : 'rgba(255,255,255,0.25)';
    ctx.beginPath();
    ctx.arc(VIEW.W / 2 - 26 + i * 22, 43, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = i < game.wins.p2 ? '#fbbf24' : 'rgba(255,255,255,0.25)';
    ctx.beginPath();
    ctx.arc(VIEW.W / 2 + 26 - i * 22, 43, 7, 0, Math.PI * 2);
    ctx.fill();
  }

  // Special cooldown indicator.
  drawCooldown(ctx, 30, 66, 150, 8, game.p1, false);
  drawCooldown(ctx, VIEW.W - 30 - 150, 66, 150, 8, game.p2, true);
}

function drawHealthBar(ctx, x, y, w, h, f, flip) {
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  roundRect(ctx, x - 3, y - 3, w + 6, h + 6, 8);
  ctx.fill();
  const ratio = clamp(f.hp / f.maxHp, 0, 1);
  const fw = w * ratio;
  const grad = ctx.createLinearGradient(x, 0, x + w, 0);
  grad.addColorStop(0, ratio > 0.3 ? '#22c55e' : '#ef4444');
  grad.addColorStop(1, ratio > 0.3 ? '#86efac' : '#fca5a5');
  ctx.fillStyle = grad;
  if (flip) roundRect(ctx, x + w - fw, y, fw, h, 6);
  else roundRect(ctx, x, y, fw, h, 6);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 2;
  roundRect(ctx, x, y, w, h, 6);
  ctx.stroke();

  ctx.font = 'bold 20px system-ui, sans-serif';
  ctx.textAlign = flip ? 'right' : 'left';
  ctx.fillStyle = '#fff';
  ctx.fillText(f.name.toUpperCase(), flip ? x + w : x, y - 12);
  ctx.font = '13px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText(f.def.specialName, flip ? x + w : x, y + h + 20);
  ctx.textAlign = 'left';
}

function drawCooldown(ctx, x, y, w, h, f, flip) {
  const ready = f.cooldown <= 0;
  const ratio = ready ? 1 : 1 - f.cooldown / f.def.specialCost;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  roundRect(ctx, x, y, w, h, 4);
  ctx.fill();
  ctx.fillStyle = ready ? '#fbbf24' : '#64748b';
  const fw = w * clamp(ratio, 0, 1);
  if (flip) roundRect(ctx, x + w - fw, y, fw, h, 4);
  else roundRect(ctx, x, y, fw, h, 4);
  ctx.fill();
}

function drawMessages(ctx, game) {
  ctx.textAlign = 'center';
  if (game.phase === 'intro') {
    ctx.font = 'bold 64px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fillText(game.introTimer > 0.7 ? `ROUND ${game.round}` : 'FIGHT!', VIEW.W / 2, VIEW.H / 2 - 30);
  } else if (game.phase === 'ko' || game.phase === 'over') {
    ctx.font = 'bold 58px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(251, 191, 36, 0.95)';
    ctx.fillText(game.message, VIEW.W / 2, VIEW.H / 2 - 20);
    if (game.subMessage) {
      ctx.font = '22px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillText(game.subMessage, VIEW.W / 2, VIEW.H / 2 + 26);
    }
  }
  ctx.textAlign = 'left';
}

function roundRect(ctx, x, y, w, h, r) {
  const rad = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

export { CHARACTERS };
