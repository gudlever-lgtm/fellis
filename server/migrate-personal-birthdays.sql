-- Personal birthday list: manually tracked birthdays for family/friends
CREATE TABLE IF NOT EXISTS personal_birthdays (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  birthday DATE NOT NULL,
  relation ENUM('self', 'family', 'friend', 'other') NOT NULL DEFAULT 'family',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pb_user_id (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
