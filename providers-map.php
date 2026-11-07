<?php
header('Content-Type: application/json');
require_once '../includes/db.php';

try {
    $stmt = $pdo->query("
        SELECT
            u.id,
            u.full_name,
            u.location,
            u.latitude,
            u.longitude,
            COUNT(s.id) AS service_count,
            COALESCE(AVG(s.rating), 0) AS avg_rating
        FROM users u
        LEFT JOIN services s ON u.id = s.provider_id AND s.status = 'active'
        WHERE u.role = 'provider'
        GROUP BY u.id
        HAVING service_count > 0
        ORDER BY avg_rating DESC
    ");

    $providers = $stmt->fetchAll();
    $result = [];

    foreach ($providers as $provider) {
        $lat = $provider['latitude'] !== null ? (float) $provider['latitude'] : null;
        $lng = $provider['longitude'] !== null ? (float) $provider['longitude'] : null;

        if ($lat === null || $lng === null) {
            continue;
        }

        $result[] = [
            'id' => (int) $provider['id'],
            'name' => $provider['full_name'],
            'location' => $provider['location'],
            'latitude' => $lat,
            'longitude' => $lng,
            'service_count' => (int) $provider['service_count'],
            'avg_rating' => round((float) $provider['avg_rating'], 1),
        ];
    }

    echo json_encode($result);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Unable to load providers for map. Run database/migration_chat_map.sql first.']);
}
