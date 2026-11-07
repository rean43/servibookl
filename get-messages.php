<?php
header('Content-Type: application/json');
require_once '../includes/auth.php';
require_once '../includes/chat.php';

if (!isLoggedIn()) {
    http_response_code(401);
    echo json_encode(['error' => 'Login required']);
    exit;
}

$conversationId = (int) ($_GET['conversation_id'] ?? 0);
$userId = (int) $_SESSION['user_id'];

if (!$conversationId || !userCanAccessConversation($pdo, $conversationId, $userId)) {
    http_response_code(403);
    echo json_encode(['error' => 'Conversation not found']);
    exit;
}

try {
    $stmt = $pdo->prepare("
        SELECT m.id, m.conversation_id, m.sender_id, m.message, m.created_at, u.full_name AS sender_name
        FROM messages m
        JOIN users u ON u.id = m.sender_id
        WHERE m.conversation_id = ?
        ORDER BY m.created_at ASC
    ");
    $stmt->execute([$conversationId]);
    $messages = $stmt->fetchAll();

    echo json_encode(array_map(static function ($message) use ($userId) {
        return [
            'id' => (int) $message['id'],
            'sender_id' => (int) $message['sender_id'],
            'sender_name' => $message['sender_name'],
            'message' => $message['message'],
            'created_at' => $message['created_at'],
            'is_mine' => (int) $message['sender_id'] === $userId,
        ];
    }, $messages));
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Unable to load messages']);
}
