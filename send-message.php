<?php
header('Content-Type: application/json');
require_once '../includes/auth.php';
require_once '../includes/chat.php';

if (!isLoggedIn()) {
    http_response_code(401);
    echo json_encode(['error' => 'Login required']);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

$data = json_decode(file_get_contents('php://input'), true);
$conversationId = (int) ($data['conversation_id'] ?? 0);
$message = trim($data['message'] ?? '');
$userId = (int) $_SESSION['user_id'];

if (!$conversationId || $message === '') {
    http_response_code(400);
    echo json_encode(['error' => 'Conversation and message are required']);
    exit;
}

if (!userCanAccessConversation($pdo, $conversationId, $userId)) {
    http_response_code(403);
    echo json_encode(['error' => 'Conversation not found']);
    exit;
}

try {
    $stmt = $pdo->prepare('
        INSERT INTO messages (conversation_id, sender_id, message)
        VALUES (?, ?, ?)
    ');
    $stmt->execute([$conversationId, $userId, $message]);

    echo json_encode([
        'success' => true,
        'message_id' => (int) $pdo->lastInsertId(),
    ]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Unable to send message']);
}
