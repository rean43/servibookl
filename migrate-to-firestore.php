<?php
/**
 * One-time MySQL -> Firestore migration for Servibook.
 *
 * CLI:  php scripts/migrate-to-firestore.php
 * Web:  POST /scripts/migrate-to-firestore.php with JSON {"secret":"..."}
 * Set FIREBASE_SERVICE_ACCOUNT to a service-account JSON file path (or JSON),
 * FIREBASE_PROJECT_ID to the Firebase project ID, and for web runs set
 * FIRESTORE_MIGRATION_SECRET to a long random secret. Keep this script private
 * or delete it after a successful migration.
 */

declare(strict_types=1);

function emitProgress(string $message): void
{
    if (PHP_SAPI === 'cli') {
        fwrite(STDOUT, $message . PHP_EOL);
        return;
    }
    echo htmlspecialchars($message, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') . "<br>\n";
    if (function_exists('ob_flush')) { @ob_flush(); }
    flush();
}

function stopMigration(int $status, string $message): never
{
    if (PHP_SAPI !== 'cli') {
        http_response_code($status);
        header('Content-Type: text/html; charset=utf-8');
    }
    emitProgress('ERROR: ' . $message);
    exit(1);
}

if (PHP_SAPI !== 'cli') {
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-store');
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        header('Allow: POST');
        stopMigration(405, 'POST is required.');
    }
    $request = json_decode((string) file_get_contents('php://input'), true);
    $providedSecret = is_array($request) ? (string) ($request['secret'] ?? '') : (string) ($_POST['secret'] ?? '');
    $expectedSecret = getenv('FIRESTORE_MIGRATION_SECRET') ?: '';
    if ($expectedSecret === '' || !hash_equals($expectedSecret, $providedSecret)) {
        stopMigration(403, 'Migration authorization failed.');
    }
}

$projectRoot = dirname(__DIR__);
$autoload = $projectRoot . DIRECTORY_SEPARATOR . 'vendor' . DIRECTORY_SEPARATOR . 'autoload.php';
if (!is_file($autoload)) {
    stopMigration(500, 'Composer dependencies are missing. Install kreait/firebase-php and google/cloud-firestore first.');
}
require_once $autoload;
require_once $projectRoot . DIRECTORY_SEPARATOR . 'includes' . DIRECTORY_SEPARATOR . 'db.php';

$projectId = getenv('FIREBASE_PROJECT_ID') ?: '';
$credentialSetting = getenv('FIREBASE_SERVICE_ACCOUNT') ?: '';
if ($projectId === '' || $credentialSetting === '') {
    stopMigration(500, 'Set FIREBASE_PROJECT_ID and FIREBASE_SERVICE_ACCOUNT before running the migration.');
}

$serviceAccount = $credentialSetting;
if (is_file($credentialSetting)) {
    $serviceAccount = json_decode((string) file_get_contents($credentialSetting), true);
}
if (!is_array($serviceAccount) && (!is_string($serviceAccount) || json_decode($serviceAccount, true) === null)) {
    stopMigration(500, 'FIREBASE_SERVICE_ACCOUNT must be a valid service-account JSON file path or JSON value.');
}
if (is_string($serviceAccount)) {
    $serviceAccount = json_decode($serviceAccount, true);
}
if (!is_array($serviceAccount)) {
    stopMigration(500, 'Unable to load Firebase service-account credentials.');
}

try {
    $factory = (new \Kreait\Firebase\Factory())->withServiceAccount($serviceAccount);
    $auth = $factory->createAuth();
    $firestore = $factory->createFirestore()->database();
} catch (Throwable $error) {
    error_log('Firestore migration initialization failed: ' . $error->getMessage());
    stopMigration(500, 'Could not initialize Firebase Admin SDK. Check the service account and Composer packages.');
}

/** Encode a coordinate into a standard geohash (base32, precision 9). */
function geohashForCoordinates(float $latitude, float $longitude, int $precision = 9): string
{
    $alphabet = '0123456789bcdefghjkmnpqrstuvwxyz';
    $latRange = [-90.0, 90.0];
    $lngRange = [-180.0, 180.0];
    $hash = '';
    $bit = 0;
    $character = 0;
    $longitudeTurn = true;

    while (strlen($hash) < $precision) {
        if ($longitudeTurn) {
            $middle = ($lngRange[0] + $lngRange[1]) / 2;
            if ($longitude >= $middle) { $character |= 1 << (4 - $bit); $lngRange[0] = $middle; }
            else { $lngRange[1] = $middle; }
        } else {
            $middle = ($latRange[0] + $latRange[1]) / 2;
            if ($latitude >= $middle) { $character |= 1 << (4 - $bit); $latRange[0] = $middle; }
            else { $latRange[1] = $middle; }
        }
        $longitudeTurn = !$longitudeTurn;
        if ($bit < 4) { $bit++; }
        else { $hash .= $alphabet[$character]; $bit = 0; $character = 0; }
    }
    return $hash;
}

/** Normalize legacy SQL fields to the Firestore service-card properties used in the app. */
function normalizeServices(array $rows): array
{
    $services = [];
    foreach ($rows as $row) {
        $services[] = [
            'legacyId' => (int) $row['id'],
            'name' => (string) ($row['title'] ?? $row['name'] ?? ''),
            'description' => (string) ($row['description'] ?? ''),
            'category' => (string) ($row['category'] ?? ''),
            'price' => is_numeric($row['price'] ?? null) ? (float) $row['price'] : null,
            'status' => (string) ($row['status'] ?? 'active'),
            'rating' => is_numeric($row['rating'] ?? null) ? (float) $row['rating'] : null,
        ];
    }
    return $services;
}

