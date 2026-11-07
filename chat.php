<?php

function userCanAccessConversation(PDO $pdo, int $conversationId, int $userId): bool
{
    $stmt = $pdo->prepare('
        SELECT id FROM conversations
        WHERE id = ? AND (customer_id = ? OR provider_id = ?)
    ');
    $stmt->execute([$conversationId, $userId, $userId]);
    return (bool) $stmt->fetch();
}

function getOrCreateConversation(PDO $pdo, int $customerId, int $providerId, ?int $serviceId = null): int
{
    $stmt = $pdo->prepare('
        SELECT id FROM conversations
        WHERE customer_id = ? AND provider_id = ?
    ');
    $stmt->execute([$customerId, $providerId]);
    $existing = $stmt->fetch();

    if ($existing) {
        return (int) $existing['id'];
    }

    $stmt = $pdo->prepare('
        INSERT INTO conversations (customer_id, provider_id, service_id)
        VALUES (?, ?, ?)
    ');
    $stmt->execute([$customerId, $providerId, $serviceId]);

    return (int) $pdo->lastInsertId();
}

function getConversationPartner(array $conversation, int $currentUserId): array
{
    if ((int) $conversation['customer_id'] === $currentUserId) {
        return [
            'id' => (int) $conversation['provider_id'],
            'name' => $conversation['provider_name'],
            'role' => 'provider',
        ];
    }

    return [
        'id' => (int) $conversation['customer_id'],
        'name' => $conversation['customer_name'],
        'role' => 'customer',
    ];
}
