-- Seed: Memories test posts (3 per user, same date as today but previous years)
-- Run on server: mysql -u root fellis_eu < server/seed-memories.sql

INSERT INTO posts (author_id, text_da, text_en, time_da, time_en, likes, created_at)
  SELECT u.id, 'For et år siden i dag: Husk den dag vi var på Frederiksborg Slot med hele familien! ☀️', 'One year ago today: Remember the day we visited Frederiksborg Castle with the whole family! ☀️',
         '14/03/2025', '03/14/2025', 0, '2025-03-14 12:00:00'
  FROM users u WHERE u.email = 'sofie@fellis.eu' LIMIT 1;

INSERT INTO posts (author_id, text_da, text_en, time_da, time_en, likes, created_at)
  SELECT u.id, 'For to år siden: Sommerfest i haven med naboerne — masser af god mad og grin 🎉', 'Two years ago: Garden party with the neighbours — lots of great food and laughter 🎉',
         '14/03/2024', '03/14/2024', 0, '2024-03-14 12:00:00'
  FROM users u WHERE u.email = 'sofie@fellis.eu' LIMIT 1;

INSERT INTO posts (author_id, text_da, text_en, time_da, time_en, likes, created_at)
  SELECT u.id, 'For tre år siden: Mit første opslag på Fellis. Hej verden! 👋', 'Three years ago: My first post on Fellis. Hello world! 👋',
         '14/03/2023', '03/14/2023', 0, '2023-03-14 12:00:00'
  FROM users u WHERE u.email = 'sofie@fellis.eu' LIMIT 1;

INSERT INTO posts (author_id, text_da, text_en, time_da, time_en, likes, created_at)
  SELECT u.id, 'For et år siden i dag: Husk den dag vi var på Frederiksborg Slot med hele familien! ☀️', 'One year ago today: Remember the day we visited Frederiksborg Castle with the whole family! ☀️',
         '14/03/2025', '03/14/2025', 0, '2025-03-14 12:00:00'
  FROM users u WHERE u.email = 'mp3@dulmens.dk' LIMIT 1;

INSERT INTO posts (author_id, text_da, text_en, time_da, time_en, likes, created_at)
  SELECT u.id, 'For to år siden: Sommerfest i haven med naboerne — masser af god mad og grin 🎉', 'Two years ago: Garden party with the neighbours — lots of great food and laughter 🎉',
         '14/03/2024', '03/14/2024', 0, '2024-03-14 12:00:00'
  FROM users u WHERE u.email = 'mp3@dulmens.dk' LIMIT 1;

INSERT INTO posts (author_id, text_da, text_en, time_da, time_en, likes, created_at)
  SELECT u.id, 'For tre år siden: Mit første opslag på Fellis. Hej verden! 👋', 'Three years ago: My first post on Fellis. Hello world! 👋',
         '14/03/2023', '03/14/2023', 0, '2023-03-14 12:00:00'
  FROM users u WHERE u.email = 'mp3@dulmens.dk' LIMIT 1;
