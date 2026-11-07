<?php

const PAYMENT_METHODS = [
    'cash'  => 'Cash on Service',
    'gcash' => 'GCash',
    'maya'  => 'Maya',
    'card'  => 'Credit/Debit Card',
];

const DIGITAL_PAYMENT_METHODS = ['gcash', 'maya', 'card'];

function getPaymentMethodLabel(string $method): string
{
    return PAYMENT_METHODS[$method] ?? ucfirst(str_replace('_', ' ', $method));
}

function isDigitalPaymentMethod(string $method): bool
{
    return in_array($method, DIGITAL_PAYMENT_METHODS, true);
}

function normalizePaymentMethod(string $method): string
{
    return array_key_exists($method, PAYMENT_METHODS) ? $method : 'cash';
}

function generateTransactionRef(): string
{
    return 'SB-' . date('Ymd') . '-' . strtoupper(substr(bin2hex(random_bytes(4)), 0, 8));
}

function ensurePaymentsSchema(PDO $pdo): void
{
    static $checked = false;
    if ($checked) {
        return;
    }

    $checked = true;

    try {
        $cols = $pdo->query("SHOW COLUMNS FROM payments LIKE 'provider_id'")->fetch();
        if (!$cols) {
            $pdo->exec("ALTER TABLE payments ADD COLUMN provider_id INT NULL AFTER user_id");
            $pdo->exec("ALTER TABLE payments ADD INDEX idx_payments_provider (provider_id)");
        }
    } catch (PDOException $e) {
        // Table may not exist yet; fix_payments.php handles creation.
    }
}

function createPaymentForBooking(PDO $pdo, int $bookingId, int $userId, int $providerId, float $amount, string $method): int
{
    ensurePaymentsSchema($pdo);

    $method = normalizePaymentMethod($method);
    $stmt = $pdo->prepare("
        INSERT INTO payments (booking_id, user_id, provider_id, amount, payment_method, payment_status)
        VALUES (?, ?, ?, ?, ?, 'pending')
    ");
    $stmt->execute([$bookingId, $userId, $providerId, $amount, $method]);

    return (int) $pdo->lastInsertId();
}

function getPaymentByBookingId(PDO $pdo, int $bookingId): ?array
{
    $stmt = $pdo->prepare("SELECT * FROM payments WHERE booking_id = ? ORDER BY id DESC LIMIT 1");
    $stmt->execute([$bookingId]);
    $payment = $stmt->fetch();
    return $payment ?: null;
}

function getPaymentById(PDO $pdo, int $paymentId): ?array
{
    $stmt = $pdo->prepare("SELECT * FROM payments WHERE id = ?");
    $stmt->execute([$paymentId]);
    $payment = $stmt->fetch();
    return $payment ?: null;
}

function getPaymentDetails(PDO $pdo, int $paymentId): ?array
{
    $stmt = $pdo->prepare("
        SELECT p.*,
               b.booking_date, b.booking_time, b.status AS booking_status,
               s.name AS service_name, s.category,
               c.full_name AS customer_name, c.email AS customer_email,
               pr.full_name AS provider_name
        FROM payments p
        JOIN bookings b ON p.booking_id = b.id
        JOIN services s ON b.service_id = s.id
        JOIN users c ON p.user_id = c.id
        JOIN users pr ON s.provider_id = pr.id
        WHERE p.id = ?
    ");
    $stmt->execute([$paymentId]);
    $payment = $stmt->fetch();
    return $payment ?: null;
}

function simulateDigitalPayment(PDO $pdo, int $paymentId, int $userId): array
{
    $payment = getPaymentById($pdo, $paymentId);

    if (!$payment) {
        return ['success' => false, 'error' => 'Payment record not found.'];
    }

    if ((int) $payment['user_id'] !== $userId) {
        return ['success' => false, 'error' => 'You are not allowed to pay for this booking.'];
    }

    if ($payment['payment_status'] !== 'pending') {
        return ['success' => false, 'error' => 'This payment has already been processed.'];
    }

    if (!isDigitalPaymentMethod($payment['payment_method'])) {
        return ['success' => false, 'error' => 'This payment method does not require online processing.'];
    }

    $transactionRef = generateTransactionRef();
    $stmt = $pdo->prepare("
        UPDATE payments
        SET payment_status = 'paid', transaction_ref = ?, paid_at = NOW()
        WHERE id = ? AND payment_status = 'pending'
    ");
    $stmt->execute([$transactionRef, $paymentId]);

    return [
        'success' => true,
        'transaction_ref' => $transactionRef,
        'payment_id' => $paymentId,
    ];
}

function completeCashPaymentForBooking(PDO $pdo, int $bookingId, int $providerId): void
{
    $stmt = $pdo->prepare("
        UPDATE payments p
        JOIN bookings b ON p.booking_id = b.id
        JOIN services s ON b.service_id = s.id
        SET p.payment_status = 'paid',
            p.transaction_ref = COALESCE(p.transaction_ref, ?),
            p.paid_at = NOW()
        WHERE p.booking_id = ?
          AND s.provider_id = ?
          AND p.payment_method = 'cash'
          AND p.payment_status = 'pending'
    ");
    $stmt->execute([generateTransactionRef(), $bookingId, $providerId]);
}

function cancelPaymentForBooking(PDO $pdo, int $bookingId): void
{
    $payment = getPaymentByBookingId($pdo, $bookingId);
    if (!$payment) {
        return;
    }

    $newStatus = $payment['payment_status'] === 'paid' ? 'refunded' : 'failed';
    $stmt = $pdo->prepare("UPDATE payments SET payment_status = ? WHERE booking_id = ?");
    $stmt->execute([$newStatus, $bookingId]);
}

function getCustomerPayments(PDO $pdo, int $userId): array
{
    $stmt = $pdo->prepare("
        SELECT p.*, s.name AS service_name, pr.full_name AS provider_name,
               b.booking_date, b.booking_time, b.status AS booking_status
        FROM payments p
        JOIN bookings b ON p.booking_id = b.id
        JOIN services s ON b.service_id = s.id
        JOIN users pr ON s.provider_id = pr.id
        WHERE p.user_id = ?
        ORDER BY p.created_at DESC
    ");
    $stmt->execute([$userId]);
    return $stmt->fetchAll();
}

function getProviderPayments(PDO $pdo, int $providerId): array
{
    ensurePaymentsSchema($pdo);

    $stmt = $pdo->prepare("
        SELECT p.*, s.name AS service_name, c.full_name AS customer_name,
               b.booking_date, b.booking_time, b.status AS booking_status
        FROM payments p
        JOIN bookings b ON p.booking_id = b.id
        JOIN services s ON b.service_id = s.id
        JOIN users c ON p.user_id = c.id
        WHERE s.provider_id = ?
        ORDER BY p.created_at DESC
    ");
    $stmt->execute([$providerId]);
    return $stmt->fetchAll();
}

function getAllPayments(PDO $pdo): array
{
    $stmt = $pdo->query("
        SELECT p.*, s.name AS service_name,
               c.full_name AS customer_name,
               pr.full_name AS provider_name,
               b.booking_date, b.status AS booking_status
        FROM payments p
        JOIN bookings b ON p.booking_id = b.id
        JOIN services s ON b.service_id = s.id
        JOIN users c ON p.user_id = c.id
        JOIN users pr ON s.provider_id = pr.id
        ORDER BY p.created_at DESC
    ");
    return $stmt->fetchAll();
}

function getPaymentStatusClass(string $status): string
{
    return match ($status) {
        'paid' => 'completed',
        'pending' => 'pending',
        'refunded' => 'cancelled',
        default => 'cancelled',
    };
}
