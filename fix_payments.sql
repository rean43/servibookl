-- Fix corrupted payments table (error 1932 / orphaned tablespace)
-- If CREATE fails, stop MySQL, delete C:\xampp\mysql\data\servibook\payments.ibd, then run again.
-- Or run: php database/fix_payments.php

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS payments;
SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE payments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    booking_id INT NOT NULL,
    user_id INT NOT NULL,
    provider_id INT DEFAULT NULL,
    amount DECIMAL(10,2) NOT NULL,
    payment_method ENUM('cash','gcash','maya','bank_transfer','card') NOT NULL DEFAULT 'cash',
    payment_status ENUM('pending','paid','failed','refunded') NOT NULL DEFAULT 'pending',
    transaction_ref VARCHAR(100) DEFAULT NULL,
    paid_at TIMESTAMP NULL DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_payments_booking (booking_id),
    INDEX idx_payments_status (payment_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
