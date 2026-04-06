-- ── Easter Egg Default Hints Migration ──
-- fellis.eu — run against fellis_eu database
-- Sets cryptic default hints for eggs that have no hint text yet.
-- Eggs already customised by an admin (non-empty hintText) are left untouched.
-- Compatible with MariaDB 11.8+ / MySQL 8+

USE fellis_eu;

UPDATE admin_settings
SET key_value = JSON_SET(
  key_value,

  -- chuck: only update if hintText is currently empty
  '$.chuck.hintsEnabled',
    IF(IFNULL(JSON_UNQUOTE(JSON_EXTRACT(key_value, '$.chuck.hintText')), '') = '',
      CAST(TRUE AS JSON), JSON_EXTRACT(key_value, '$.chuck.hintsEnabled')),
  '$.chuck.hintText',
    IF(IFNULL(JSON_UNQUOTE(JSON_EXTRACT(key_value, '$.chuck.hintText')), '') = '',
      '↑↑↓↓←→←→ — klassisk!', JSON_UNQUOTE(JSON_EXTRACT(key_value, '$.chuck.hintText'))),

  -- matrix
  '$.matrix.hintsEnabled',
    IF(IFNULL(JSON_UNQUOTE(JSON_EXTRACT(key_value, '$.matrix.hintText')), '') = '',
      CAST(TRUE AS JSON), JSON_EXTRACT(key_value, '$.matrix.hintsEnabled')),
  '$.matrix.hintText',
    IF(IFNULL(JSON_UNQUOTE(JSON_EXTRACT(key_value, '$.matrix.hintText')), '') = '',
      'Følg den hvide kanin', JSON_UNQUOTE(JSON_EXTRACT(key_value, '$.matrix.hintText'))),

  -- flip
  '$.flip.hintsEnabled',
    IF(IFNULL(JSON_UNQUOTE(JSON_EXTRACT(key_value, '$.flip.hintText')), '') = '',
      CAST(TRUE AS JSON), JSON_EXTRACT(key_value, '$.flip.hintsEnabled')),
  '$.flip.hintText',
    IF(IFNULL(JSON_UNQUOTE(JSON_EXTRACT(key_value, '$.flip.hintText')), '') = '',
      'Verden set fra en anden vinkel', JSON_UNQUOTE(JSON_EXTRACT(key_value, '$.flip.hintText'))),

  -- retro
  '$.retro.hintsEnabled',
    IF(IFNULL(JSON_UNQUOTE(JSON_EXTRACT(key_value, '$.retro.hintText')), '') = '',
      CAST(TRUE AS JSON), JSON_EXTRACT(key_value, '$.retro.hintsEnabled')),
  '$.retro.hintText',
    IF(IFNULL(JSON_UNQUOTE(JSON_EXTRACT(key_value, '$.retro.hintText')), '') = '',
      'Tilbage til rødderne', JSON_UNQUOTE(JSON_EXTRACT(key_value, '$.retro.hintText'))),

  -- gravity
  '$.gravity.hintsEnabled',
    IF(IFNULL(JSON_UNQUOTE(JSON_EXTRACT(key_value, '$.gravity.hintText')), '') = '',
      CAST(TRUE AS JSON), JSON_EXTRACT(key_value, '$.gravity.hintsEnabled')),
  '$.gravity.hintText',
    IF(IFNULL(JSON_UNQUOTE(JSON_EXTRACT(key_value, '$.gravity.hintText')), '') = '',
      'Newton havde ret om feeds', JSON_UNQUOTE(JSON_EXTRACT(key_value, '$.gravity.hintText'))),

  -- party
  '$.party.hintsEnabled',
    IF(IFNULL(JSON_UNQUOTE(JSON_EXTRACT(key_value, '$.party.hintText')), '') = '',
      CAST(TRUE AS JSON), JSON_EXTRACT(key_value, '$.party.hintsEnabled')),
  '$.party.hintText',
    IF(IFNULL(JSON_UNQUOTE(JSON_EXTRACT(key_value, '$.party.hintText')), '') = '',
      'Festen venter på dig', JSON_UNQUOTE(JSON_EXTRACT(key_value, '$.party.hintText'))),

  -- rickroll
  '$.rickroll.hintsEnabled',
    IF(IFNULL(JSON_UNQUOTE(JSON_EXTRACT(key_value, '$.rickroll.hintText')), '') = '',
      CAST(TRUE AS JSON), JSON_EXTRACT(key_value, '$.rickroll.hintsEnabled')),
  '$.rickroll.hintText',
    IF(IFNULL(JSON_UNQUOTE(JSON_EXTRACT(key_value, '$.rickroll.hintText')), '') = '',
      'Nysgerrighed har en pris', JSON_UNQUOTE(JSON_EXTRACT(key_value, '$.rickroll.hintText'))),

  -- watcher
  '$.watcher.hintsEnabled',
    IF(IFNULL(JSON_UNQUOTE(JSON_EXTRACT(key_value, '$.watcher.hintText')), '') = '',
      CAST(TRUE AS JSON), JSON_EXTRACT(key_value, '$.watcher.hintsEnabled')),
  '$.watcher.hintText',
    IF(IFNULL(JSON_UNQUOTE(JSON_EXTRACT(key_value, '$.watcher.hintText')), '') = '',
      'Hvem kigger på hvem?', JSON_UNQUOTE(JSON_EXTRACT(key_value, '$.watcher.hintText'))),

  -- riddler
  '$.riddler.hintsEnabled',
    IF(IFNULL(JSON_UNQUOTE(JSON_EXTRACT(key_value, '$.riddler.hintText')), '') = '',
      CAST(TRUE AS JSON), JSON_EXTRACT(key_value, '$.riddler.hintsEnabled')),
  '$.riddler.hintText',
    IF(IFNULL(JSON_UNQUOTE(JSON_EXTRACT(key_value, '$.riddler.hintText')), '') = '',
      'Spørgsmålet er svaret', JSON_UNQUOTE(JSON_EXTRACT(key_value, '$.riddler.hintText'))),

  -- phantom
  '$.phantom.hintsEnabled',
    IF(IFNULL(JSON_UNQUOTE(JSON_EXTRACT(key_value, '$.phantom.hintText')), '') = '',
      CAST(TRUE AS JSON), JSON_EXTRACT(key_value, '$.phantom.hintsEnabled')),
  '$.phantom.hintText',
    IF(IFNULL(JSON_UNQUOTE(JSON_EXTRACT(key_value, '$.phantom.hintText')), '') = '',
      'Ikke alle besøgende er synlige', JSON_UNQUOTE(JSON_EXTRACT(key_value, '$.phantom.hintText')))
)
WHERE key_name = 'easter_egg_config';
