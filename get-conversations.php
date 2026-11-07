<?php
header('Content-Type: application/json');
require_once '../includes/auth.php';

if (!isLoggedIn()) {
    http_response_code(401);
    echo json_encode(['error' => 'Login required']);
    exit;
}

$userId = (int) $_SESSION['user_id'];

try {
    $stmt = $pdo->prepare("
        SELECT
            c.id,
            c.customer_id,
            c.provider_id,
            c.service_id,
            c.created_at,
            cu.full_name AS customer_name,
            pu.full_name AS provider_name,
            (
                SELECT m.message
                FROM messages m
                WHERE m.conversation_id = c.id
                ORDER BY m.created_at DESC
                LIMIT 1
            ) AS last_message,
            (
                SELECT m.created_at
                FROM messages m
                WHERE m.conversation_id = c.id
                ORDER BY m.created_at DESC
                LIMIT 1
            ) AS last_message_at
        FROM conversations c
        JOIN users cu ON cu.id = c.customer_id
        JOIN users pu ON pu.id = c.provider_id
        WHERE c.customer_id = ? OR c.provider_id = ?
        ORDER BY COALESCE(last_message_at, c.created_at) DESC
    ");
    $stmt->execute([$userId, $userId]);
    $conversations = $stmt->fetchAll();

    $result = array_map(static function ($conversation) use ($userId) {
        $isCustomer = (int) $conversation['customer_id'] === $userId;

        return [
            'id' => (int) $conversation['id'],
            'partner_name' => $isCustomer ? $conversation['provider_name'] : $conversation['customer_name'],
            'partner_id' => $isCustomer ? (int) $conversation['provider_id'] : (int) $conversation['customer_id'],
            'last_message' => $conversation['last_message'],
            'last_message_at' => $conversation['last_message_at'],
        ];
    }, $conversations);

    echo json_encode($result);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Unable to load conversations. Run database/migration_chat_map.sql first.']);
}