try {
    $users = $pdo->query('SELECT * FROM users ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
    $providers = array_values(array_filter($users, static fn(array $user): bool => ($user['role'] ?? '') === 'provider'));
    emitProgress('Found ' . count($users) . ' users and ' . count($providers) . ' providers.');

    $usersCollection = $firestore->collection('users');
    $userDocumentsByLegacyId = [];
    foreach ($users as $index => $user) {
        $legacyId = (int) $user['id'];
        $email = trim((string) ($user['email'] ?? ''));
        $firebaseUid = '';

        // Reuse a Firebase account already registered with the same email.
        if ($email !== '') {
            try { $firebaseUid = $auth->getUserByEmail($email)->uid; }
            catch (\Kreait\Firebase\Exception\Auth\UserNotFound $notFound) { /* Legacy-only account. */ }
            catch (Throwable $lookupError) {
                error_log('Firebase Auth lookup failed for legacy user ' . $legacyId . ': ' . $lookupError->getMessage());
            }
        }

        // Deterministic fallback makes retries safe and preserves old-ID lookup.
        $documentId = $firebaseUid !== '' ? $firebaseUid : 'legacy-' . $legacyId;
        $profile = [
            'uid' => $firebaseUid !== '' ? $firebaseUid : null,
            'legacyId' => $legacyId,
            'fullName' => (string) ($user['full_name'] ?? ''),
            'email' => $email,
            'role' => (string) ($user['role'] ?? 'customer'),
            'phone' => ($user['phone'] ?? '') !== '' ? (string) $user['phone'] : null,
            'location' => ($user['location'] ?? '') !== '' ? (string) $user['location'] : null,
        ];
        if (isset($user['latitude'], $user['longitude']) && is_numeric($user['latitude']) && is_numeric($user['longitude'])) {
            $profile['latitude'] = (float) $user['latitude'];
            $profile['longitude'] = (float) $user['longitude'];
        }

        $usersCollection->document($documentId)->set($profile, ['merge' => true]);
        $userDocumentsByLegacyId[$legacyId] = $documentId;
        emitProgress('[' . ($index + 1) . '/' . count($users) . '] Migrated user legacyId=' . $legacyId . ' to users/' . $documentId);
    }

    $servicesByProvider = [];
    $servicesStatement = $pdo->query('SELECT * FROM services ORDER BY provider_id, id');
    foreach ($servicesStatement->fetchAll(PDO::FETCH_ASSOC) as $service) {
        $providerId = (int) ($service['provider_id'] ?? 0);
        $servicesByProvider[$providerId][] = $service;
    }

    $providerCollection = $firestore->collection('providers');
    $migratedProviders = 0;
    foreach ($providers as $provider) {
        $legacyId = (int) $provider['id'];
        $latitude = $provider['latitude'] ?? null;
        $longitude = $provider['longitude'] ?? null;
        if (!is_numeric($latitude) || !is_numeric($longitude)) {
            emitProgress('Skipped provider legacyId=' . $legacyId . ': missing coordinates.');
            continue;
        }
        $latitude = (float) $latitude;
        $longitude = (float) $longitude;
        if ($latitude < -90 || $latitude > 90 || $longitude < -180 || $longitude > 180) {
            emitProgress('Skipped provider legacyId=' . $legacyId . ': coordinates are out of range.');
            continue;
        }

        $serviceRows = $servicesByProvider[$legacyId] ?? [];
        $services = normalizeServices($serviceRows);
        $activeServices = array_values(array_filter($services, static fn(array $service): bool => $service['status'] === 'active'));
        $ratings = array_values(array_filter(array_map(static fn(array $service) => $service['rating'], $activeServices), static fn($rating): bool => is_float($rating)));
        $providerData = [
            'name' => (string) ($provider['full_name'] ?? ''),
            'location' => (string) ($provider['location'] ?? ''),
            'services' => $services,
            'service_count' => count($activeServices),
            'avg_rating' => count($ratings) ? round(array_sum($ratings) / count($ratings), 1) : 0.0,
            'lat' => $latitude,
            'lng' => $longitude,
            'latitude' => $latitude,
            'longitude' => $longitude,
            'geohash' => geohashForCoordinates($latitude, $longitude),
            'locationCoordinates' => [$latitude, $longitude],
            'legacyId' => $legacyId,
            'userId' => $userDocumentsByLegacyId[$legacyId] ?? ('legacy-' . $legacyId),
        ];
        $providerCollection->document((string) $legacyId)->set($providerData, ['merge' => true]);
        $migratedProviders++;
        emitProgress('Migrated provider legacyId=' . $legacyId . ' with ' . count($services) . ' service(s).');
    }

    emitProgress('Migration complete: ' . count($users) . ' user(s), ' . $migratedProviders . ' provider(s) written.');
} catch (Throwable $error) {
    error_log('Firestore migration failed: ' . $error->getMessage());
    stopMigration(500, 'Migration stopped after an error. See the server log for details; rerunning is safe because documents use stable IDs.');
}
