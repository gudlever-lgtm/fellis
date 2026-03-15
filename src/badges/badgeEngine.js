/**
 * Badge evaluation engine.
 *
 * Pure, side-effect-free. No DB calls, no API calls, no localStorage.
 * Import this on both client and server.
 */

import { BADGES } from './badgeDefinitions.js'

/**
 * evaluateBadges(userStats, earnedIds, disabledIds)
 *
 * Runs all badge definitions against the given userStats.
 * Returns the IDs of badges that are:
 *   - not already in earnedIds
 *   - not in disabledIds
 *   - whose evaluate() returns true
 *
 * @param {object} userStats    - user stats object (see badgeDefinitions.js for shape)
 * @param {string[]} earnedIds  - badge IDs already earned by this user
 * @param {string[]} disabledIds - badge IDs disabled by admin
 * @returns {string[]} newly earned badge IDs
 */
export function evaluateBadges(userStats, earnedIds = [], disabledIds = []) {
  const earnedSet = new Set(earnedIds)
  const disabledSet = new Set(disabledIds)
  // Inject earnedBadgeIds for cross-badge checks (e.g. t3_legend)
  const stats = { ...userStats, earnedBadgeIds: earnedIds }

  const newlyEarned = []
  for (const badge of BADGES) {
    if (earnedSet.has(badge.id)) continue
    if (disabledSet.has(badge.id)) continue
    try {
      if (badge.evaluate(stats)) newlyEarned.push(badge.id)
    } catch {
      // Malformed stats — skip gracefully
    }
  }
  return newlyEarned
}
