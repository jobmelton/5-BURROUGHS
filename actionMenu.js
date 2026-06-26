// ===========================================================================
// 5 BOROUGHS ON THE TAKE — actionMenu.js
// Turn action menu: context-dependent list of actions available to a player.
// ===========================================================================
import { CONFIG } from './gameConfig.js';
import { canBuild } from './economy.js';
import { getPlayerNotifications } from './notifications.js';
import { hasRole } from './roles.js';

/**
 * Get all available actions for a player on their turn.
 * Returns an array of { action, label, description, available, details }.
 */
export function getTurnActions(state, playerId) {
  const player = state.players[playerId];
  if (!player) return [];
  const actions = [];

  // --- Always available ---
  actions.push({
    action: 'roll',
    label: 'Roll Dice',
    description: 'Roll two dice and move',
    available: !player.status.jailed,
    category: 'move',
  });

  if (player.status.jailed) {
    actions.push({
      action: 'roll_jail',
      label: 'Roll for Doubles',
      description: 'Roll dice — doubles gets you out of jail',
      available: true,
      category: 'move',
    });
    if (player.cash >= CONFIG.jail.bailCost) {
      actions.push({
        action: 'pay_bail',
        label: `Pay Bail ($${CONFIG.jail.bailCost})`,
        description: 'Pay bail to get out immediately',
        available: true,
        category: 'move',
      });
    }
  }

  // --- Property actions ---
  const buildable = player.propertyIds.filter(idx => {
    const sp = state.board[idx];
    return sp.buildLevel >= 0 && canBuild(state, playerId, idx).ok;
  });
  if (buildable.length > 0) {
    actions.push({
      action: 'build',
      label: 'Build',
      description: `Build on ${buildable.length} eligible property(ies)`,
      available: true,
      category: 'property',
      properties: buildable,
    });
  }

  const mortgageable = player.propertyIds.filter(idx => state.board[idx].buildLevel >= 0);
  if (mortgageable.length > 0) {
    actions.push({
      action: 'mortgage',
      label: 'Mortgage',
      description: `Mortgage one of ${mortgageable.length} properties for cash`,
      available: true,
      category: 'property',
      properties: mortgageable,
    });
  }

  // partnership buyout
  const partnered = player.propertyIds.filter(idx => state.board[idx].partnership);
  if (partnered.length > 0) {
    actions.push({
      action: 'propose_buyout',
      label: 'Propose Buyout',
      description: 'Offer to buy out a partner',
      available: true,
      category: 'property',
      properties: partnered,
    });
  }

  // --- Role-specific actions ---
  if (hasRole(player, 'Boss') || hasRole(player, 'Capo')) {
    actions.push({
      action: 'contact_cross_borough',
      label: 'Cross-Borough Contact',
      description: `Contact a Boss/Capo in another borough ($${CONFIG.notifications.crossBoroughContactFee} fee)`,
      available: player.cash >= CONFIG.notifications.crossBoroughContactFee,
      category: 'role',
    });
  }

  if (hasRole(player, 'LaborBoss')) {
    actions.push({
      action: 'block_construction',
      label: 'Block Construction',
      description: 'Block building in another borough (need partner)',
      available: true,
      category: 'role',
    });
  }

  if (hasRole(player, 'Inspector')) {
    actions.push({
      action: 'code_violation',
      label: 'Create Code Violation',
      description: 'Available for hire to create violations in other boroughs',
      available: true,
      category: 'role',
    });
  }

  if (hasRole(player, 'Banker')) {
    actions.push({
      action: 'offer_loan',
      label: 'Offer Loan',
      description: 'Set terms for pending loan requests',
      available: true,
      category: 'role',
    });
  }

  // --- Action cards ---
  if (player.hand.length > 0) {
    actions.push({
      action: 'play_card',
      label: 'Play Action Card',
      description: `Play one of ${player.hand.length} action card(s)`,
      available: true,
      category: 'card',
      cards: player.hand.map(c => c.type),
    });
  }

  // --- Notifications ---
  const pending = getPlayerNotifications(state, playerId);
  if (pending.length > 0) {
    actions.push({
      action: 'view_notifications',
      label: `Notifications (${pending.length})`,
      description: `${pending.length} pending action(s) requiring your response`,
      available: true,
      category: 'notification',
      count: pending.length,
    });
  }

  // --- Info actions (always available) ---
  actions.push({
    action: 'view_status',
    label: 'View Status',
    description: 'View your stats, roles, properties',
    available: true,
    category: 'info',
  });

  actions.push({
    action: 'view_map',
    label: 'View Map',
    description: 'Birds-eye view of all 5 boroughs',
    available: true,
    category: 'info',
  });

  actions.push({
    action: 'view_scores',
    label: 'Leaderboard',
    description: 'View player rankings',
    available: true,
    category: 'info',
  });

  return actions;
}

/**
 * Format the action menu for terminal display.
 */
export function formatActionMenu(actions) {
  const categories = {
    move: 'Movement',
    property: 'Property',
    role: 'Role Actions',
    card: 'Action Cards',
    notification: 'Notifications',
    info: 'Information',
  };

  const lines = [];
  const grouped = {};
  for (const a of actions) {
    const cat = a.category || 'other';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(a);
  }

  for (const [cat, items] of Object.entries(grouped)) {
    lines.push(`\n  ${categories[cat] || cat}:`);
    for (const item of items) {
      const avail = item.available ? '' : ' (unavailable)';
      lines.push(`    ${item.action}${avail} — ${item.description}`);
    }
  }

  return lines.join('\n');
}
