<?php
/**
 * Repairs corrupted payments table (orphaned .ibd / missing engine).
 */
require_once __DIR__ . '/../includes/db.php';

$dataDir = 'C:/xampp/mysql/data/servibook';
$ibdFile = $dataDir . '/payments.ibd';

try {
    $pdo->exec('SET FOREIGN_KEY_CHECKS = 0');
    $pdo->exec('DROP TABLE IF EXISTS payments');
    $pdo->exec('SET FOREIGN_KEY_CHECKS = 1');
} catch (PDOException $e) {
    echo "DROP warning: " . $e->getMessage() . "\n";
}

if (file_exists($ibdFile)) {
    if (@unlink($ibdFile)) {
        echo "Removed orphaned payments.ibd\n";
    } else {
        echo "Could not delete payments.ibd — stop MySQL in XAMPP and delete manually:\n$ibdFile\n";
        exit(1);
    }
}

$createSql = "CREATE TABLE payments (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4";

try {
    $pdo->exec($createSql);
    echo "Payments table created successfully.\n\n";
    foreach ($pdo->query('DESCRIBE payments')->fetchAll() as $col) {
        echo $col['Field'] . ' | ' . $col['Type'] . "\n";
    }
} catch (PDOException $e) {
    echo "Create failed: " . $e->getMessage() . "\n";
    exit(1);
}
