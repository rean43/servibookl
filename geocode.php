<?php

function geocodeAddress(string $address): ?array
{
    $address = trim($address);
    if ($address === '') {
        return null;
    }

    $query = urlencode($address . ', Philippines');
    $url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' . $query;

    $context = stream_context_create([
        'http' => [
            'header' => "User-Agent: Servibook/1.0 (capstone project)\r\n",
            'timeout' => 8,
        ],
    ]);

    $response = @file_get_contents($url, false, $context);
    if ($response === false) {
        return null;
    }

    $data = json_decode($response, true);
    if (empty($data[0]['lat']) || empty($data[0]['lon'])) {
        return null;
    }

    return [
        'latitude' => (float) $data[0]['lat'],
        'longitude' => (float) $data[0]['lon'],
    ];
}

function updateUserCoordinates(PDO $pdo, int $userId, string $location): void
{
    $coords = geocodeAddress($location);
    if (!$coords) {
        return;
    }

    $stmt = $pdo->prepare('UPDATE users SET latitude = ?, longitude = ? WHERE id = ?');
    $stmt->execute([$coords['latitude'], $coords['longitude'], $userId]);
}
