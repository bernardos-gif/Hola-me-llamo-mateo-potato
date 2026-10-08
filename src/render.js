// All canvas drawing: stage, fighters, projectiles, effects, HUD.
import { VIEW } from './config.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp(((n >> 16) & 255) + amt, 0, 255);
  const g = clamp(((n >> 8) & 255) + amt, 0, 255);
  const b = clamp((n & 255) + amt, 0, 255);
  return `rgb(${r},${g},${b})`;
}

function rr(ctx, x, y, w, h, r) {
  const rad = Math.max(0, Math.min(r, h / 2, w / 2));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function limb(ctx, ax, ay, bx, by, w, color, outline) {
  ctx.lineCap = 'round';
  ctx.strokeStyle = outline;
  ctx.lineWidth = w + 5;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
}

export function renderGame(ctx, game) {
  ctx.save();
  if (game.shake > 0.5) {
    ctx.translate((Math.random() - 0.5) * game.shake, (Math.random() - 0.5) * game.shake);
  }
  drawStage(ctx, game);
  drawFighter(ctx, game.p2, game);
  drawFighter(ctx, game.p1, game);
  for (const p of game.projectiles) drawProjectile(ctx, p);
  for (const e of game.effects) drawEffect(ctx, e);
  ctx.restore();

  if (game.flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${Math.min(0.5, game.flash)})`;
    ctx.fillRect(0, 0, VIEW.W, VIEW.H);
  }

  drawHUD(ctx, game);
  drawMessages(ctx, game);
  if (game.paused) drawPause(ctx);
}

// --- Stage ---------------------------------------------------------------

function drawStage(ctx, game) {
  const t = game.time;

  const sky = ctx.createLinearGradient(0, 0, 0, VIEW.H);
  sky.addColorStop(0, '#08041a');
  sky.addColorStop(0.45, '#241046');
  sky.addColorStop(0.75, '#5b1d63');
  sky.addColorStop(1, '#8a2b5c');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, VIEW.W, VIEW.H);

  // Stars.
  for (let i = 0; i < 80; i++) {
    const sx = (i * 149) % VIEW.W;
    const sy = (i * 83) % 280;
    const a = 0.25 + 0.6 * Math.abs(Math.sin(t * 1.6 + i));
    ctx.globalAlpha = a;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx, sy, 2, 2);
  }
  ctx.globalAlpha = 1;

  // Moon.
  const mg = ctx.createRadialGradient(790, 108, 10, 790, 108, 120);
  mg.addColorStop(0, 'rgba(255,240,210,0.55)');
  mg.addColorStop(1, 'rgba(255,240,210,0)');
  ctx.fillStyle = mg;
  ctx.beginPath();
  ctx.arc(790, 108, 120, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#ffedc7';
  ctx.beginPath();
  ctx.arc(790, 108, 46, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(220,190,150,0.35)';
  ctx.beginPath();
  ctx.arc(776, 96, 9, 0, TAU);
  ctx.arc(802, 118, 6, 0, TAU);
  ctx.arc(792, 128, 4, 0, TAU);
  ctx.fill();

  // Clouds.
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  for (let i = 0; i < 4; i++) {
    const cx = ((i * 340 + t * 12) % (VIEW.W + 300)) - 150;
    const cy = 70 + i * 40;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 110, 26, 0, 0, TAU);
    ctx.ellipse(cx + 70, cy + 8, 80, 20, 0, 0, TAU);
    ctx.fill();
  }

  // Far skyline.
  ctx.fillStyle = '#150a2b';
  for (let i = 0; i < 14; i++) {
    const bw = 70 + ((i * 37) % 60);
    const bh = 120 + ((i * 53) % 130);
    ctx.fillRect(i * 72 - 20, VIEW.GROUND - bh, bw, bh);
  }

  // Near skyline with lit windows.
  const buildings = [
    [10, 250, 96, 220], [120, 300, 74, 170], [206, 214, 116, 256],
    [336, 316, 84, 154], [432, 256, 104, 214], [548, 298, 72, 172],
    [628, 206, 124, 264], [764, 276, 92, 194], [868, 318, 84, 152],
  ];
  ctx.fillStyle = '#0c0619';
  for (const [x, y, w, h] of buildings) ctx.fillRect(x, y, w, h);
  for (const [x, y, w, h] of buildings) {
    for (let wy = y + 14; wy < y + h - 12; wy += 26) {
      for (let wx = x + 10; wx < x + w - 12; wx += 22) {
        if ((wx * 7 + wy * 3) % 5 < 2) {
          const flicker = 0.25 + 0.35 * Math.abs(Math.sin(t * 2 + wx + wy));
          ctx.fillStyle = `rgba(255,205,120,${flicker})`;
          ctx.fillRect(wx, wy, 8, 12);
        }
      }
    }
  }

  // Spotlights sweeping the ring.
  for (let i = 0; i < 3; i++) {
    const bx = 180 + i * 300;
    const angle = Math.sin(t * 0.5 + i * 2) * 0.35;
    ctx.save();
    ctx.translate(bx, -20);
    ctx.rotate(angle);
    const sg = ctx.createLinearGradient(0, 0, 0, VIEW.GROUND);
    sg.addColorStop(0, 'rgba(255,235,180,0.16)');
    sg.addColorStop(1, 'rgba(255,235,180,0)');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.moveTo(-10, 0);
    ctx.lineTo(10, 0);
    ctx.lineTo(150, VIEW.GROUND);
    ctx.lineTo(-150, VIEW.GROUND);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Floor.
  const floor = ctx.createLinearGradient(0, VIEW.GROUND, 0, VIEW.H);
  floor.addColorStop(0, '#3a2352');
  floor.addColorStop(1, '#150c22');
  ctx.fillStyle = floor;
  ctx.fillRect(0, VIEW.GROUND, VIEW.W, VIEW.H - VIEW.GROUND);

  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 16; i++) {
    const x = (i / 16) * VIEW.W;
    ctx.beginPath();
    ctx.moveTo(VIEW.W / 2 + (x - VIEW.W / 2) * 0.35, VIEW.GROUND);
    ctx.lineTo(x, VIEW.H);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(251,191,36,0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, VIEW.GROUND);
  ctx.lineTo(VIEW.W, VIEW.GROUND);
  ctx.stroke();
}

// --- Fighters ------------------------------------------------------------

function drawFighter(ctx, f, game) {
  const t = game.time;
  const dir = f.facing;
  const feet = f.y;
  const idle = f.grounded && !f.attack && f.stun <= 0 && !f.ko;
  const bob = idle ? Math.sin(t * 4 + (f.player === 'p1' ? 0 : 1.6)) * 2 : 0;
  const crouch = f.blocking ? 12 : 0;

  const hipY = feet - 62 + crouch + bob;
  const neckY = feet - 114 + crouch + bob;
  const headY = feet - 136 + crouch + bob;

  const body = f.hurtFlash > 0 ? '#ffffff' : f.color;
  const back = shade(f.color, -55);
  const outline = shade(f.color, -95);
  const accent = f.accent;

  // Ground shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.38)';
  ctx.beginPath();
  ctx.ellipse(f.x, VIEW.GROUND + 6, 36, 9, 0, 0, TAU);
  ctx.fill();

  ctx.save();
  if (f.ko) {
    ctx.translate(f.x, feet - 40);
    ctx.rotate(f.koAngle);
    ctx.translate(-f.x, -(feet - 40));
  }

  const walk = f.grounded && Math.abs(f.vx) > 20 && !f.attack && f.stun <= 0;
  const swing = walk ? Math.sin(f.walkPhase) * 16 : 0;
  const air = !f.grounded;

  const punching = f.attack && f.attack.name === 'punch' && f.attack.phase === 'active';
  const kicking = f.attack && f.attack.name === 'kick' && f.attack.phase === 'active';
  const casting = f.attack && f.attack.name === 'special' && f.attack.phase !== 'recovery';

  const backHip = [f.x - dir * 9, hipY];
  const frontHip = [f.x + dir * 9, hipY];
  const backFoot = [f.x - dir * 16 - swing, feet];
  const frontFoot = kicking ? [f.x + dir * 82, feet - 54] : [f.x + dir * 16 + swing, feet];
  const backShoulder = [f.x - dir * 14, neckY + 6];
  const frontShoulder = [f.x + dir * 14, neckY + 6];

  let frontHand = [f.x + dir * 24, neckY + 34];
  let backHand = [f.x - dir * 24, neckY + 34];
  if (punching) frontHand = [f.x + dir * 74, neckY + 6];
  else if (casting) {
    frontHand = [f.x + dir * 62, neckY - 6];
    backHand = [f.x + dir * 48, neckY + 18];
  } else if (f.blocking) {
    frontHand = [f.x + dir * 24, neckY - 24];
    backHand = [f.x + dir * 14, neckY + 4];
  }

  if (air) {
    frontFoot[1] = feet - 26;
    backFoot[1] = feet - 12;
  }

  // Back limbs.
  limb(ctx, backHip[0], backHip[1], backFoot[0], backFoot[1], 14, back, outline);
  limb(ctx, backShoulder[0], backShoulder[1], backHand[0], backHand[1], 12, back, outline);

  // Torso.
  ctx.fillStyle = outline;
  rr(ctx, f.x - 25, neckY - 4, 50, hipY - neckY + 16, 14);
  ctx.fill();
  ctx.fillStyle = body;
  rr(ctx, f.x - 22, neckY - 2, 44, hipY - neckY + 12, 12);
  ctx.fill();
  // Belt.
  ctx.fillStyle = accent;
  rr(ctx, f.x - 22, hipY - 4, 44, 9, 3);
  ctx.fill();

  // Front limbs.
  limb(ctx, frontHip[0], frontHip[1], frontFoot[0], frontFoot[1], 15, body, outline);
  limb(ctx, frontShoulder[0], frontShoulder[1], frontHand[0], frontHand[1], 13, body, outline);

  // Fist / casting orb.
  if (punching) {
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(frontHand[0], frontHand[1], 10, 0, TAU);
    ctx.fill();
  } else if (casting) {
    const pulse = 12 + Math.sin(t * 20) * 3;
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(frontHand[0], frontHand[1], pulse, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Head.
  ctx.fillStyle = outline;
  ctx.beginPath();
  ctx.arc(f.x, headY, 20, 0, TAU);
  ctx.fill();
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(f.x, headY, 17, 0, TAU);
  ctx.fill();

  // Hair.
  ctx.fillStyle = f.def.hair || accent;
  ctx.beginPath();
  ctx.arc(f.x, headY - 3, 17, Math.PI, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(f.x - dir * 14, headY - 10);
  ctx.lineTo(f.x - dir * 30, headY - 20);
  ctx.lineTo(f.x - dir * 12, headY - 2);
  ctx.closePath();
  ctx.fill();

  // Headband + eye.
  ctx.fillStyle = accent;
  ctx.fillRect(f.x - 18, headY - 4, 36, 7);
  ctx.fillStyle = '#0f0a1a';
  ctx.fillRect(f.x + dir * 5 - 3, headY + 3, 6, 6);

  ctx.restore();

  // Status overlays.
  if (f.frozen > 0) {
    ctx.fillStyle = 'rgba(180,230,255,0.42)';
    rr(ctx, f.x - 32, feet - 158, 64, 164, 14);
    ctx.fill();
    ctx.strokeStyle = 'rgba(220,245,255,0.9)';
    ctx.lineWidth = 2;
    rr(ctx, f.x - 32, feet - 158, 64, 164, 14);
    ctx.stroke();
  }
  if (f.armor > 0) {
    ctx.strokeStyle = 'rgba(253,230,138,0.85)';
    ctx.lineWidth = 3;
    rr(ctx, f.x - 34, feet - 160, 68, 166, 16);
    ctx.stroke();
  }
  if (f.regenLeft > 0) {
    ctx.strokeStyle = 'rgba(134,239,172,0.85)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(f.x, feet - 72, 48 + Math.sin(t * 8) * 4, 0, TAU);
    ctx.stroke();
  }
}

// --- Projectiles & effects ----------------------------------------------

function drawProjectile(ctx, p) {
  ctx.save();
  ctx.translate(p.x, p.y);
  if (p.kind === 'shock') {
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
  } else if (p.kind === 'gust') {
    ctx.strokeStyle = p.accent;
    ctx.lineWidth = 4;
    ctx.globalAlpha = 0.9;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.arc(-p.w / 2, i * 8, p.w / 2, -1, 1);
      ctx.stroke();
    }
  } else {
    const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, p.w);
    glow.addColorStop(0, p.accent);
    glow.addColorStop(0.4, p.color);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, p.w, 0, TAU);
    ctx.fill();
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(0, 0, p.w / 2, 0, TAU);
    ctx.fill();
    ctx.fillStyle = p.accent;
    ctx.beginPath();
    ctx.arc(0, 0, p.w / 4, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawEffect(ctx, e) {
  const a = Math.max(0, e.life / e.max);
  if (e.kind === 'text') {
    ctx.globalAlpha = a;
    ctx.textAlign = 'center';
    ctx.font = `900 ${e.size || 22}px system-ui, sans-serif`;
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.strokeText(e.text, e.x, e.y);
    ctx.fillStyle = e.color;
    ctx.fillText(e.text, e.x, e.y);
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
    return;
  }
  ctx.globalAlpha = a;
  ctx.fillStyle = e.color;
  if (e.kind === 'dust') {
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.size * (1.6 - a), 0, TAU);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.size, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// --- HUD -----------------------------------------------------------------

function drawHUD(ctx, game) {
  const barW = 350;
  const barH = 24;
  drawHealthBar(ctx, 30, 34, barW, barH, game.p1, false);
  drawHealthBar(ctx, VIEW.W - 30 - barW, 34, barW, barH, game.p2, true);
  drawCooldown(ctx, 30, 68, 140, 7, game.p1, false);
  drawCooldown(ctx, VIEW.W - 30 - 140, 68, 140, 7, game.p2, true);

  // Timer.
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  rr(ctx, VIEW.W / 2 - 42, 24, 84, 56, 12);
  ctx.fill();
  ctx.strokeStyle = 'rgba(251,191,36,0.8)';
  ctx.lineWidth = 2;
  rr(ctx, VIEW.W / 2 - 42, 24, 84, 56, 12);
  ctx.stroke();
  const secs = Math.ceil(game.timer);
  ctx.fillStyle = secs <= 10 ? '#f87171' : '#fde68a';
  ctx.font = '900 34px system-ui, sans-serif';
  ctx.fillText(String(secs), VIEW.W / 2, 66);

  // Round pips.
  for (let i = 0; i < 2; i++) {
    drawPip(ctx, VIEW.W / 2 - 66 - i * 20, 100, game.wins.p1 > i);
    drawPip(ctx, VIEW.W / 2 + 66 + i * 20, 100, game.wins.p2 > i);
  }
  ctx.textAlign = 'center';
  ctx.font = '700 12px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillText(`ROUND ${game.round}`, VIEW.W / 2, 122);
  ctx.textAlign = 'left';

  // Combo counters.
  drawCombo(ctx, game.p1, 30, 110, false);
  drawCombo(ctx, game.p2, VIEW.W - 30, 110, true);
}

function drawPip(ctx, x, y, on) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = on ? '#fbbf24' : 'rgba(255,255,255,0.2)';
  ctx.fillRect(-6, -6, 12, 12);
  ctx.restore();
}

function drawHealthBar(ctx, x, y, w, h, f, flip) {
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  rr(ctx, x - 4, y - 4, w + 8, h + 8, 10);
  ctx.fill();
  ctx.fillStyle = '#1a1030';
  rr(ctx, x, y, w, h, 7);
  ctx.fill();

  const lagW = w * clamp(f.hpDisplay / f.maxHp, 0, 1);
  ctx.fillStyle = '#f43f5e';
  rr(ctx, flip ? x + w - lagW : x, y, lagW, h, 7);
  ctx.fill();

  const r = clamp(f.hp / f.maxHp, 0, 1);
  const grad = ctx.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, r > 0.3 ? '#a3e635' : '#fb923c');
  grad.addColorStop(1, r > 0.3 ? '#22c55e' : '#ef4444');
  ctx.fillStyle = grad;
  const curW = w * r;
  rr(ctx, flip ? x + w - curW : x, y, curW, h, 7);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 2;
  rr(ctx, x, y, w, h, 7);
  ctx.stroke();

  ctx.font = '900 19px system-ui, sans-serif';
  ctx.textAlign = flip ? 'right' : 'left';
  ctx.fillStyle = '#fff';
  ctx.fillText(f.name.toUpperCase(), flip ? x + w : x, y - 12);
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.fillText(f.def.specialName, flip ? x + w : x, y + h + 16);
  ctx.textAlign = 'left';
}

function drawCooldown(ctx, x, y, w, h, f, flip) {
  const ready = f.cooldown <= 0;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  rr(ctx, x, y, w, h, 4);
  ctx.fill();
  const ratio = ready ? 1 : 1 - f.cooldown / f.def.specialCost;
  const fw = w * clamp(ratio, 0, 1);
  ctx.fillStyle = ready ? '#fbbf24' : '#64748b';
  rr(ctx, flip ? x + w - fw : x, y, fw, h, 4);
  ctx.fill();
}

function drawCombo(ctx, f, x, y, flip) {
  if (f.comboCount < 2) return;
  ctx.textAlign = flip ? 'right' : 'left';
  ctx.font = '900 30px system-ui, sans-serif';
  ctx.fillStyle = '#fbbf24';
  ctx.fillText(`${f.comboCount}`, flip ? x - 70 : x, y + 22);
  ctx.font = '900 14px system-ui, sans-serif';
  ctx.fillStyle = '#fff';
  ctx.fillText('HITS', flip ? x : x + 22, y + 22);
  ctx.textAlign = 'left';
}

function drawMessages(ctx, game) {
  ctx.textAlign = 'center';
  if (game.phase === 'intro') {
    const label = game.introTimer > 0.75 ? `ROUND ${game.round}` : 'FIGHT!';
    const scale = 1 + Math.max(0, (game.introTimer - 0.75) % 0.5) * 0.2;
    ctx.save();
    ctx.translate(VIEW.W / 2, VIEW.H / 2 - 30);
    ctx.scale(scale, scale);
    ctx.font = '900 68px system-ui, sans-serif';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText(label, 0, 0);
    ctx.fillStyle = game.introTimer > 0.75 ? '#fde68a' : '#f87171';
    ctx.fillText(label, 0, 0);
    ctx.restore();
  } else if (game.phase === 'ko' || game.phase === 'over') {
    ctx.font = '900 58px system-ui, sans-serif';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText(game.message, VIEW.W / 2, VIEW.H / 2 - 20);
    ctx.fillStyle = '#fbbf24';
    ctx.fillText(game.message, VIEW.W / 2, VIEW.H / 2 - 20);
    if (game.subMessage) {
      ctx.font = '700 22px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(game.subMessage, VIEW.W / 2, VIEW.H / 2 + 26);
    }
  }
  ctx.textAlign = 'left';
}

function drawPause(ctx) {
  ctx.fillStyle = 'rgba(8,4,20,0.72)';
  ctx.fillRect(0, 0, VIEW.W, VIEW.H);
  ctx.textAlign = 'center';
  ctx.font = '900 56px system-ui, sans-serif';
  ctx.fillStyle = '#fbbf24';
  ctx.fillText('PAUSED', VIEW.W / 2, VIEW.H / 2 - 10);
  ctx.font = '600 18px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.fillText('Press Esc or P to resume', VIEW.W / 2, VIEW.H / 2 + 30);
  ctx.textAlign = 'left';
}
