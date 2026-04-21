import { userHasFeature } from '../features.js'

export function requireFeature(feature) {
  return async (req, res, next) => {
    const has = await userHasFeature(req.userId, feature)
    if (!has) return res.status(403).json({ error: 'feature_required', feature })
    next()
  }
}
