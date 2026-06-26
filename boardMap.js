// ===========================================================================
// 5 BOROUGHS ON THE TAKE — boardMap.js
// Birds-eye borough map: top-down visual of all 5 boroughs with color-coded
// lots, player positions, partnerships, active notifications, and actions.
// ===========================================================================
import { getPlayerNotifications } from './notifications.js';
import { effectiveRent } from './economy.js';

// ANSI color codes
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', blink: '\x1b[5m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m', white: '\x1b[37m',
  bgRed: '\x1b[41m', bgGreen: '\x1b[42m', bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m', bgMagenta: '\x1b[45m', bgCyan: '\x1b[46m',
};

const BOROUGH_COLORS = [C.red, C.green, C.yellow, C.blue, C.magenta];

const SPACE_LABELS = {
  payday: 'PAY', career: 'CAR', jail: 'JAL', freeParking: 'FRE', tax: 'TAX',
};

/**
 * Render the birds-eye borough map for a player.
 * Shows all 5 boroughs with color-coded lots.
 */
export function renderBoardMap(state, viewerId) {
  const viewer = state.players[viewerId];
  const notifs = getPlayerNotifications(state, viewerId);
  const notifSpaces = new Set(notifs.map(n => n.payload?.spaceIndex).filter(x => x != null));
  const lines = [];

  // find all player positions
  const playerPositions = {};
  for (const p of Object.values(state.players)) {
    if (!playerPositions[p.position]) playerPositions[p.position] = [];
    playerPositions[p.position].push(p);
  }

  lines.push(`${C.bold}╔══════════════════════════════════════════════════╗${C.reset}`);
  lines.push(`${C.bold}║          5 BOROUGHS — BIRDS EYE MAP             ║${C.reset}`);
  lines.push(`${C.bold}╚══════════════════════════════════════════════════╝${C.reset}`);

  const boroughs = {};
  for (const sp of state.board) {
    if (!boroughs[sp.borough]) boroughs[sp.borough] = [];
    boroughs[sp.borough].push(sp);
  }

  for (const [b, spaces] of Object.entries(boroughs)) {
    const bc = BOROUGH_COLORS[(parseInt(b) - 1) % 5];
    lines.push('');
    lines.push(`${bc}${C.bold}  ═══ Borough ${b} ═══${C.reset}`);

    const row1 = [];
    const row2 = [];

    for (const sp of spaces) {
      const label = SPACE_LABELS[sp.type] || String(sp.index).padStart(2, '0');

      // determine cell color/style
      let cell;
      const isHere = sp.index === viewer?.position;
      const hasNotif = notifSpaces.has(sp.index);
      const playersHere = playerPositions[sp.index] || [];

      if (SPACE_LABELS[sp.type]) {
        // special space
        cell = `${C.dim}[${label}]${C.reset}`;
      } else if (sp.ownerId === viewerId) {
        // your property
        let tag = `${C.bold}${C.cyan}*${label}${C.reset}`;
        if (sp.buildLevel > 0) tag = `${C.bold}${C.cyan}*${label}${C.green}^${sp.buildLevel}${C.reset}`;
        if (sp.buildLevel < 0) tag = `${C.bold}${C.cyan}*${label}${C.red}M${C.reset}`;
        if (sp.partnership) tag += `${C.yellow}P${C.reset}`;
        if (sp.anchorType) tag += `${C.yellow}A${C.reset}`;
        cell = `[${tag}]`;
      } else if (sp.ownerId) {
        // owned by someone else
        let tag = `${C.dim}o${label}${C.reset}`;
        if (sp.buildLevel > 0) tag = `${C.dim}o${label}^${sp.buildLevel}${C.reset}`;
        if (sp.mobOwnerId) tag = `${C.red}M${label}${C.reset}`;
        cell = `[${tag}]`;
      } else {
        // unowned
        cell = `${bc}[.${label}]${C.reset}`;
        if (hasNotif) cell = `${C.bgYellow}${C.bold}[!${label}]${C.reset}`;
      }

      // player position marker
      if (isHere) {
        cell = `${C.bgCyan}${C.bold}${C.white}[>>${label}]${C.reset}`;
      }

      row1.push(cell);

      // second row: player initials at this position
      if (playersHere.length > 0) {
        const initials = playersHere.map(p =>
          p.id === viewerId ? `${C.cyan}U${C.reset}` :
          p.isBot ? `${C.dim}b${C.reset}` : `${C.yellow}${p.name[0]}${C.reset}`
        ).join('');
        row2.push(` ${initials}`.padEnd(6));
      } else {
        row2.push('      ');
      }
    }

    lines.push('  ' + row1.join(' '));
    lines.push('  ' + row2.join(' '));
  }

  // legend
  lines.push('');
  lines.push(`${C.dim}  Legend: ${C.cyan}*${C.reset}${C.dim}=yours ${C.reset}${C.dim}o=other .=free ${C.red}M${C.reset}${C.dim}=mob-owned ${C.green}^N${C.reset}${C.dim}=built`);
  lines.push(`${C.dim}          ${C.yellow}P${C.reset}${C.dim}=partner ${C.yellow}A${C.reset}${C.dim}=anchor ${C.bgYellow}${C.bold}!${C.reset}${C.dim}=notification ${C.bgCyan}>>${C.reset}${C.dim}=you${C.reset}`);

  // summary stats
  const yourProps = viewer?.propertyIds?.length || 0;
  const pendingNotifs = notifs.length;
  lines.push('');
  lines.push(`${C.bold}  Your properties: ${C.cyan}${yourProps}${C.reset}${C.bold} | Pending notifications: ${C.yellow}${pendingNotifs}${C.reset}`);

  return lines.join('\n');
}

/**
 * Render a compact lot detail when a player clicks/inspects a space.
 */
export function renderLotDetail(state, spaceIndex) {
  const sp = state.board[spaceIndex];
  if (!sp) return 'Invalid space.';

  const bc = BOROUGH_COLORS[(sp.borough - 1) % 5];
  const lines = [];

  lines.push(`${bc}${C.bold}═══ Lot #${spaceIndex} — ${sp.type} (Borough ${sp.borough}) ═══${C.reset}`);

  if (SPACE_LABELS[sp.type]) {
    lines.push(`  Special space: ${SPACE_LABELS[sp.type]}`);
    return lines.join('\n');
  }

  const owner = sp.ownerId ? (state.players[sp.ownerId]?.name || sp.ownerId) : 'Unowned';
  lines.push(`  Owner: ${sp.ownerId ? C.cyan + owner + C.reset : C.dim + 'Unowned' + C.reset}`);
  lines.push(`  Price: ${C.yellow}$${sp.basePrice}${C.reset} | Rent: ${C.green}$${effectiveRent(sp)}${C.reset}`);
  lines.push(`  Build level: ${sp.buildLevel < 0 ? C.red + 'Mortgaged' + C.reset : sp.buildLevel}`);

  if (sp.haloBonus > 0) lines.push(`  Halo: ${C.yellow}+${Math.round(sp.haloBonus * 100)}%${C.reset}`);
  if (sp.anchorType) lines.push(`  Anchor: ${C.yellow}${sp.anchorType}${C.reset} (level ${sp.anchorLevel})`);
  if (sp.mobOwnerId) lines.push(`  ${C.red}Mob-owned by ${state.players[sp.mobOwnerId]?.name || sp.mobOwnerId}${C.reset}`);

  if (sp.partnership) {
    const partner = state.players[sp.partnership.partnerId]?.name || sp.partnership.partnerId;
    lines.push(`  Partnership: ${C.yellow}${sp.partnership.ownerSplit}/${sp.partnership.partnerSplit}${C.reset} with ${partner}`);
  }

  // code violation check
  if (state.codeViolations?.[sp.borough]) {
    const v = state.codeViolations[sp.borough];
    lines.push(`  ${C.red}CODE VIOLATION: $${v.penalty} penalty before building${C.reset}`);
  }

  return lines.join('\n');
}
